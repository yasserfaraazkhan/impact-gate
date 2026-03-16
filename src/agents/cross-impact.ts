// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Cross-Impact Analyst Agent — finds ripple effects across route families
 * by analyzing shared dependencies between changed families and all other families.
 */

import {LLMProviderFactory} from '../provider_factory.js';
import {buildCrossImpactPrompt, parseCrossImpactResponse} from '../prompts/cross-impact.js';
import type {Agent, AgentTask, AgentResult} from '../crew/protocol.js';
import type {CrewContext} from '../crew/context.js';
import type {AgentRole, CrossImpact} from '../crew/types.js';

const VALID_RISK = new Set(['high', 'medium', 'low']);

export class CrossImpactAgent implements Agent {
    readonly role: AgentRole = 'cross-impact';

    async execute(_task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        const warnings: string[] = [];

        if (ctx.routeFamilies.length === 0) {
            warnings.push('Cross-impact: no route families available.');
            return {role: this.role, status: 'partial', output: [], warnings};
        }

        // Determine directly impacted families from family groups
        const directlyImpacted = new Set(ctx.familyGroups.map((g) => g.familyId));
        if (directlyImpacted.size === 0) {
            warnings.push('Cross-impact: no directly impacted families.');
            return {role: this.role, status: 'partial', output: [], warnings};
        }

        // First: deterministic cross-impact detection via shared paths
        const deterministicCrossImpacts = this.detectDeterministic(ctx, directlyImpacted);
        ctx.crossImpacts.push(...deterministicCrossImpacts);

        // Then: LLM-enriched analysis for semantic cross-impacts
        try {
            const provider = ctx.providerOverride
                ? LLMProviderFactory.createFromString(ctx.providerOverride)
                : await LLMProviderFactory.createFromEnv();

            const prompt = buildCrossImpactPrompt({
                changedFiles: ctx.changedFiles,
                families: ctx.routeFamilies,
                directlyImpactedFamilyIds: Array.from(directlyImpacted),
            });

            const response = await provider.generateText(prompt, {
                maxTokens: 3000,
                temperature: 0,
                timeout: 45000,
                systemPrompt: 'Return only valid JSON. Do not include markdown fences unless necessary.',
            });

            const parsed = parseCrossImpactResponse(response.text);
            if (parsed && parsed.crossImpacts.length > 0) {
                const familyIds = new Set(ctx.routeFamilies.map((f) => f.id));
                const llmCrossImpacts: CrossImpact[] = parsed.crossImpacts
                    .filter((ci) =>
                        familyIds.has(ci.sourceFamily) &&
                        familyIds.has(ci.affectedFamily) &&
                        ci.sourceFamily !== ci.affectedFamily,
                    )
                    .map((ci) => ({
                        sourceFamily: ci.sourceFamily,
                        affectedFamily: ci.affectedFamily,
                        sharedDependency: ci.sharedDependency || 'unknown',
                        riskLevel: VALID_RISK.has(ci.riskLevel) ? ci.riskLevel as CrossImpact['riskLevel'] : 'low',
                        evidence: ci.evidence || '',
                    }));

                // Deduplicate against deterministic results
                const existing = new Set(
                    ctx.crossImpacts.map((ci) => `${ci.sourceFamily}->${ci.affectedFamily}`),
                );
                for (const ci of llmCrossImpacts) {
                    const key = `${ci.sourceFamily}->${ci.affectedFamily}`;
                    if (!existing.has(key)) {
                        ctx.crossImpacts.push(ci);
                        existing.add(key);
                    }
                }
            }

            return {
                role: this.role,
                status: ctx.crossImpacts.length > 0 ? 'success' : 'partial',
                output: ctx.crossImpacts,
                usage: provider.getUsageStats(),
                warnings,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Cross-impact LLM analysis failed: ${message}. Using deterministic results only.`);
            return {
                role: this.role,
                status: deterministicCrossImpacts.length > 0 ? 'partial' : 'failed',
                output: ctx.crossImpacts,
                warnings,
            };
        }
    }

    /**
     * Deterministic cross-impact detection: find families that share webapp/server paths
     * or components with the directly impacted families.
     */
    private detectDeterministic(ctx: CrewContext, directlyImpacted: Set<string>): CrossImpact[] {
        const results: CrossImpact[] = [];

        for (const sourceId of directlyImpacted) {
            const source = ctx.routeFamilies.find((f) => f.id === sourceId);
            if (!source) continue;

            const sourcePaths = new Set([
                ...(source.webappPaths || []),
                ...(source.serverPaths || []),
                ...(source.components || []),
            ]);

            if (sourcePaths.size === 0) continue;

            for (const target of ctx.routeFamilies) {
                if (target.id === sourceId) continue;

                const targetPaths = [
                    ...(target.webappPaths || []),
                    ...(target.serverPaths || []),
                    ...(target.components || []),
                ];

                for (const path of targetPaths) {
                    if (sourcePaths.has(path)) {
                        results.push({
                            sourceFamily: sourceId,
                            affectedFamily: target.id,
                            sharedDependency: path,
                            riskLevel: 'medium',
                            evidence: `Shared path: ${path} is referenced by both ${sourceId} and ${target.id}`,
                        });
                        break; // One match per family pair is enough
                    }
                }
            }
        }

        return results;
    }
}

// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {LLMProviderFactory} from '../provider_factory.js';
import type {LLMProvider} from '../provider_interface.js';
import {buildImpactPrompt, parseImpactResponse, type ImpactPromptContext} from '../prompts/impact.js';
import {formatContextForPrompt} from '../knowledge/context_loader.js';
import {getFamilyById, type RouteFamilyManifest} from '../knowledge/route_families.js';
import {getSpecsForFamily, type SpecIndex} from '../knowledge/spec_index.js';
import type {ApiSurfaceCatalog} from '../knowledge/api_surface.js';
import type {LoadedContext} from '../knowledge/context_loader.js';
import type {FamilyGroup} from './stage0_preprocess.js';
import type {FlowDecision, FlowPriority, EvidenceSource} from '../validation/output_schema.js';
import {computeConfidence, shouldForceCannotDetermine} from '../validation/guardrails.js';

export interface ImpactConfig {
    provider?: string;
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
}

export interface ImpactResult {
    decisions: FlowDecision[];
    warnings: string[];
    providerName: string;
}

function normalizePriority(value: unknown): FlowPriority {
    if (value === 'P0' || value === 'P1' || value === 'P2') {
        return value;
    }
    return 'P2';
}

async function getProvider(config: ImpactConfig): Promise<LLMProvider> {
    if (config.provider && config.provider !== 'auto') {
        return LLMProviderFactory.createFromString(config.provider);
    }
    return LLMProviderFactory.createFromEnv();
}

export async function runImpactStage(
    familyGroups: FamilyGroup[],
    manifest: RouteFamilyManifest | null,
    specIndex: SpecIndex,
    apiSurface: ApiSurfaceCatalog,
    context: LoadedContext,
    config: ImpactConfig,
): Promise<ImpactResult> {
    const warnings: string[] = [];
    const allDecisions: FlowDecision[] = [];

    if (familyGroups.length === 0) {
        warnings.push('No family groups to analyze. All changed files were unbound.');
        return {decisions: [], warnings, providerName: 'none'};
    }

    let provider: LLMProvider;
    try {
        provider = await getProvider(config);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Impact agent unavailable: ${message}`);
        return {decisions: [], warnings, providerName: 'none'};
    }

    const contextBlock = formatContextForPrompt(context);

    for (const group of familyGroups) {
        const family = manifest ? getFamilyById(manifest, group.familyId) : null;
        if (!family) {
            // For unbound groups, create cannot_determine decisions
            for (const file of group.files) {
                allDecisions.push({
                    flowId: `unbound_${file.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
                    flowName: `Unbound file: ${file.path}`,
                    routeFamily: '__unbound__',
                    changedFiles: [file.path],
                    evidence: 'File does not match any known route family in the manifest.',
                    evidenceSource: 'deterministic',
                    confidence: 0,
                    existingSpecs: [],
                    action: 'cannot_determine',
                    blockingReason: 'File not mapped to any route family. Update route-families.json to include this file path.',
                    priority: 'P2',
                    userActions: [],
                });
            }
            continue;
        }

        const specs = getSpecsForFamily(specIndex, group.familyId, group.featureId);

        const promptCtx: ImpactPromptContext = {
            family,
            featureId: group.featureId,
            changedFiles: group.files,
            existingSpecs: specs,
            apiSurface,
            contextBlock,
        };

        const prompt = buildImpactPrompt(promptCtx);

        try {
            const response = await provider.generateText(prompt, {
                maxTokens: config.maxTokens || 4000,
                temperature: config.temperature ?? 0,
                timeout: config.timeout || 45000,
                systemPrompt: 'Return only valid JSON. Do not include markdown fences unless necessary.',
            });

            const parsed = parseImpactResponse(response.text);
            if (!parsed || parsed.flows.length === 0) {
                warnings.push(`Impact agent returned no flows for family ${group.familyId}.`);
                continue;
            }

            for (const flow of parsed.flows) {
                if (!flow.id || !flow.changedFiles || !Array.isArray(flow.changedFiles)) {
                    continue;
                }

                const confidence = typeof flow.confidence === 'number'
                    ? Math.max(0, Math.min(100, flow.confidence))
                    : computeConfidence({
                        hasRouteFamily: true,
                        hasSpecificRoute: Boolean(flow.route),
                        hasPageObject: Boolean(flow.pageObjects && flow.pageObjects.length > 0),
                        hasUserAction: Boolean(flow.userActions && flow.userActions.length > 0),
                        hasExistingSpecCited: false,
                    });

                const decision: FlowDecision = {
                    flowId: flow.id,
                    flowName: flow.name || flow.id,
                    routeFamily: group.familyId,
                    featureId: group.featureId,
                    specificRoute: flow.route,
                    changedFiles: flow.changedFiles.filter((f): f is string => typeof f === 'string'),
                    evidence: flow.evidence || 'AI identified this flow as impacted.',
                    evidenceSource: 'ai' as EvidenceSource,
                    confidence,
                    existingSpecs: [],
                    action: shouldForceCannotDetermine(confidence) ? 'cannot_determine' : 'run_existing',
                    blockingReason: shouldForceCannotDetermine(confidence) ? 'Confidence too low to determine action.' : undefined,
                    priority: normalizePriority(flow.priority),
                    userActions: Array.isArray(flow.userActions) ? flow.userActions.filter((a): a is string => typeof a === 'string') : [],
                };

                allDecisions.push(decision);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Impact agent failed for family ${group.familyId}: ${message}`);
        }
    }

    return {
        decisions: allDecisions,
        warnings,
        providerName: provider.name,
    };
}

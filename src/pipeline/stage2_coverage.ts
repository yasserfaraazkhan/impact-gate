// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {LLMProviderFactory} from '../provider_factory.js';
import type {LLMProvider} from '../provider_interface.js';
import {buildCoveragePrompt, parseCoverageResponse, type CoveragePromptFlow} from '../prompts/coverage.js';
import {formatContextForPrompt, loadSpecFileContent, type LoadedContext} from '../knowledge/context_loader.js';
import {getSpecsForFamily, type SpecIndex} from '../knowledge/spec_index.js';
import type {FlowDecision, CoverageLevel, FlowAction} from '../validation/output_schema.js';
import type {GenerationProfile} from '../prompts/generation_profile.js';

export interface CoverageConfig {
    provider?: string;
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
    maxSpecContentChars?: number;
    profile?: GenerationProfile;
}

export interface CoverageResult {
    decisions: FlowDecision[];
    warnings: string[];
    providerName: string;
}

const VALID_ACTIONS: FlowAction[] = ['run_existing', 'add_scenarios', 'create_spec', 'cannot_determine'];
const VALID_COVERAGE: CoverageLevel[] = ['full', 'partial', 'none'];

async function getProvider(config: CoverageConfig): Promise<LLMProvider> {
    if (config.provider && config.provider !== 'auto') {
        return LLMProviderFactory.createFromString(config.provider);
    }
    return LLMProviderFactory.createFromEnv();
}

export async function runCoverageStage(
    decisions: FlowDecision[],
    specIndex: SpecIndex,
    context: LoadedContext,
    testsRoot: string,
    config: CoverageConfig,
): Promise<CoverageResult> {
    const warnings: string[] = [];

    // Filter to only actionable decisions (not cannot_determine)
    const actionable = decisions.filter((d) => d.action !== 'cannot_determine');
    if (actionable.length === 0) {
        return {decisions, warnings, providerName: 'none'};
    }

    let provider: LLMProvider;
    try {
        provider = await getProvider(config);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Coverage agent unavailable: ${message}. Decisions will not have coverage evaluation.`);
        return {decisions, warnings, providerName: 'none'};
    }

    // Group decisions by route family for efficient prompting
    const byFamily = new Map<string, FlowDecision[]>();
    for (const d of actionable) {
        const key = d.routeFamily;
        if (!byFamily.has(key)) {
            byFamily.set(key, []);
        }
        byFamily.get(key)!.push(d);
    }

    const updatedDecisions = new Map<string, FlowDecision>();
    const contextBlock = formatContextForPrompt(context);
    const maxSpecChars = config.maxSpecContentChars || 15000;

    for (const [familyId, familyDecisions] of byFamily) {
        // Gather relevant specs
        const specs = getSpecsForFamily(specIndex, familyId);
        // Two-tier approach: send all spec titles (compact), full content for top matches only
        const allSpecSummaries = specs.map((s) => ({
            relativePath: s.relativePath,
            testTitles: s.testTitles,
        }));

        // Load full content with a total budget of 200K chars (~50K tokens) to avoid blowing context windows
        const MAX_TOTAL_SPEC_CHARS = 200000;
        let totalSpecChars = 0;
        const specsWithContent: Array<{relativePath: string; content: string; testTitles: string[]}> = [];

        for (const s of specs) {
            if (specsWithContent.length >= 30) break;
            const content = loadSpecFileContent(testsRoot, s.relativePath, maxSpecChars);
            if (!content) continue;
            if (totalSpecChars + content.length > MAX_TOTAL_SPEC_CHARS) break;
            totalSpecChars += content.length;
            specsWithContent.push({relativePath: s.relativePath, content, testTitles: s.testTitles});
        }

        if (specsWithContent.length === 0) {
            // No specs to evaluate — mark all as create_spec
            for (const d of familyDecisions) {
                updatedDecisions.set(d.flowId, {
                    ...d,
                    action: 'create_spec',
                    existingSpecs: [],
                    evidence: d.evidence + ' No existing specs found for this route family.',
                });
            }
            continue;
        }

        const flows: CoveragePromptFlow[] = familyDecisions.map((d) => ({
            flowId: d.flowId,
            flowName: d.flowName,
            route: d.specificRoute || d.routeFamily,
            userActions: d.userActions,
            evidence: d.evidence,
            priority: d.priority,
        }));

        // Include titles-only summaries for specs beyond the content limit
        const extraSummaries = allSpecSummaries
            .slice(specsWithContent.length)
            .map((s) => `  - ${s.relativePath}: ${s.testTitles.join(', ')}`)
            .join('\n');
        const extraContext = extraSummaries
            ? `\nADDITIONAL SPECS (titles only, no content loaded):\n${extraSummaries}\n`
            : '';

        const prompt = buildCoveragePrompt({
            flows,
            specs: specsWithContent,
            contextBlock: contextBlock + extraContext,
            profile: config.profile,
        });

        try {
            const response = await provider.generateText(prompt, {
                maxTokens: config.maxTokens || 4000,
                temperature: config.temperature ?? 0,
                timeout: config.timeout || 60000,
                systemPrompt: 'Return only valid JSON. Do not include markdown fences unless necessary.',
            });

            const parsed = parseCoverageResponse(response.text);
            if (!parsed || parsed.coverage.length === 0) {
                warnings.push(`Coverage agent returned no results for family ${familyId}.`);
                continue;
            }

            for (const entry of parsed.coverage) {
                const original = familyDecisions.find((d) => d.flowId === entry.flowId);
                if (!original) {
                    continue;
                }

                const action: FlowAction = VALID_ACTIONS.includes(entry.action as FlowAction)
                    ? entry.action as FlowAction
                    : 'cannot_determine';

                const existingSpecs = (entry.existingSpecs || []).map((s) => ({
                    path: s.path || '',
                    testTitles: Array.isArray(s.testTitles) ? s.testTitles.filter((t): t is string => typeof t === 'string') : [],
                    coverageLevel: (VALID_COVERAGE.includes(s.coverageLevel as CoverageLevel) ? s.coverageLevel : 'none') as CoverageLevel,
                    missingScenarios: Array.isArray(s.missingScenarios) ? s.missingScenarios.filter((t): t is string => typeof t === 'string') : undefined,
                }));

                const confidence = typeof entry.confidence === 'number'
                    ? Math.max(0, Math.min(100, entry.confidence))
                    : original.confidence;

                updatedDecisions.set(original.flowId, {
                    ...original,
                    action,
                    confidence,
                    existingSpecs,
                    targetSpec: entry.targetSpec,
                    newSpecPath: entry.newSpecPath,
                    scenariosToAdd: entry.scenariosToAdd?.filter((s): s is string => typeof s === 'string'),
                    blockingReason: entry.blockingReason,
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Coverage agent failed for family ${familyId}: ${message}`);
        }
    }

    // Merge updated decisions back
    const finalDecisions = decisions.map((d) => updatedDecisions.get(d.flowId) || d);

    return {
        decisions: finalDecisions,
        warnings,
        providerName: provider.name,
    };
}

// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {LLMProvider} from '../provider_interface.js';
import type {ImpactResult, ImpactedFeature, SpecWithScenarios} from './impact_engine.js';
import type {FeaturePriority} from '../knowledge/route_families.js';
import {formatDiffsForPrompt} from './diff_loader.js';

export interface EnrichedFeature {
    familyId: string;
    featureId?: string;
    priority: FeaturePriority;
    changedFiles: string[];
    coverageStatus: string;
    playwrightSpecs: string[];
    cypressSpecs: string[];
    userFlows: string[];
    aiReasons: string[];
    aiMissingScenarios: string[];
    aiCoveredBy: string[];
}

export interface AIEnrichmentResult {
    enrichedFeatures: EnrichedFeature[];
    unboundFileInsights: Array<{file: string; likelyFeature: string; reason: string}>;
    warnings: string[];
    providerName: string;
    tokenUsage: {input: number; output: number};
}

export interface AIEnrichmentOptions {
    deterministicImpact: ImpactResult;
    diffs: Map<string, string>;
    provider: LLMProvider;
    specList: string[];
    specDetails?: SpecWithScenarios[];
    manifestSummary?: string;
}

interface AIFlow {
    id: string;
    name: string;
    priority: string;
    reasons: string[];
    coveredBy: string[];
    missingScenarios: string[];
}

interface AIUnboundAnalysis {
    file: string;
    likelyFeature: string;
    reason: string;
}

interface AIResponse {
    impactedFlows: AIFlow[];
    unboundFileAnalysis: AIUnboundAnalysis[];
}

const MAX_SPEC_LIST = 50;

function normalizePriority(value: string): FeaturePriority {
    if (value === 'P0' || value === 'P1' || value === 'P2') {
        return value;
    }
    return 'P2';
}

const MAX_SCENARIOS_PER_SPEC = 20;

function buildPrompt(options: AIEnrichmentOptions): string {
    const {deterministicImpact, diffs, specList, specDetails, manifestSummary} = options;
    const {changedFiles, impactedFeatures, unboundFiles} = deterministicImpact;

    const lines: string[] = [];

    // Optional manifest summary
    if (manifestSummary) {
        lines.push('## Application Overview');
        lines.push(manifestSummary);
        lines.push('');
    }

    // Changed files section
    lines.push(`## Changed Files (${changedFiles.length} total)`);
    for (const f of changedFiles) {
        lines.push(`- ${f}`);
    }
    lines.push('');

    // Diffs section
    lines.push('## Code Diffs');
    lines.push(formatDiffsForPrompt(diffs));
    lines.push('');

    // Deterministic features summary
    lines.push('## Deterministic Impact Analysis');
    lines.push('The following features/flows have been deterministically identified as impacted:');
    lines.push('');
    for (const feature of impactedFeatures) {
        const featureIdPart = feature.featureId ? `featureId=${feature.featureId}` : 'featureId=undefined';
        const specCount = feature.playwrightSpecs.length + feature.cypressSpecs.length;
        const specList2 = [...feature.playwrightSpecs, ...feature.cypressSpecs];
        const specsDisplay = specList2.length > 0 ? specList2.join(', ') : 'none';
        lines.push(`- familyId=${feature.familyId} ${featureIdPart} (${feature.priority}): ${specCount} files, coverage=${feature.coverageStatus}, specs=[${specsDisplay}]`);
    }
    lines.push('');

    // Unbound files
    if (unboundFiles.length > 0) {
        lines.push('## Unbound Files (not mapped to any feature)');
        for (const f of unboundFiles) {
            lines.push(`- ${f}`);
        }
        lines.push('');
    }

    // Spec coverage with scenario titles (when available) or bare file paths
    if (specDetails && specDetails.length > 0) {
        const cappedDetails = specDetails.slice(0, MAX_SPEC_LIST);
        const totalScenarios = cappedDetails.reduce((sum, s) => sum + s.scenarios.length, 0);
        lines.push(`## Existing Test Coverage (${cappedDetails.length} specs, ${totalScenarios} scenarios)`);
        lines.push('Use this to avoid suggesting scenarios that already exist.');
        lines.push('');
        for (const spec of cappedDetails) {
            lines.push(`- ${spec.file}`);
            const cappedScenarios = spec.scenarios.slice(0, MAX_SCENARIOS_PER_SPEC);
            for (const scenario of cappedScenarios) {
                lines.push(`  • "${scenario}"`);
            }
            if (spec.scenarios.length > MAX_SCENARIOS_PER_SPEC) {
                lines.push(`  • ... and ${spec.scenarios.length - MAX_SCENARIOS_PER_SPEC} more`);
            }
        }
        lines.push('');
    } else if (specList.length > 0) {
        const cappedSpecs = specList.slice(0, MAX_SPEC_LIST);
        lines.push(`## Available Test Specs (showing ${cappedSpecs.length} of ${specList.length})`);
        for (const s of cappedSpecs) {
            lines.push(`- ${s}`);
        }
        lines.push('');
    }

    // Instructions
    lines.push('## Instructions');
    lines.push('Return ONLY valid JSON (no markdown fences, no explanation) in this exact shape:');
    lines.push('');
    lines.push('Rules for coveredBy:');
    lines.push('- Reference SPECIFIC scenario titles from the Existing Test Coverage section when possible.');
    lines.push('- Format: "file.spec.ts → scenario title"');
    lines.push('');
    lines.push('Rules for missingScenarios:');
    lines.push('- Cross-reference the scenario titles in Existing Test Coverage. If a scenario already exists that covers the behavior, do NOT suggest it — instead list it in coveredBy.');
    lines.push('- For coverage=uncovered: list all scenarios the feature needs.');
    lines.push('- For coverage=covered or coverage=partial: ONLY list scenarios introduced by THIS diff that have NO matching scenario in existing coverage. If the diff adds no new user-visible behavior, return []. Do not pad with generic scenarios.');
    lines.push('');
    lines.push(JSON.stringify({
        impactedFlows: [
            {
                id: '<featureId or familyId from the deterministic list above>',
                name: '<human-readable flow name>',
                priority: 'P0|P1|P2',
                reasons: [
                    '<EXACTLY 1-2 sentences describing user-visible behavioral impact. Focus on what a user would observe or do differently — NOT file names, NOT implementation details.>',
                ],
                coveredBy: ['<spec file paths that cover this flow>'],
                missingScenarios: ['<concrete scenario title for a new or changed behavior introduced by THIS diff. E.g. "Thread popout preserves scroll position on reload">'],
            },
        ],
        unboundFileAnalysis: [
            {
                file: '<path to unbound file>',
                likelyFeature: '<best guess at which feature/family this affects>',
                reason: '<why you think this file belongs to that feature>',
            },
        ],
    }, null, 2));

    return lines.join('\n');
}

function extractJSON(text: string): string {
    // Try markdown fenced block first
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = fenced ? [fenced[1], text] : [text];

    for (const candidate of candidates) {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return candidate.slice(start, end + 1).trim();
        }
    }

    // Fallback: return trimmed text
    return text.trim();
}

function toEnrichedFeature(det: ImpactedFeature, aiFlow?: AIFlow): EnrichedFeature {
    return {
        familyId: det.familyId,
        featureId: det.featureId,
        priority: normalizePriority(det.priority),
        changedFiles: det.changedFiles,
        coverageStatus: det.coverageStatus,
        playwrightSpecs: det.playwrightSpecs,
        cypressSpecs: det.cypressSpecs,
        userFlows: det.userFlows,
        aiReasons: aiFlow?.reasons ?? [],
        aiMissingScenarios: aiFlow?.missingScenarios ?? [],
        aiCoveredBy: aiFlow?.coveredBy ?? [],
    };
}

/**
 * Enriches a deterministic impact result with AI-generated reasons,
 * missing test scenarios, and coverage insights.
 */
export async function enrichImpactWithAI(options: AIEnrichmentOptions): Promise<AIEnrichmentResult> {
    const {deterministicImpact, provider} = options;
    const warnings: string[] = [];
    let tokenUsage = {input: 0, output: 0};

    const prompt = buildPrompt(options);

    let aiResponse: AIResponse | null = null;
    let unboundFileInsights: Array<{file: string; likelyFeature: string; reason: string}> = [];

    try {
        const response = await provider.generateText(prompt, {
            maxTokens: 4000,
            temperature: 0,
            timeout: 45000,
            systemPrompt: 'You are an expert E2E test analyst. Return only valid JSON.',
        });

        tokenUsage = {
            input: response.usage?.inputTokens ?? 0,
            output: response.usage?.outputTokens ?? 0,
        };

        const rawJSON = extractJSON(response.text);

        try {
            const parsed = JSON.parse(rawJSON) as AIResponse;

            // Validate that impactedFlows is an array
            if (!Array.isArray(parsed.impactedFlows)) {
                warnings.push('AI response parsed but impactedFlows is not an array; returning empty enrichedFeatures');
                return {
                    enrichedFeatures: [],
                    unboundFileInsights: [],
                    warnings,
                    providerName: provider.name,
                    tokenUsage,
                };
            }

            aiResponse = parsed;
            unboundFileInsights = (parsed.unboundFileAnalysis ?? []).map((item) => ({
                file: item.file,
                likelyFeature: item.likelyFeature,
                reason: item.reason,
            }));
        } catch (parseErr) {
            warnings.push(
                `Failed to parse AI response as JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
            );
            return {
                enrichedFeatures: [],
                unboundFileInsights: [],
                warnings,
                providerName: provider.name,
                tokenUsage,
            };
        }
    } catch (err) {
        warnings.push(
            `AI provider error: ${err instanceof Error ? err.message : String(err)}`,
        );
        return {
            enrichedFeatures: [],
            unboundFileInsights: [],
            warnings,
            providerName: provider.name,
            tokenUsage,
        };
    }

    // Build a map of AI flows by id (featureId or familyId)
    const aiFlowMap = new Map<string, AIFlow>();
    if (aiResponse?.impactedFlows) {
        for (const flow of aiResponse.impactedFlows) {
            aiFlowMap.set(flow.id, flow);
        }
    }

    // Build a set of all deterministic ids for unmatched-flow detection
    const deterministicIds = new Set<string>();
    for (const det of deterministicImpact.impactedFeatures) {
        if (det.featureId) {
            deterministicIds.add(det.featureId);
        }
        deterministicIds.add(det.familyId);
    }

    // Warn on AI flows that don't match any deterministic feature
    for (const flow of aiFlowMap.values()) {
        if (!deterministicIds.has(flow.id)) {
            warnings.push(`AI returned flow '${flow.id}' with no matching deterministic feature (using as-is)`);
        }
    }

    // Merge deterministic features with AI data
    const enrichedFeatures: EnrichedFeature[] = deterministicImpact.impactedFeatures.map((det) => {
        // Match by featureId first, then by familyId
        const aiFlow = det.featureId
            ? (aiFlowMap.get(det.featureId) ?? aiFlowMap.get(det.familyId))
            : aiFlowMap.get(det.familyId);
        return toEnrichedFeature(det, aiFlow);
    });

    // Include AI flows that had no deterministic match (as-is, with empty deterministic fields)
    for (const flow of aiFlowMap.values()) {
        if (!deterministicIds.has(flow.id)) {
            enrichedFeatures.push({
                familyId: flow.id,
                featureId: undefined,
                priority: normalizePriority(flow.priority),
                changedFiles: [],
                coverageStatus: 'uncovered',
                playwrightSpecs: [],
                cypressSpecs: [],
                userFlows: [],
                aiReasons: flow.reasons ?? [],
                aiMissingScenarios: flow.missingScenarios ?? [],
                aiCoveredBy: flow.coveredBy ?? [],
            });
        }
    }

    return {
        enrichedFeatures,
        unboundFileInsights,
        warnings,
        providerName: provider.name,
        tokenUsage,
    };
}

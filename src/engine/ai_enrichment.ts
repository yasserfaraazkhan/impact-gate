// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {LLMProvider} from '../provider_interface.js';
import type {ImpactResult, ImpactedFeature} from './impact_engine.js';
import {formatDiffsForPrompt} from './diff_loader.js';

export interface EnrichedFeature {
    familyId: string;
    featureId?: string;
    priority: 'P0' | 'P1' | 'P2';
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

function buildPrompt(options: AIEnrichmentOptions): string {
    const {deterministicImpact, diffs, specList, manifestSummary} = options;
    const {changedFiles, impactedFeatures, unboundFiles} = deterministicImpact;

    const lines: string[] = [];

    lines.push('You are an expert E2E test analyst. Analyze the following code changes and identify which user flows are impacted.');
    lines.push('');

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
        const label = feature.featureId ?? feature.familyId;
        const specCount = feature.playwrightSpecs.length + feature.cypressSpecs.length;
        lines.push(`- **${label}** | Priority: ${feature.priority} | Coverage: ${feature.coverageStatus} | Specs: ${specCount}`);
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

    // Spec list (capped at 50)
    if (specList.length > 0) {
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
    lines.push(JSON.stringify({
        impactedFlows: [
            {
                id: '<featureId or familyId from the deterministic list above>',
                name: '<human-readable flow name>',
                priority: 'P0|P1|P2',
                reasons: ['<specific reason why this flow is impacted by the changes>'],
                coveredBy: ['<spec file paths that cover this flow>'],
                missingScenarios: ['<specific test scenarios that are missing or should be added>'],
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
    // Strip markdown code fences if present
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
        return fenceMatch[1].trim();
    }
    return text.trim();
}

function toEnrichedFeature(det: ImpactedFeature, aiFlow?: AIFlow): EnrichedFeature {
    return {
        familyId: det.familyId,
        featureId: det.featureId,
        priority: det.priority as 'P0' | 'P1' | 'P2',
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

    // Merge deterministic features with AI data
    const enrichedFeatures: EnrichedFeature[] = deterministicImpact.impactedFeatures.map((det) => {
        // Match by featureId first, then by familyId
        const aiFlow = det.featureId
            ? (aiFlowMap.get(det.featureId) ?? aiFlowMap.get(det.familyId))
            : aiFlowMap.get(det.familyId);
        return toEnrichedFeature(det, aiFlow);
    });

    return {
        enrichedFeatures,
        unboundFileInsights,
        warnings,
        providerName: provider.name,
        tokenUsage,
    };
}

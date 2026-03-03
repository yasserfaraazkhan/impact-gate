// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import {isAbsolute, join} from 'path';
import {LLMProviderFactory} from '../provider_factory.js';
import type {FlowImpact} from './analysis.js';
import type {AIMappingImpactConfig} from './config.js';
import type {FlowCoverage, TestFile} from './tests.js';
import {normalizePath, tokenize, uniqueTokens} from './utils.js';

interface AIFlowMappingEntry {
    flowId: string;
    tests: string[];
    reason?: string;
    confidence?: number;
}

interface AIFlowMappingResponse {
    mappings: AIFlowMappingEntry[];
}

export interface AIMappingResult {
    enabled: boolean;
    used: boolean;
    provider: string;
    mappedFlows: number;
    matchedTests: number;
    coverage: FlowCoverage[];
    warnings: string[];
}

const PRIORITY_RANK: Record<string, number> = {
    P0: 0,
    P1: 1,
    P2: 2,
};

function extractJson(text: string): AIFlowMappingResponse | null {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = fenced ? [fenced[1], text] : [text];

    for (const candidate of candidates) {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start < 0 || end <= start) {
            continue;
        }
        const raw = candidate.slice(start, end + 1);
        try {
            const parsed = JSON.parse(raw) as AIFlowMappingResponse;
            if (parsed && Array.isArray(parsed.mappings)) {
                return parsed;
            }
        } catch {
            // Continue trying other candidates.
        }
    }

    return null;
}

function resolveContextFiles(appRoot: string, testsRoot: string, files: string[]): Array<{path: string; content: string}> {
    const resolved: Array<{path: string; content: string}> = [];
    const seen = new Set<string>();
    const maxCharsPerFile = 12000;
    const maxTotalChars = 30000;
    let totalChars = 0;

    for (const file of files) {
        const candidates = isAbsolute(file)
            ? [file]
            : [join(testsRoot, file), join(appRoot, file)];
        for (const candidate of candidates) {
            const normalized = normalizePath(candidate);
            if (seen.has(normalized) || !existsSync(candidate)) {
                continue;
            }
            const content = readFileSync(candidate, 'utf-8');
            const trimmed = content.trim();
            if (!trimmed) {
                seen.add(normalized);
                continue;
            }
            const remaining = Math.max(0, maxTotalChars - totalChars);
            if (remaining <= 0) {
                return resolved;
            }
            const clipped = trimmed.slice(0, Math.min(maxCharsPerFile, remaining));
            resolved.push({path: normalized, content: clipped});
            seen.add(normalized);
            totalChars += clipped.length;
            break;
        }
    }

    return resolved;
}

function flowKeywords(flow: FlowImpact): string[] {
    return uniqueTokens([
        ...tokenize(flow.id || ''),
        ...tokenize(flow.name || ''),
        ...(flow.keywords || []),
    ]).slice(0, 18);
}

function scoreTestPath(flow: FlowImpact, testPath: string): number {
    const haystack = testPath.toLowerCase();
    let score = 0;
    for (const keyword of flowKeywords(flow)) {
        if (keyword && haystack.includes(keyword.toLowerCase())) {
            score += 1;
        }
    }
    return score;
}

function selectCandidateTests(flows: FlowImpact[], tests: TestFile[], maxCandidateTests: number): string[] {
    const selected = new Map<string, number>();
    const normalizedTests = tests.map((test) => normalizePath(test.path)).filter(Boolean);
    for (const flow of flows) {
        for (const testPath of normalizedTests) {
            const score = scoreTestPath(flow, testPath);
            if (score <= 0) {
                continue;
            }
            selected.set(testPath, Math.max(selected.get(testPath) || 0, score));
        }
    }

    const scored = Array.from(selected.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, maxCandidateTests)
        .map(([path]) => path);

    if (scored.length >= Math.min(20, maxCandidateTests)) {
        return scored;
    }

    const fallback = Array.from(new Set(normalizedTests))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, maxCandidateTests);
    return fallback;
}

function buildCoverage(flows: FlowImpact[], mapped: Map<string, string[]>): FlowCoverage[] {
    return flows.map((flow) => ({
        flowId: flow.id,
        flowName: flow.name,
        priority: flow.priority,
        coveredBy: mapped.get(flow.id) || [],
        score: (mapped.get(flow.id) || []).length,
        source: 'ai',
    }));
}

function providerFor(config: AIMappingImpactConfig): string {
    if (config.provider === 'auto') {
        return 'auto';
    }
    return config.provider;
}

export async function mapAITestsToFlows(
    appRoot: string,
    testsRoot: string,
    config: AIMappingImpactConfig,
    flows: FlowImpact[],
    tests: TestFile[],
): Promise<AIMappingResult> {
    const warnings: string[] = [];
    const providerName = providerFor(config);

    if (!config.enabled) {
        return {
            enabled: false,
            used: false,
            provider: providerName,
            mappedFlows: 0,
            matchedTests: 0,
            coverage: [],
            warnings,
        };
    }

    const prioritizedFlows = [...flows]
        .sort((a, b) => {
            const prioDiff = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
            if (prioDiff !== 0) {
                return prioDiff;
            }
            return (b.score || 0) - (a.score || 0);
        })
        .slice(0, Math.max(1, config.maxFlowsPerRequest));
    const candidateTests = selectCandidateTests(prioritizedFlows, tests, Math.max(20, config.maxCandidateTests));

    if (prioritizedFlows.length === 0 || candidateTests.length === 0) {
        warnings.push('AI mapping skipped: no prioritized flows or candidate tests were available.');
        return {
            enabled: true,
            used: false,
            provider: providerName,
            mappedFlows: 0,
            matchedTests: 0,
            coverage: [],
            warnings,
        };
    }

    const contextFiles = resolveContextFiles(appRoot, testsRoot, config.contextFiles || []);
    const contextBlock = contextFiles.length > 0
        ? contextFiles.map((entry) => `### Context: ${entry.path}\n${entry.content}`).join('\n\n')
        : 'No optional markdown context files were found.';
    if (contextFiles.length === 0) {
        warnings.push('AI mapping context files were not found; continuing without optional markdown context.');
    }

    let provider;
    try {
        provider = config.provider === 'auto'
            ? await LLMProviderFactory.createFromEnv()
            : LLMProviderFactory.createFromString(config.provider);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`AI mapping unavailable (${providerName}): ${message}`);
        return {
            enabled: true,
            used: false,
            provider: providerName,
            mappedFlows: 0,
            matchedTests: 0,
            coverage: [],
            warnings,
        };
    }

    const prompt = [
        'You are an expert Mattermost E2E test impact analyst.',
        'Map impacted flows to existing Playwright test file paths.',
        'Only use tests from CANDIDATE_TESTS. Never invent paths.',
        'Return strict JSON only with this shape:',
        '{"mappings":[{"flowId":"<flow id>","tests":["specs/..."],"reason":"short reason","confidence":0.0}]}',
        '',
        'Rules:',
        '- Keep at most 5 tests per flow.',
        '- Use exact flowId values from FLOWS.',
        '- If unsure for a flow, return tests: [].',
        '',
        `FLOWS (${prioritizedFlows.length}):`,
        JSON.stringify(
            prioritizedFlows.map((flow) => ({
                flowId: flow.id,
                name: flow.name,
                priority: flow.priority,
                score: flow.score,
                files: (flow.files || []).slice(0, 5),
                keywords: flowKeywords(flow),
            })),
            null,
            2,
        ),
        '',
        `CANDIDATE_TESTS (${candidateTests.length}):`,
        JSON.stringify(candidateTests, null, 2),
        '',
        contextBlock,
    ].join('\n');

    let parsed: AIFlowMappingResponse | null = null;
    try {
        const response = await provider.generateText(prompt, {
            maxTokens: Math.max(500, config.maxTokens),
            temperature: Math.max(0, Math.min(1, config.temperature)),
            systemPrompt: 'Return only valid JSON. Do not include markdown fences unless necessary.',
        });
        parsed = extractJson(response.text);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`AI mapping request failed (${provider.name}): ${message}`);
        return {
            enabled: true,
            used: false,
            provider: provider.name,
            mappedFlows: 0,
            matchedTests: 0,
            coverage: [],
            warnings,
        };
    }

    if (!parsed) {
        warnings.push(`AI mapping returned invalid JSON (${provider.name}).`);
        return {
            enabled: true,
            used: false,
            provider: provider.name,
            mappedFlows: 0,
            matchedTests: 0,
            coverage: [],
            warnings,
        };
    }

    const allowedFlowIds = new Set(prioritizedFlows.map((flow) => flow.id));
    const allowedTests = new Set(candidateTests.map((test) => normalizePath(test)));
    const mapped = new Map<string, string[]>();
    const matchedTests = new Set<string>();

    for (const entry of parsed.mappings) {
        if (!entry || !allowedFlowIds.has(entry.flowId) || !Array.isArray(entry.tests)) {
            continue;
        }
        const valid = Array.from(
            new Set(
                entry.tests
                    .map((testPath) => normalizePath(testPath))
                    .filter((testPath) => allowedTests.has(testPath)),
            ),
        ).slice(0, 5);
        if (valid.length === 0) {
            continue;
        }
        mapped.set(entry.flowId, valid);
        for (const testPath of valid) {
            matchedTests.add(testPath);
        }
    }

    const coverage = buildCoverage(flows, mapped);
    return {
        enabled: true,
        used: mapped.size > 0,
        provider: provider.name,
        mappedFlows: mapped.size,
        matchedTests: matchedTests.size,
        coverage,
        warnings,
    };
}

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

interface CandidateTestSignal {
    path: string;
    score: number;
    matchedKeywords: string[];
}

interface CandidateSelectionResult {
    tests: string[];
    byFlow: Map<string, Set<string>>;
    evidence: Array<{flowId: string; candidates: CandidateTestSignal[]}>;
    warnings: string[];
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

const MIN_SINGLE_KEYWORD_LENGTH = 8;

const LOW_SIGNAL_FLOW_KEYWORDS = new Set([
    'app',
    'apps',
    'channel',
    'channels',
    'client',
    'common',
    'component',
    'components',
    'detail',
    'details',
    'dialog',
    'feature',
    'files',
    'flow',
    'group',
    'groups',
    'hooks',
    'message',
    'messages',
    'modal',
    'new',
    'page',
    'pages',
    'panel',
    'post',
    'posts',
    'query',
    'result',
    'results',
    'screen',
    'screens',
    'section',
    'src',
    'tsx',
    'ts',
    'jsx',
    'js',
    'ui',
    'use',
    'user',
    'users',
    'view',
    'webapp',
]);

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
    ]).filter((keyword) => (
        keyword.length >= 3 &&
        !LOW_SIGNAL_FLOW_KEYWORDS.has(keyword)
    )).slice(0, 18);
}

function matchedFlowKeywords(flow: FlowImpact, testPath: string): string[] {
    const haystack = testPath.toLowerCase();
    return flowKeywords(flow).filter((keyword) => keyword && haystack.includes(keyword.toLowerCase()));
}

function scoreTestPath(flow: FlowImpact, testPath: string): number {
    return matchedFlowKeywords(flow, testPath).length;
}

function isStrongCandidateMatch(flow: FlowImpact, matchedKeywords: string[]): boolean {
    if (matchedKeywords.length >= 2) {
        return true;
    }
    if (matchedKeywords.length !== 1) {
        return false;
    }
    const keywords = flowKeywords(flow);
    return keywords.length === 1 && matchedKeywords[0].length >= MIN_SINGLE_KEYWORD_LENGTH;
}

function selectCandidateTests(flows: FlowImpact[], tests: TestFile[], maxCandidateTests: number): CandidateSelectionResult {
    const selected = new Set<string>();
    const byFlow = new Map<string, Set<string>>();
    const evidence: Array<{flowId: string; candidates: CandidateTestSignal[]}> = [];
    const warnings: string[] = [];
    const normalizedTests = tests.map((test) => normalizePath(test.path)).filter(Boolean);
    const perFlowLimit = Math.max(2, Math.min(6, Math.floor(maxCandidateTests / Math.max(1, flows.length))));

    for (const flow of flows) {
        const scored: CandidateTestSignal[] = [];
        for (const testPath of normalizedTests) {
            const matchedKeywords = matchedFlowKeywords(flow, testPath);
            if (matchedKeywords.length === 0) {
                continue;
            }
            scored.push({
                path: testPath,
                score: matchedKeywords.length,
                matchedKeywords,
            });
        }
        const strongCandidates = scored
            .filter((candidate) => isStrongCandidateMatch(flow, candidate.matchedKeywords))
            .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
            .slice(0, perFlowLimit);
        if (strongCandidates.length === 0) {
            if (scored.length > 0) {
                warnings.push(`AI mapping withheld weak path-only candidates for ${flow.id}; traceability evidence is required to reuse existing tests.`);
            }
            continue;
        }
        byFlow.set(flow.id, new Set(strongCandidates.map((candidate) => candidate.path)));
        evidence.push({flowId: flow.id, candidates: strongCandidates});
        for (const candidate of strongCandidates) {
            selected.add(candidate.path);
        }
    }

    return {
        tests: Array.from(selected).sort((a, b) => a.localeCompare(b)).slice(0, maxCandidateTests),
        byFlow,
        evidence,
        warnings,
    };
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
    const candidateSelection = selectCandidateTests(prioritizedFlows, tests, Math.max(20, config.maxCandidateTests));
    warnings.push(...candidateSelection.warnings);
    const candidateTests = candidateSelection.tests;

    if (prioritizedFlows.length === 0 || candidateTests.length === 0) {
        warnings.push('AI mapping skipped: no prioritized flows or path-aligned candidate tests were available.');
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
        'Prefer no mapping over a broad or generic mapping.',
        'Return strict JSON only with this shape:',
        '{"mappings":[{"flowId":"<flow id>","tests":["specs/..."],"reason":"short reason","confidence":0.0}]}',
        '',
        'Rules:',
        '- Keep at most 5 tests per flow.',
        '- Use exact flowId values from FLOWS.',
        '- Only map a test when its path clearly matches the flow scenario. Generic subsystem similarity is not enough.',
        '- A flow may only map to tests listed under FLOW_CANDIDATE_SIGNALS for that flow.',
        '- Treat single-keyword or broad subsystem overlap as insufficient evidence.',
        '- If the candidate path overlap is weak or ambiguous, return tests: [].',
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
        `FLOW_CANDIDATE_SIGNALS (${candidateSelection.evidence.length}):`,
        JSON.stringify(candidateSelection.evidence, null, 2),
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
    const prioritizedFlowsById = new Map(prioritizedFlows.map((flow) => [flow.id, flow]));
    const mapped = new Map<string, string[]>();
    const matchedTests = new Set<string>();

    for (const entry of parsed.mappings) {
        if (!entry || !allowedFlowIds.has(entry.flowId) || !Array.isArray(entry.tests)) {
            continue;
        }
        const flow = prioritizedFlowsById.get(entry.flowId);
        const confidence = typeof entry.confidence === 'number' ? entry.confidence : undefined;
        const allowedTestsForFlow = candidateSelection.byFlow.get(entry.flowId);
        const valid = Array.from(
            new Set(
                entry.tests
                    .map((testPath) => normalizePath(testPath))
                    .filter((testPath) => allowedTestsForFlow?.has(testPath))
                    .filter((testPath) => (flow ? scoreTestPath(flow, testPath) > 0 : true)),
            ),
        ).slice(0, 5);
        if (confidence !== undefined && confidence < 0.5) {
            warnings.push(`AI mapping rejected low-confidence result for ${entry.flowId} (${confidence}).`);
            continue;
        }
        if (valid.length === 0) {
            continue;
        }
        mapped.set(entry.flowId, valid);
        for (const testPath of valid) {
            matchedTests.add(testPath);
        }
    }

    const coverage = buildCoverage(flows, mapped);
    if (mapped.size === 0) {
        warnings.push(`AI mapping returned no valid test mappings (${provider.name}).`);
    }
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

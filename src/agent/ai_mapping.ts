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
    missingScenarios?: string[];
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

const MIN_SINGLE_KEYWORD_LENGTH = 6;

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

// Stop-words excluded from content-fallback keyword matching.
const CONTENT_FALLBACK_STOP_WORDS = new Set(['and', 'for', 'the', 'to', 'of', 'on', 'at', 'with', 'in', 'a', 'an']);

// Returns raw (unfiltered) tokens for flows where flowKeywords() returns nothing.
// Used exclusively for content-title matching when all standard keywords are low-signal.
// Empty array is returned when the flow already has effective path keywords.
function contentFallbackKeywords(flow: FlowImpact): string[] {
    if (flowKeywords(flow).length > 0) {
        return [];
    }
    return uniqueTokens([
        ...tokenize(flow.id || ''),
        ...tokenize(flow.name || ''),
        ...(flow.keywords || []),
    ]).filter((k) => k.length >= 3 && !CONTENT_FALLBACK_STOP_WORDS.has(k));
}

// Extract test/describe/it title strings from file content for semantic matching.
function extractTestTitles(content: string): string {
    const titles: string[] = [];
    const pattern = /(?:^|\s)(?:test|it|describe)\s*\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/gm;
    let match;
    while ((match = pattern.exec(content)) !== null) {
        const title = match[1] ?? match[2] ?? match[3];
        if (title) {
            titles.push(title);
        }
    }
    return titles.join(' ');
}

function matchedFlowKeywordsInTitles(flow: FlowImpact, testContent: string): string[] {
    const haystack = extractTestTitles(testContent).toLowerCase();
    if (!haystack) {
        return [];
    }
    return flowKeywords(flow).filter((keyword) => keyword && haystack.includes(keyword.toLowerCase()));
}

function selectCandidateTests(flows: FlowImpact[], tests: TestFile[], maxCandidateTests: number): CandidateSelectionResult {
    const selected = new Set<string>();
    const byFlow = new Map<string, Set<string>>();
    const evidence: Array<{flowId: string; candidates: CandidateTestSignal[]}> = [];
    const warnings: string[] = [];
    const normalizedTests = tests.map((test) => normalizePath(test.path)).filter(Boolean);
    const testByNormalizedPath = new Map(tests.map((t) => [normalizePath(t.path), t]));
    const perFlowLimit = Math.max(2, Math.min(6, Math.floor(maxCandidateTests / Math.max(1, flows.length))));

    for (const flow of flows) {
        // Pass 1: path-keyword matching
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

        // Pass 2: content-title matching
        // For flows without enough path-matched candidates, also search test/describe/it
        // title strings for flow keywords. This surfaces semantically related tests even
        // when the file name does not match the flow (e.g. a search.spec.ts with a test
        // titled "search for message in channel" covers search_messages).
        const contentCandidates: CandidateTestSignal[] = [];
        if (strongCandidates.length < perFlowLimit) {
            const alreadyByPath = new Set(strongCandidates.map((c) => c.path));
            for (const testPath of normalizedTests) {
                if (alreadyByPath.has(testPath)) {
                    continue;
                }
                const testFile = testByNormalizedPath.get(testPath);
                if (!testFile?.content) {
                    continue;
                }
                const titleKeywords = matchedFlowKeywordsInTitles(flow, testFile.content);
                if (!isStrongCandidateMatch(flow, titleKeywords)) {
                    continue;
                }
                // Score content matches lower than path matches so path candidates rank higher.
                contentCandidates.push({
                    path: testPath,
                    score: titleKeywords.length,
                    matchedKeywords: titleKeywords,
                });
            }
            contentCandidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
        }

        // Pass 2b: comprehensive fallback for all-low-signal flows.
        // When flowKeywords() is empty (all tokens are low-signal), flowKeywords-based
        // matching in both Pass 1 and Pass 2 yields nothing. As a last resort, search
        // test titles using the raw unfiltered tokens from the flow ID/name, but require
        // ALL tokens to match simultaneously — they are individually weak signals so the
        // full conjunction is needed to establish behavioral coverage evidence.
        const fallbackCandidates: CandidateTestSignal[] = [];
        if (strongCandidates.length === 0 && contentCandidates.length === 0) {
            const fallbackKws = contentFallbackKeywords(flow);
            if (fallbackKws.length > 0) {
                for (const testPath of normalizedTests) {
                    const testFile = testByNormalizedPath.get(testPath);
                    if (!testFile?.content) {
                        continue;
                    }
                    const haystack = extractTestTitles(testFile.content).toLowerCase();
                    if (!haystack) {
                        continue;
                    }
                    const matched = fallbackKws.filter((k) => haystack.includes(k));
                    if (matched.length < fallbackKws.length) {
                        continue; // all tokens must appear in at least one test title
                    }
                    fallbackCandidates.push({path: testPath, score: matched.length, matchedKeywords: matched});
                }
                fallbackCandidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
            }
        }

        const allCandidates = [
            ...strongCandidates,
            ...contentCandidates.slice(0, perFlowLimit),
            ...fallbackCandidates.slice(0, perFlowLimit),
        ];

        if (allCandidates.length === 0) {
            // Exact-name fallback: if the flow ID has no effective keywords (all tokens are
            // low-signal, e.g. view_user_group_modal), look for a test whose path contains
            // the exact flow ID as a directory name or filename without extension.
            const exactMatchPath = normalizedTests.find((testPath) => {
                const segments = testPath.split('/');
                return segments.some(
                    (seg) => seg === flow.id || seg.replace(/\.spec\.[tj]sx?$/, '') === flow.id,
                );
            });
            if (exactMatchPath) {
                byFlow.set(flow.id, new Set([exactMatchPath]));
                evidence.push({flowId: flow.id, candidates: [{path: exactMatchPath, score: 999, matchedKeywords: [flow.id]}]});
                selected.add(exactMatchPath);
            } else if (scored.length > 0) {
                warnings.push(`AI mapping withheld weak path-only candidates for ${flow.id}; traceability evidence is required to reuse existing tests.`);
            }
            continue;
        }
        byFlow.set(flow.id, new Set(allCandidates.map((candidate) => candidate.path)));
        evidence.push({flowId: flow.id, candidates: allCandidates});
        for (const candidate of allCandidates) {
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

function readCandidateTestContents(testsRoot: string, testPaths: string[]): Array<{path: string; content: string}> {
    const result: Array<{path: string; content: string}> = [];
    const maxCharsPerFile = 6000;
    const maxTotalChars = 24000;
    let totalChars = 0;
    for (const testPath of testPaths.slice(0, 6)) {
        if (totalChars >= maxTotalChars) {
            break;
        }
        const candidates = isAbsolute(testPath) ? [testPath] : [join(testsRoot, testPath)];
        for (const fullPath of candidates) {
            if (!existsSync(fullPath)) {
                continue;
            }
            const content = readFileSync(fullPath, 'utf-8').trim();
            if (!content) {
                continue;
            }
            const remaining = Math.max(0, maxTotalChars - totalChars);
            const clipped = content.slice(0, Math.min(maxCharsPerFile, remaining));
            result.push({path: testPath, content: clipped});
            totalChars += clipped.length;
            break;
        }
    }
    return result;
}

function buildCoverage(flows: FlowImpact[], mapped: Map<string, string[]>, scenarioGaps: Map<string, string[]>): FlowCoverage[] {
    return flows.map((flow) => ({
        flowId: flow.id,
        flowName: flow.name,
        priority: flow.priority,
        coveredBy: mapped.get(flow.id) || [],
        score: (mapped.get(flow.id) || []).length,
        source: 'ai',
        missingScenarios: scenarioGaps.get(flow.id) || [],
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

    // Read candidate test file contents so the AI can reason about what scenarios
    // are already covered and which ones are still missing.
    const candidateTestContents = readCandidateTestContents(testsRoot, candidateTests);
    const testContentBlock = candidateTestContents.length > 0
        ? candidateTestContents.map((entry) => `### Test: ${entry.path}\n\`\`\`typescript\n${entry.content}\n\`\`\``).join('\n\n')
        : 'No candidate test file contents could be read.';

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
        '{"mappings":[{"flowId":"<flow id>","tests":["specs/..."],"reason":"short reason","confidence":0.0,"missingScenarios":["scenario description"]}]}',
        '',
        'Rules:',
        '- Keep at most 5 tests per flow.',
        '- Use exact flowId values from FLOWS.',
        '- Map a test when you have clear evidence it covers the flow — from the file path OR from test titles in the content. Behavioral coverage via test titles is sufficient even when the filename does not exactly match the flow (e.g. search_user_post_spec.js covers search_messages if its titles assert searching for messages). Generic subsystem similarity without behavioral evidence is not enough.',
        '- A flow may only map to tests listed under FLOW_CANDIDATE_SIGNALS for that flow.',
        '- Treat single-keyword or broad subsystem overlap as insufficient evidence.',
        '- If the candidate path overlap is weak or ambiguous, return tests: [].',
        '- If unsure for a flow, return tests: [].',
        '- For EVERY flow (whether or not tests were found), return missingScenarios with 3-5 key user-facing test scenarios that must be covered. Write each as a short imperative statement starting with a verb (e.g. "Search for a message by keyword and verify results appear"). For mapped flows, focus on what the existing tests do NOT cover; for unmapped flows, describe the core scenarios a new test should include.',
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
        `CANDIDATE_TEST_CONTENT (${candidateTestContents.length} file(s)):`,
        testContentBlock,
        '',
        contextBlock,
    ].join('\n');

    let parsed: AIFlowMappingResponse | null = null;
    try {
        const response = await provider.generateText(prompt, {
            maxTokens: Math.max(500, config.maxTokens),
            temperature: Math.max(0, Math.min(1, config.temperature)),
            timeout: 45_000,
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
    const scenarioGaps = new Map<string, string[]>();
    const matchedTests = new Set<string>();

    for (const entry of parsed.mappings) {
        if (!entry || !allowedFlowIds.has(entry.flowId) || !Array.isArray(entry.tests)) {
            continue;
        }

        // Capture scenario suggestions for ALL flows up-front — before any early returns —
        // so unmapped flows (tests: []) still get their suggested scenarios in the gap report.
        if (Array.isArray(entry.missingScenarios) && entry.missingScenarios.length > 0) {
            const scenarios = entry.missingScenarios
                .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
                .slice(0, 5);
            if (scenarios.length > 0) {
                scenarioGaps.set(entry.flowId, scenarios);
            }
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

    // Post-AI exact-name fallback: for any flow still uncovered, search all test paths
    // for a file or directory whose name exactly matches the flow ID. This handles flows
    // whose keywords are all low-signal (e.g. view_user_group_modal) but whose test file
    // is named after the flow and is therefore unambiguous coverage evidence.
    const allNormalizedTests = tests.map((t) => normalizePath(t.path)).filter(Boolean);
    for (const flow of prioritizedFlows) {
        if (mapped.has(flow.id)) {
            continue;
        }
        const exactMatch = allNormalizedTests.find((testPath) => {
            const segments = testPath.split('/');
            return segments.some(
                (seg) => seg === flow.id || seg.replace(/\.spec\.[tj]sx?$/, '') === flow.id,
            );
        });
        if (exactMatch) {
            mapped.set(flow.id, [exactMatch]);
            matchedTests.add(exactMatch);
        }
    }

    const coverage = buildCoverage(flows, mapped, scenarioGaps);
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

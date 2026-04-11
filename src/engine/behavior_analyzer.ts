// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Behavior Analyzer
 *
 * Extracts user-visible behavior changes from a git diff and maps them to
 * test recommendations. This is the core of shift-left QA: telling developers
 * exactly what user flows their code touches and which tests to write.
 *
 * All deterministic. No LLM. Zero cost.
 *
 * Four stages:
 *   1. extractBehaviorSignals — parse diffs for user-visible changes
 *   2. matchSignalsToFlows — connect signals to manifest userFlows
 *   3. findRelevantTests — find existing tests covering affected flows
 *   4. generateRecommendations — produce specific test scenario suggestions
 */

import {basename, dirname} from 'path';
import {existsSync, readdirSync} from 'fs';

import {extractScenarios} from './impact_engine.js';
import type {ImpactResult, ImpactedFeature, PrTestFile} from './impact_engine.js';
import {camelCaseToFlow, componentNameToFlow, isSimilarFlow} from '../training/flow_inferrer.js';
import type {RouteFamilyManifest} from '../knowledge/route_families.js';

// ─── Types ───

export type BehaviorSignalType =
    | 'ui-change'
    | 'api-change'
    | 'websocket-change'
    | 'selector-change'
    | 'migration-change'
    | 'permission-change'
    | 'config-change'
    | 'test-added';

export interface BehaviorSignal {
    type: BehaviorSignalType;
    description: string;
    sourceFile: string;
    component?: string;
    handler?: string;
    event?: string;
    confidence: number;
}

export interface RelevantTest {
    file: string;
    scenarios: string[];
    matchReason: 'manifest' | 'title-match' | 'adjacency' | 'pr-included';
    relevanceScore: number;
}

export interface TestRecommendation {
    scenario: string;
    priority: 'P0' | 'P1' | 'P2';
    rationale: string;
    dimension?: 'persistence' | 'cross-role' | 'error-case' | 'cross-user' | 'core-flow';
    alreadyCoveredBy?: string;
}

export interface BehaviorAnalysisResult {
    signals: BehaviorSignal[];
    behaviorSummary: string[];
    relevantTests: RelevantTest[];
    prIncludedTests: RelevantTest[];
    recommendations: TestRecommendation[];
}

// ─── Behavior rules (regex-based diff classification) ───

interface BehaviorRule {
    filePattern: RegExp;
    diffPattern?: RegExp;
    type: BehaviorSignalType;
    descriptionFn: (file: string, match?: RegExpMatchArray) => string;
    confidence: number;
}

const BEHAVIOR_RULES: BehaviorRule[] = [
    // React component additions (JSX tags in diff)
    {
        filePattern: /\.(tsx|jsx)$/,
        diffPattern: /^\+.*<([A-Z][A-Za-z]+)/m,
        type: 'ui-change',
        descriptionFn: (file, match) => {
            const component = match?.[1] || basename(file, '.tsx').replace(/_/g, ' ');
            const context = basename(dirname(file)).replace(/_/g, ' ');
            return `New UI: ${component} in ${context}`;
        },
        confidence: 0.8,
    },
    // React component modifications (changed props, state, rendering)
    {
        filePattern: /\.(tsx|jsx)$/,
        diffPattern: /^\+.*(?:useState|useEffect|useSelector|className|onClick|onChange)/m,
        type: 'ui-change',
        descriptionFn: (file) => {
            const component = basename(file).replace(/\.(tsx|jsx)$/, '').replace(/_/g, ' ');
            return `UI behavior changed: ${component}`;
        },
        confidence: 0.6,
    },
    // Go API handler additions
    {
        filePattern: /\.go$/,
        diffPattern: /^\+func\s+\([^)]+\)\s+([a-zA-Z][a-zA-Z0-9]+)\s*\(/m,
        type: 'api-change',
        descriptionFn: (_file, match) => {
            const handler = match?.[1] || 'unknown handler';
            return camelCaseToFlow(handler);
        },
        confidence: 0.9,
    },
    // Go route registration
    {
        filePattern: /\.go$/,
        diffPattern: /^\+.*\.Handle\(.*"([^"]+)".*Methods\(.*"(GET|POST|PUT|PATCH|DELETE)"/m,
        type: 'api-change',
        descriptionFn: (_file, match) => {
            const method = match?.[2] || 'API';
            const route = match?.[1] || 'endpoint';
            return `New ${method} endpoint: ${route}`;
        },
        confidence: 0.9,
    },
    // WebSocket event additions
    {
        filePattern: /websocket|ws_/i,
        diffPattern: /^\+.*(?:WebsocketEvent|WEBSOCKET_EVENT|websocket.*event|\.event\s*=)/m,
        type: 'websocket-change',
        descriptionFn: (file) => {
            const context = basename(file).replace(/\.(ts|tsx|go|js)$/, '').replace(/_/g, ' ');
            return `WebSocket event changed: ${context} (may affect real-time sync)`;
        },
        confidence: 0.8,
    },
    // WebSocket handler in webapp
    {
        filePattern: /websocket_actions\.(ts|tsx|js)$/,
        diffPattern: /^\+/m,
        type: 'websocket-change',
        descriptionFn: () => 'Real-time event handling updated (WebSocket actions)',
        confidence: 0.7,
    },
    // Redux selector changes
    {
        filePattern: /selectors?\//,
        diffPattern: /^\+.*(?:createSelector|export function|export const)/m,
        type: 'selector-change',
        descriptionFn: (file) => {
            const domain = basename(file).replace(/\.(ts|js)$/, '').replace(/_/g, ' ');
            return `State selection logic changed: ${domain}`;
        },
        confidence: 0.6,
    },
    // Redux reducer/action changes
    {
        filePattern: /(?:reducers?|actions)\//,
        diffPattern: /^\+.*(?:case\s+'|createSlice|dispatch|action)/m,
        type: 'selector-change',
        descriptionFn: (file) => {
            const domain = basename(file).replace(/\.(ts|js)$/, '').replace(/_/g, ' ');
            return `State management changed: ${domain}`;
        },
        confidence: 0.6,
    },
    // Migration files
    {
        filePattern: /migration/i,
        diffPattern: /^\+/m,
        type: 'migration-change',
        descriptionFn: () => 'Database schema migration added (data persistence changed)',
        confidence: 0.5,
    },
    // Permission/role changes
    {
        filePattern: /\.go$/,
        diffPattern: /^\+.*(?:Permission|HasPermission|SessionHasPermission|PermissionManage)/m,
        type: 'permission-change',
        descriptionFn: () => 'Permission or authorization logic changed',
        confidence: 0.8,
    },
    // Config changes
    {
        filePattern: /config\.(ts|go|js)$/,
        diffPattern: /^\+/m,
        type: 'config-change',
        descriptionFn: (file) => {
            const lang = file.endsWith('.go') ? 'server' : 'client';
            return `Configuration option changed (${lang}-side)`;
        },
        confidence: 0.5,
    },
    // New test files
    {
        filePattern: /\.(spec|test)\.(ts|tsx|js|jsx|go)$/,
        diffPattern: /^\+.*(?:test\(|it\(|describe\(|func Test)/m,
        type: 'test-added',
        descriptionFn: (file) => {
            const name = basename(file).replace(/\.(spec|test)\.(ts|tsx|js|jsx|go)$/, '').replace(/_/g, ' ');
            return `Test added: ${name}`;
        },
        confidence: 1.0,
    },
];

// ─── Stage 1: Extract behavior signals ───

/**
 * Parse diffs to extract user-visible behavior changes.
 */
export function extractBehaviorSignals(diffs: Map<string, string>): BehaviorSignal[] {
    const signals: BehaviorSignal[] = [];

    for (const [file, diff] of diffs) {
        for (const rule of BEHAVIOR_RULES) {
            if (!rule.filePattern.test(file)) continue;
            if (rule.diffPattern && !rule.diffPattern.test(diff)) continue;

            const match = rule.diffPattern ? diff.match(rule.diffPattern) : undefined;
            const description = rule.descriptionFn(file, match || undefined);

            // Deduplicate: don't add signals with very similar descriptions
            if (!signals.some((s) => isSimilarFlow(s.description, description))) {
                signals.push({
                    type: rule.type,
                    description,
                    sourceFile: file,
                    component: rule.type === 'ui-change' ? match?.[1] : undefined,
                    handler: rule.type === 'api-change' ? match?.[1] : undefined,
                    confidence: rule.confidence,
                });
            }
        }

        // Fallback: if no rules matched, infer from file path
        if (!signals.some((s) => s.sourceFile === file)) {
            const ext = file.split('.').pop() || '';
            if (['ts', 'tsx', 'js', 'jsx', 'go', 'py'].includes(ext)) {
                const name = basename(file).replace(/\.[^.]+$/, '');
                const flow = name.includes('_') ? componentNameToFlow(name) : camelCaseToFlow(name);
                if (flow.length > 3) {
                    signals.push({
                        type: 'ui-change',
                        description: flow,
                        sourceFile: file,
                        confidence: 0.3,
                    });
                }
            }
        }
    }

    // Sort by confidence descending
    signals.sort((a, b) => b.confidence - a.confidence);

    return signals;
}

// ─── Stage 2: Match signals to flows ───

/**
 * Connect behavior signals to the manifest's userFlows.
 */
export function matchSignalsToFlows(
    signals: BehaviorSignal[],
    impact: ImpactResult,
    manifest: RouteFamilyManifest | null,
): string[] {
    const flowDescriptions: string[] = [];

    // Collect userFlows from impacted families
    if (manifest) {
        for (const feature of impact.impactedFeatures) {
            const family = manifest.families.find((f) => f.id === feature.familyId);
            if (family?.userFlows) {
                for (const flow of family.userFlows) {
                    // Only include flows that relate to the behavioral signals
                    if (signals.some((s) => isSimilarFlow(s.description, flow))) {
                        if (!flowDescriptions.some((f) => isSimilarFlow(f, flow))) {
                            flowDescriptions.push(flow);
                        }
                    }
                }
            }
        }
    }

    // Add signal descriptions as flows (deduplicated against manifest flows)
    for (const signal of signals) {
        if (signal.confidence >= 0.5 && signal.type !== 'test-added' && signal.type !== 'migration-change') {
            if (!flowDescriptions.some((f) => isSimilarFlow(f, signal.description))) {
                flowDescriptions.push(signal.description);
            }
        }
    }

    return flowDescriptions.slice(0, 10);
}

// ─── Stage 3: Find relevant tests ───

/**
 * Find existing tests that cover the affected flows.
 */
export function findRelevantTests(
    signals: BehaviorSignal[],
    impact: ImpactResult,
    testsRoot: string,
): {existing: RelevantTest[]; prIncluded: RelevantTest[]} {
    const existing: RelevantTest[] = [];
    const prIncluded: RelevantTest[] = [];
    const seen = new Set<string>();

    // Source 1: PR-included test files (from impact engine's filteredTestFiles)
    for (const prTest of impact.prIncludedTestFiles) {
        if (prTest.type === 'playwright' || prTest.type === 'cypress') {
            const absPath = prTest.file.startsWith('/') ? prTest.file : `${testsRoot}/${prTest.file}`;
            const scenarios = extractScenarios(absPath, prTest.type === 'playwright' ? 'playwright' : 'cypress');
            prIncluded.push({
                file: prTest.file,
                scenarios,
                matchReason: 'pr-included',
                relevanceScore: 1.0,
            });
            seen.add(prTest.file);
        }
    }

    // Source 2: Manifest-bound tests (from impacted features)
    for (const feature of impact.impactedFeatures) {
        for (const spec of [...feature.playwrightSpecs, ...feature.cypressSpecs]) {
            if (!seen.has(spec)) {
                seen.add(spec);
                existing.push({
                    file: spec,
                    scenarios: [],
                    matchReason: 'manifest',
                    relevanceScore: 0.8,
                });
            }
        }
    }

    // Source 3: Adjacent test files (same directory as changed source files)
    for (const signal of signals) {
        if (signal.type === 'test-added') continue;
        const dir = dirname(signal.sourceFile);
        const baseName = basename(signal.sourceFile).replace(/\.[^.]+$/, '');

        const testPatterns = [
            `${baseName}.test.tsx`, `${baseName}.test.ts`, `${baseName}.test.js`,
            `${baseName}.spec.tsx`, `${baseName}.spec.ts`, `${baseName}.spec.js`,
        ];

        for (const pattern of testPatterns) {
            const testPath = `${dir}/${pattern}`;
            const fullPath = `${testsRoot}/${testPath}`;
            if (existsSync(fullPath) && !seen.has(testPath)) {
                seen.add(testPath);
                existing.push({
                    file: testPath,
                    scenarios: [],
                    matchReason: 'adjacency',
                    relevanceScore: 0.6,
                });
            }
        }

        // Check __tests__ directory
        const testsDir = `${dir}/__tests__`;
        const fullTestsDir = `${testsRoot}/${testsDir}`;
        if (existsSync(fullTestsDir)) {
            try {
                for (const entry of readdirSync(fullTestsDir)) {
                    if (entry.includes(baseName) && !seen.has(`${testsDir}/${entry}`)) {
                        seen.add(`${testsDir}/${entry}`);
                        existing.push({
                            file: `${testsDir}/${entry}`,
                            scenarios: [],
                            matchReason: 'adjacency',
                            relevanceScore: 0.5,
                        });
                    }
                }
            } catch {
                // Directory not readable
            }
        }
    }

    // Sort by relevance
    existing.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return {existing: existing.slice(0, 10), prIncluded};
}

// ─── Stage 4: Generate recommendations ───

/**
 * Generate specific, actionable test scenario recommendations.
 */
export function generateRecommendations(
    signals: BehaviorSignal[],
    prTests: RelevantTest[],
    existingTests: RelevantTest[],
): TestRecommendation[] {
    const recommendations: TestRecommendation[] = [];
    const allTestScenarios = [...prTests, ...existingTests]
        .flatMap((t) => t.scenarios)
        .map((s) => s.toLowerCase());

    // Collect signal types for dimension expansion
    const hasWebSocket = signals.some((s) => s.type === 'websocket-change');
    const hasPermission = signals.some((s) => s.type === 'permission-change');
    const hasUIChange = signals.some((s) => s.type === 'ui-change');
    const hasAPIChange = signals.some((s) => s.type === 'api-change');

    // Core flow recommendations from high-confidence signals
    for (const signal of signals) {
        if (signal.confidence < 0.5 || signal.type === 'test-added') continue;

        const scenario = signalToScenario(signal);
        if (!scenario) continue;

        // Check if already covered
        const covered = allTestScenarios.some((s) => isSimilarFlow(s, scenario));
        const coveredBy = covered
            ? [...prTests, ...existingTests].find((t) => t.scenarios.some((s) => isSimilarFlow(s.toLowerCase(), scenario.toLowerCase())))?.file
            : undefined;

        if (!recommendations.some((r) => isSimilarFlow(r.scenario, scenario))) {
            recommendations.push({
                scenario,
                priority: signal.confidence >= 0.8 ? 'P0' : 'P1',
                rationale: `Behavior change in ${basename(signal.sourceFile)}`,
                dimension: 'core-flow',
                alreadyCoveredBy: coveredBy,
            });
        }
    }

    // Dimension expansion: cross-user sync
    if (hasWebSocket && !allTestScenarios.some((s) => s.includes('sync') || s.includes('other user') || s.includes('websocket'))) {
        recommendations.push({
            scenario: 'Changes sync to other connected users via WebSocket',
            priority: 'P1',
            rationale: 'WebSocket events changed but no cross-user sync test exists',
            dimension: 'cross-user',
        });
    }

    // Dimension expansion: permission/role
    if (hasPermission && !allTestScenarios.some((s) => s.includes('permission') || s.includes('admin') || s.includes('role'))) {
        recommendations.push({
            scenario: 'Non-admin users see appropriate access restrictions',
            priority: 'P1',
            rationale: 'Permission logic changed but no cross-role test exists',
            dimension: 'cross-role',
        });
    }

    // Dimension expansion: persistence
    if (hasUIChange && hasAPIChange && !allTestScenarios.some((s) => s.includes('reload') || s.includes('persist') || s.includes('refresh'))) {
        recommendations.push({
            scenario: 'Changes persist after page reload',
            priority: 'P1',
            rationale: 'UI + API changed but no persistence test exists',
            dimension: 'persistence',
        });
    }

    // Dimension expansion: error handling
    if (hasAPIChange && !allTestScenarios.some((s) => s.includes('error') || s.includes('fail') || s.includes('invalid'))) {
        recommendations.push({
            scenario: 'API returns appropriate error for invalid input',
            priority: 'P2',
            rationale: 'New API behavior but no error case test',
            dimension: 'error-case',
        });
    }

    return recommendations;
}

/** Convert a behavior signal to a test scenario description */
function signalToScenario(signal: BehaviorSignal): string | null {
    switch (signal.type) {
    case 'ui-change':
        return `${signal.description} renders correctly and is interactive`;
    case 'api-change':
        return signal.description;
    case 'websocket-change':
        return `${signal.description} delivers to connected clients`;
    case 'selector-change':
        return `UI updates correctly when ${signal.description.toLowerCase()}`;
    case 'permission-change':
        return 'Users with appropriate roles can access the feature';
    case 'config-change':
        return 'Feature behavior changes based on configuration toggle';
    default:
        return null;
    }
}

// ─── Top-level entry point ───

/**
 * Run the full behavior analysis pipeline.
 */
export function analyzeBehavior(
    diffs: Map<string, string>,
    impact: ImpactResult,
    manifest: RouteFamilyManifest | null,
    testsRoot: string,
): BehaviorAnalysisResult {
    // Stage 1: Extract signals from diffs
    const signals = extractBehaviorSignals(diffs);

    // Stage 2: Build behavior summary
    const behaviorSummary = matchSignalsToFlows(signals, impact, manifest);

    // Stage 3: Find tests
    const {existing: relevantTests, prIncluded: prIncludedTests} = findRelevantTests(signals, impact, testsRoot);

    // Stage 4: Generate recommendations
    const recommendations = generateRecommendations(signals, prIncludedTests, relevantTests);

    return {signals, behaviorSummary, relevantTests, prIncludedTests, recommendations};
}

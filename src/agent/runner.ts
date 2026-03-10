// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, writeFileSync} from 'fs';
import {join} from 'path';
import type {AgentConfig} from './config.js';
import {analyzeFiles, isTestFilePath, scanRepositoryFlows, type FlowImpact, type FlowPriority} from './analysis.js';
import {applyBlastRadius} from './blast_radius.js';
import {detectFramework, resolveTestPatterns} from './framework.js';
import {getChangedFiles} from './git.js';
import {writeReport} from './report.js';
import {formatFlags} from './flags.js';
import {applyDataTestIdSuggestions, findDataTestIdSuggestions, type DataTestIdSuggestion} from './selectors.js';
import {discoverTests, mapCatalogTestsToFlows, mapTestsToFlows, type FlowCoverage} from './tests.js';
import {generateTests} from './generator.js';
import {loadFlowCatalog} from './flow_catalog.js';
import {mapChangesToCatalogFlows} from './flow_mapping.js';
import {runPlaywrightPipeline, type PipelineSummary} from './pipeline.js';
import {buildGapTestSuggestions, type GapTestSuggestion} from './gap_suggestions.js';
import {expandByDependencyGraph, type DependencyGraphExpansion} from './dependency_graph.js';
import {mapTraceabilityToFlows, type TraceabilityStats} from './traceability.js';
import {normalizePath} from './utils.js';
import {mapAITestsToFlows} from './ai_mapping.js';
import {mapAIFlowsFromFiles} from './ai_flow_analysis.js';

const PRIORITY_RANK: Record<FlowPriority, number> = {
    P0: 0,
    P1: 1,
    P2: 2,
};

function ensureAppRoot(path: string): void {
    if (!existsSync(path)) {
        throw new Error(`App path does not exist: ${path}`);
    }
}

function computeGaps(flows: FlowImpact[], coverageMap: Map<string, string[]>): FlowImpact[] {
    return flows.filter((flow) => {
        if (flow.priority !== 'P0' && flow.priority !== 'P1') {
            return false;
        }
        const coveredBy = coverageMap.get(flow.id) || [];
        return coveredBy.length === 0;
    });
}

function normalizeChangedFiles(appRoot: string, files: string[]): string[] {
    const normalizedRoot = appRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    const baseName = normalizedRoot.split('/').pop() || '';
    return files
        .map((file) => file.replace(/\\/g, '/'))
        .map((file) => {
            if (baseName && file.startsWith(`${baseName}/`)) {
                return file.slice(baseName.length + 1);
            }
            return file;
        });
}

function sortFlows(flows: FlowImpact[]): FlowImpact[] {
    const priorityRank: Record<string, number> = {P0: 0, P1: 1, P2: 2};
    return [...flows].sort((a, b) => {
        const rankDiff = (priorityRank[a.priority] ?? 3) - (priorityRank[b.priority] ?? 3);
        if (rankDiff !== 0) {
            return rankDiff;
        }
        return b.score - a.score;
    });
}

function applyPriorityThresholds(flows: FlowImpact[], config: AgentConfig): FlowImpact[] {
    return flows.map((flow) => {
        const priority: FlowPriority =
            flow.score >= config.risk.p0Threshold
                ? 'P0'
                : flow.score >= config.risk.p1Threshold
                  ? 'P1'
                  : 'P2';
        const boundedPriority = flow.priorityFloor && PRIORITY_RANK[flow.priorityFloor] < PRIORITY_RANK[priority]
            ? flow.priorityFloor
            : priority;
        return {...flow, priority: boundedPriority};
    });
}

function buildRecommendedTestsWithFlags(flows: FlowImpact[], testsByFlow: Map<string, string[]>): string[] {
    const testNotes = new Map<string, Set<string>>();

    for (const flow of flows) {
        if (flow.priority !== 'P0' && flow.priority !== 'P1') {
            continue;
        }
        const tests = testsByFlow.get(flow.id) || [];
        const flagSummary = formatFlags(flow.flags || []);
        for (const test of tests) {
            const normalizedTest = normalizePath(test)
                .replace(/^\.\//, '')
                .replace(/^e2e-tests\/playwright\//, '');
            if (!testNotes.has(normalizedTest)) {
                testNotes.set(normalizedTest, new Set());
            }
            if (flagSummary !== 'none') {
                testNotes.get(normalizedTest)?.add(flagSummary);
            }
        }
    }

    return Array.from(testNotes.entries())
        .map(([test, notes]) => {
            if (notes.size === 0) {
                return test;
            }
            return `${test} (flags: ${Array.from(notes).join(', ')})`;
        })
        .sort();
}

function buildRecommendedTestsFromCoverage(flows: FlowImpact[], coverage: FlowCoverage[]): string[] {
    const flowMap = new Map<string, FlowImpact>();
    for (const flow of flows) {
        flowMap.set(flow.id, flow);
    }
    const testNotes = new Map<string, Set<string>>();
    for (const entry of coverage) {
        if (entry.priority !== 'P0' && entry.priority !== 'P1') {
            continue;
        }
        const flow = flowMap.get(entry.flowId);
        const flagSummary = formatFlags(flow?.flags || []);
        for (const test of entry.coveredBy) {
            const normalizedTest = normalizePath(test)
                .replace(/^\.\//, '')
                .replace(/^e2e-tests\/playwright\//, '');
            if (!testNotes.has(normalizedTest)) {
                testNotes.set(normalizedTest, new Set());
            }
            if (flagSummary !== 'none') {
                testNotes.get(normalizedTest)?.add(flagSummary);
            }
        }
    }

    return Array.from(testNotes.entries())
        .map(([test, notes]) => {
            if (notes.size === 0) {
                return test;
            }
            return `${test} (flags: ${Array.from(notes).join(', ')})`;
        })
        .sort();
}

function uniquePaths(paths: string[]): string[] {
    return Array.from(new Set(paths.map((value) => value.replace(/\\/g, '/')).filter(Boolean)));
}

function mergeCoverageWithHeuristicFallback(traceability: FlowCoverage[], heuristic: FlowCoverage[]): FlowCoverage[] {
    const byFlow = new Map<string, FlowCoverage>();
    for (const entry of traceability) {
        byFlow.set(entry.flowId, entry);
    }
    for (const entry of heuristic) {
        const existing = byFlow.get(entry.flowId);
        if (!existing) {
            byFlow.set(entry.flowId, entry);
            continue;
        }
        if (existing.coveredBy.length === 0 && entry.coveredBy.length > 0) {
            byFlow.set(entry.flowId, entry);
        }
    }
    return Array.from(byFlow.values());
}

function buildMattermostFailClosedWarning(reason: string): string {
    return `${reason} Mattermost strict mode will emit uncovered flows as must-add-tests without heuristic fallback.`;
}

function applyMattermostEvidencePolicy(
    config: AgentConfig,
    state: {
        warnings: string[];
        flows: FlowImpact[];
        coverage: FlowCoverage[];
        recommendedTests: string[];
        testMappingSource: 'catalog' | 'traceability' | 'heuristic' | 'ai';
        traceabilityStats?: TraceabilityStats;
        failClosedTargeting?: boolean;
    },
): {coverage: FlowCoverage[]; recommendedTests: string[]; testMappingSource: 'catalog' | 'traceability' | 'heuristic' | 'ai'} {
    if (config.profile !== 'mattermost') {
        return {
            coverage: state.coverage,
            recommendedTests: state.recommendedTests,
            testMappingSource: state.testMappingSource,
        };
    }

    if (state.testMappingSource === 'heuristic') {
        throw new Error(
            'Mattermost profile requires AI or catalog evidence for test selection. Heuristic-only mapping is not allowed.',
        );
    }

    if (state.failClosedTargeting) {
        return {
            coverage: state.coverage,
            recommendedTests: state.recommendedTests,
            testMappingSource: state.testMappingSource,
        };
    }

    if (state.testMappingSource !== 'catalog' && state.testMappingSource !== 'ai' && !state.traceabilityStats?.manifestFound) {
        throw new Error(
            'Mattermost profile requires traceability evidence or AI mapping. Generate or refresh traceability manifest, or enable impact.aiMapping in config.',
        );
    }

    const traceabilityCoverageRatio = state.traceabilityStats?.coverageRatio ?? 0;
    if (state.testMappingSource === 'traceability' && traceabilityCoverageRatio < 0.6) {
        throw new Error(
            `Mattermost profile requires stronger traceability coverage. Current ratio is ${traceabilityCoverageRatio.toFixed(2)}; AI mapping is required to close evidence gaps.`,
        );
    }

    const output = {
        coverage: state.coverage,
        recommendedTests: state.recommendedTests,
        testMappingSource: state.testMappingSource,
    };

    if (state.testMappingSource === 'ai') {
        const traceabilityWarningPrefix = 'Traceability manifest not found or invalid:';
        for (let i = state.warnings.length - 1; i >= 0; i -= 1) {
            if (state.warnings[i].startsWith(traceabilityWarningPrefix)) {
                state.warnings.splice(i, 1);
            }
        }
    }

    return output;
}

function classifyImpactModelConfidence(
    flowMapping: 'catalog' | 'heuristic' | 'ai',
    testMapping: 'catalog' | 'traceability' | 'heuristic' | 'ai',
    dependencyGraph: DependencyGraphExpansion | undefined,
    traceability: TraceabilityStats | undefined,
    warnings: string[],
): 'high' | 'medium' | 'low' {
    let score = 0;
    if (flowMapping === 'catalog') {
        score += 2;
    } else if (flowMapping === 'ai') {
        score += 2;
    }
    if (testMapping === 'catalog') {
        score += 2;
    } else if (testMapping === 'traceability') {
        score += 3;
    } else if (testMapping === 'ai') {
        score += 2;
    }
    if (traceability) {
        if (!traceability.manifestFound) {
            score -= 1;
        } else if (traceability.coverageRatio >= 0.7) {
            score += 1;
        } else if (traceability.coverageRatio < 0.4) {
            score -= 1;
        }
    }
    if (dependencyGraph && dependencyGraph.expandedFiles.length > 0) {
        score += 1;
    }
    if (dependencyGraph && dependencyGraph.truncated) {
        score -= 1;
    }
    if (warnings.length > 0) {
        score -= 1;
    }

    if (score >= 5) {
        return 'high';
    }
    if (score >= 3) {
        return 'medium';
    }
    return 'low';
}

export interface RunOptions {
    apply: boolean;
}

function createRunId(mode: 'impact' | 'gap'): string {
    const ciRunId = process.env.GITHUB_RUN_ID;
    const entropy = Math.random().toString(36).slice(2, 8);
    const ts = Date.now().toString(36);
    if (ciRunId) {
        return `${mode}-gh-${ciRunId}-${ts}-${entropy}`;
    }
    return `${mode}-local-${ts}-${entropy}`;
}

export async function runImpact(_config: AgentConfig, _options: RunOptions): Promise<void> {
    ensureAppRoot(_config.path);
    if (_config.testsRoot) {
        ensureAppRoot(_config.testsRoot);
    }
    const deadline = Date.now() + _config.timeLimitMinutes * 60 * 1000;
    const runStartedAt = new Date().toISOString();
    const runStartedTs = Date.now();
    const runId = createRunId('impact');

    const warnings: string[] = [];
    const testsRoot = _config.testsRoot || _config.path;
    const frameworkDetection = detectFramework(testsRoot, _config.framework);
    const testPatterns = resolveTestPatterns(testsRoot, frameworkDetection, _config.testDiscovery.patterns);

    if (frameworkDetection.framework === 'unknown' && testPatterns.patterns.length === 0) {
        throw new Error('No framework config found. Provide testDiscovery.patterns in config or --patterns.');
    }

    const gitResult = getChangedFiles(_config.path, _config.git.since, {
        includeUncommitted: _config.git.includeUncommitted,
    });
    const changedFiles = normalizeChangedFiles(_config.path, gitResult.files);
    if (gitResult.error) {
        warnings.push(`Git diff failed: ${gitResult.error}`);
    }
    if (changedFiles.length === 0 && !_config.impact.allowFallback) {
        throw new Error('No changed files detected. Provide --since or use gap mode (or --allow-fallback).');
    }

    const changedAppFiles = changedFiles.filter((file) => !isTestFilePath(file));
    let analysisTargets = [...changedAppFiles];
    if (analysisTargets.length === 0 && _config.impact.allowFallback) {
        warnings.push('No changed files detected. Falling back to repository scan for screens.');
        analysisTargets = scanRepositoryFlows(
            _config.path,
            250,
            _config.flowDiscovery.patterns,
            _config.flowDiscovery.exclude,
        );
    }

    let dependencyGraph: DependencyGraphExpansion | undefined;
    if (analysisTargets.length > 0 && _config.impact.dependencyGraph.enabled) {
        dependencyGraph = expandByDependencyGraph(_config.path, analysisTargets, _config.impact.dependencyGraph);
        warnings.push(...dependencyGraph.warnings);
        if (dependencyGraph.expandedFiles.length > 0) {
            analysisTargets = uniquePaths([...analysisTargets, ...dependencyGraph.expandedFiles]);
        }
    }

    const analysis = analyzeFiles(_config.path, analysisTargets, _config);
    warnings.push(...analysis.warnings);
    if (Date.now() > deadline) {
        warnings.push('Time limit exceeded after impact analysis. Skipping coverage and selector steps.');
    }

    let coverage: FlowCoverage[] = [];
    let gaps: FlowImpact[] = [];
    let dataTestIds: DataTestIdSuggestion[] = [];
    let flows: FlowImpact[] = [];
    let flowCatalogSource: string | undefined;
    let recommendedTests: string[] = [];
    let testsByFlow: Map<string, string[]> | undefined;
    let testSuggestions: GapTestSuggestion[] = [];
    const catalog = loadFlowCatalog(_config);
    let flowMappingSource: 'catalog' | 'heuristic' | 'ai' = catalog ? 'catalog' : 'heuristic';
    let testMappingSource: 'catalog' | 'traceability' | 'heuristic' | 'ai' = 'heuristic';
    let traceabilityStats: TraceabilityStats | undefined;
    let mattermostFailClosedTargeting = false;
    if (catalog) {
        flowCatalogSource = catalog.source;
        const mapping = mapChangesToCatalogFlows(catalog, analysisTargets, 'impact', _config);
        flows = mapping.flows;
        testsByFlow = mapping.testsByFlow;
        warnings.push(...mapping.warnings);
        if (_config.profile === 'mattermost' && changedAppFiles.length > 0 && flows.length === 0) {
            throw new Error('Mattermost profile catalog mapping returned no impacted flows. Refresh traceability or AI flow mapping before target selection.');
        }
    } else {
        flows = analysis.flows;
        if (_config.impact.aiFlow.enabled) {
            const aiFlow = await mapAIFlowsFromFiles(
                _config.path,
                testsRoot,
                _config.impact.aiFlow,
                analysis.files,
                changedAppFiles,
            );
            warnings.push(...aiFlow.warnings);
            if (aiFlow.used) {
                flows = aiFlow.flows;
                flowMappingSource = 'ai';
            } else if (_config.impact.aiFlow.strict || _config.profile === 'mattermost') {
                throw new Error('AI flow analysis is required but unavailable. Check Anthropic/LLM provider configuration.');
            }
        }
    }
    if (_config.profile === 'mattermost' && flowMappingSource === 'heuristic') {
        throw new Error('Mattermost profile requires AI or catalog flow mapping; heuristic flow mapping is disabled.');
    }

    flows = applyBlastRadius(flows, analysis.files, _config);
    if (flowMappingSource === 'heuristic') {
        flows = applyPriorityThresholds(flows, _config);
    }

    if (Date.now() <= deadline) {
        if (catalog && testsByFlow) {
            coverage = mapCatalogTestsToFlows(flows, testsRoot, testsByFlow);
            testMappingSource = 'catalog';
            const coverageMap = new Map<string, string[]>();
            for (const entry of coverage) {
                coverageMap.set(entry.flowId, entry.coveredBy);
            }
            gaps = computeGaps(flows, coverageMap);
            recommendedTests = buildRecommendedTestsFromCoverage(flows, coverage);
        } else {
            const traceability = mapTraceabilityToFlows(testsRoot, _config.impact.traceability, flows);
            warnings.push(...traceability.warnings);
            traceabilityStats = traceability.stats;
            if (traceability.stats.manifestFound && traceability.stats.matchedFlows > 0) {
                coverage = traceability.coverage;
                testMappingSource = 'traceability';
                if (traceability.stats.coverageRatio < 0.8) {
                    const tests = discoverTests(testsRoot, testPatterns.patterns);
                    if (_config.impact.aiMapping.enabled) {
                        const aiMapping = await mapAITestsToFlows(
                            _config.path,
                            testsRoot,
                            _config.impact.aiMapping,
                            flows,
                            tests,
                        );
                        warnings.push(...aiMapping.warnings);
                        if (aiMapping.used) {
                            coverage = mergeCoverageWithHeuristicFallback(coverage, aiMapping.coverage);
                            testMappingSource = 'ai';
                        } else if (_config.profile === 'mattermost') {
                            warnings.push(buildMattermostFailClosedWarning(
                                'Mattermost profile requires AI mapping when traceability coverage is incomplete, but AI mapping did not produce target tests.',
                            ));
                            testMappingSource = 'ai';
                            mattermostFailClosedTargeting = true;
                        } else {
                            const heuristicCoverage = mapTestsToFlows(flows, tests);
                            coverage = mergeCoverageWithHeuristicFallback(coverage, heuristicCoverage);
                            warnings.push('Applied heuristic fallback for flows not covered by traceability mapping.');
                        }
                    } else if (_config.profile === 'mattermost') {
                        warnings.push(buildMattermostFailClosedWarning(
                            'Mattermost profile requires AI mapping when traceability coverage is incomplete, but AI mapping is disabled.',
                        ));
                        mattermostFailClosedTargeting = true;
                    } else {
                        const tests = discoverTests(testsRoot, testPatterns.patterns);
                        const heuristicCoverage = mapTestsToFlows(flows, tests);
                        coverage = mergeCoverageWithHeuristicFallback(coverage, heuristicCoverage);
                        warnings.push('Applied heuristic fallback for flows not covered by traceability mapping.');
                    }
                }
            } else {
                const tests = discoverTests(testsRoot, testPatterns.patterns);
                if (_config.impact.aiMapping.enabled) {
                    const aiMapping = await mapAITestsToFlows(
                        _config.path,
                        testsRoot,
                        _config.impact.aiMapping,
                        flows,
                        tests,
                    );
                    warnings.push(...aiMapping.warnings);
                    if (aiMapping.used) {
                        coverage = aiMapping.coverage;
                        testMappingSource = 'ai';
                    } else if (_config.profile === 'mattermost') {
                        warnings.push(buildMattermostFailClosedWarning(
                            'Mattermost profile requires AI mapping because traceability evidence did not produce target tests, but AI mapping returned no valid matches.',
                        ));
                        testMappingSource = 'ai';
                        mattermostFailClosedTargeting = true;
                    } else {
                        coverage = mapTestsToFlows(flows, tests);
                    }
                } else if (_config.profile === 'mattermost') {
                    warnings.push(buildMattermostFailClosedWarning(
                        'Mattermost profile requires traceability evidence or AI mapping to produce target tests, but AI mapping is disabled.',
                    ));
                    testMappingSource = 'traceability';
                    mattermostFailClosedTargeting = true;
                } else {
                    coverage = mapTestsToFlows(flows, tests);
                }
            }
            const coverageMap = new Map<string, string[]>();
            for (const entry of coverage) {
                coverageMap.set(entry.flowId, entry.coveredBy);
            }
            gaps = computeGaps(flows, coverageMap);
            recommendedTests = buildRecommendedTestsFromCoverage(flows, coverage);
        }
    }

    const mattermostAdjusted = applyMattermostEvidencePolicy(_config, {
        warnings,
        flows,
        coverage,
        recommendedTests,
        testMappingSource,
        traceabilityStats,
        failClosedTargeting: mattermostFailClosedTargeting,
    });
    coverage = mattermostAdjusted.coverage;
    recommendedTests = mattermostAdjusted.recommendedTests;
    testMappingSource = mattermostAdjusted.testMappingSource;
    if (Date.now() <= deadline) {
        const coverageMap = new Map<string, string[]>();
        for (const entry of coverage) {
            coverageMap.set(entry.flowId, entry.coveredBy);
        }
        gaps = computeGaps(flows, coverageMap);
    }

    if (Date.now() <= deadline) {
        testSuggestions = buildGapTestSuggestions(testsRoot, gaps, frameworkDetection.framework, testPatterns.patterns);
    }

    if (Date.now() <= deadline) {
        dataTestIds = analysis.files
            .filter((file) => file.isUI && file.content)
            .flatMap((file) => findDataTestIdSuggestions(file.relativePath, file.content, file.flowId));
    }

    if (_config.specPDF) {
        warnings.push('Spec PDF provided but parsing is not implemented in v1.');
    }

    const applied = _options.apply && Date.now() <= deadline
        ? applyChanges(_config, analysis.files, dataTestIds, gaps, frameworkDetection.framework, testPatterns.patterns)
        : undefined;

    let pipelineSummary: PipelineSummary | undefined;
    if (_config.pipeline.enabled && frameworkDetection.framework === 'playwright' && gaps.length > 0) {
        pipelineSummary = runPlaywrightPipeline(testsRoot, gaps, _config.pipeline);
        if (pipelineSummary.warnings.length > 0) {
            warnings.push(...pipelineSummary.warnings);
        }
    }

    const reportRoot = testsRoot;
    const report = writeReport(reportRoot, _config, {
        mode: 'impact',
        runMetadata: {
            runId,
            startedAt: runStartedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - runStartedTs,
            sinceRef: _config.git.since,
            appPath: _config.path,
            testsRoot,
        },
        changedFiles,
        flows: sortFlows(flows),
        coverage,
        gaps,
        dataTestIds,
        framework: frameworkDetection.framework,
        testPatterns: testPatterns.patterns,
        specPDF: _config.specPDF,
        warnings,
        flowCatalog: flowCatalogSource,
        recommendedTests,
        impactModel: {
            schemaVersion: '1.0.0',
            flowMapping: flowMappingSource,
            testMapping: testMappingSource,
            confidenceClass: classifyImpactModelConfidence(flowMappingSource, testMappingSource, dependencyGraph, traceabilityStats, warnings),
            traceability: traceabilityStats,
            dependencyGraph: dependencyGraph
                ? {
                      source: dependencyGraph.source,
                      enabled: _config.impact.dependencyGraph.enabled,
                      seedFiles: dependencyGraph.seedFiles.length,
                      expandedFiles: dependencyGraph.expandedFiles.length,
                      analyzedFiles: dependencyGraph.analyzedFiles,
                      analyzedEdges: dependencyGraph.analyzedEdges,
                      maxDepth: dependencyGraph.maxDepth,
                      truncated: dependencyGraph.truncated,
                  }
                : undefined,
            subsystemRisk: analysis.subsystemRisk.enabled ? analysis.subsystemRisk : undefined,
        },
        testSuggestions,
        pipeline: pipelineSummary,
        applied,
    });

    // eslint-disable-next-line no-console
    console.log(`Impact report: ${report.markdownPath}`);
    // eslint-disable-next-line no-console
    console.log(`Impact data: ${report.jsonPath}`);
}

export async function runGap(_config: AgentConfig, _options: RunOptions): Promise<void> {
    ensureAppRoot(_config.path);
    if (_config.testsRoot) {
        ensureAppRoot(_config.testsRoot);
    }
    const deadline = Date.now() + _config.timeLimitMinutes * 60 * 1000;
    const runStartedAt = new Date().toISOString();
    const runStartedTs = Date.now();
    const runId = createRunId('gap');

    const warnings: string[] = [];
    const testsRoot = _config.testsRoot || _config.path;
    const frameworkDetection = detectFramework(testsRoot, _config.framework);
    const testPatterns = resolveTestPatterns(testsRoot, frameworkDetection, _config.testDiscovery.patterns);

    if (frameworkDetection.framework === 'unknown' && testPatterns.patterns.length === 0) {
        throw new Error('No framework config found. Provide testDiscovery.patterns in config or --patterns.');
    }

    const gitResult = getChangedFiles(_config.path, _config.git.since, {
        includeUncommitted: _config.git.includeUncommitted,
    });
    const changedFiles = normalizeChangedFiles(_config.path, gitResult.files);
    if (gitResult.error) {
        warnings.push(`Git diff failed: ${gitResult.error}`);
    }

    const changedAppFiles = changedFiles.filter((file) => !isTestFilePath(file));
    let analysisTargets = [...changedAppFiles];
    if (analysisTargets.length === 0) {
        analysisTargets = scanRepositoryFlows(
            _config.path,
            250,
            _config.flowDiscovery.patterns,
            _config.flowDiscovery.exclude,
        );
    }

    if (analysisTargets.length === 0) {
        warnings.push('No flow candidates found. Ensure pages/screens exist or provide changed files.');
    }

    let dependencyGraph: DependencyGraphExpansion | undefined;
    if (analysisTargets.length > 0 && _config.impact.dependencyGraph.enabled) {
        dependencyGraph = expandByDependencyGraph(_config.path, analysisTargets, _config.impact.dependencyGraph);
        warnings.push(...dependencyGraph.warnings);
        if (dependencyGraph.expandedFiles.length > 0) {
            analysisTargets = uniquePaths([...analysisTargets, ...dependencyGraph.expandedFiles]);
        }
    }

    const analysis = analyzeFiles(_config.path, analysisTargets, _config);
    warnings.push(...analysis.warnings);
    if (Date.now() > deadline) {
        warnings.push('Time limit exceeded after gap analysis. Skipping coverage and selector steps.');
    }

    let coverage: FlowCoverage[] = [];
    let gaps: FlowImpact[] = [];
    let dataTestIds: DataTestIdSuggestion[] = [];
    let flows: FlowImpact[] = [];
    let flowCatalogSource: string | undefined;
    let recommendedTests: string[] = [];
    let testsByFlow: Map<string, string[]> | undefined;
    let testSuggestions: GapTestSuggestion[] = [];
    const catalog = loadFlowCatalog(_config);
    let flowMappingSource: 'catalog' | 'heuristic' | 'ai' = catalog ? 'catalog' : 'heuristic';
    let testMappingSource: 'catalog' | 'traceability' | 'heuristic' | 'ai' = 'heuristic';
    let traceabilityStats: TraceabilityStats | undefined;
    let mattermostFailClosedTargeting = false;
    if (catalog) {
        flowCatalogSource = catalog.source;
        const catalogMode = changedAppFiles.length > 0 ? 'impact' : 'gap';
        let mapping = mapChangesToCatalogFlows(catalog, analysisTargets, catalogMode, _config);
        if (catalogMode === 'impact' && mapping.flows.length === 0 && _config.impact.allowFallback) {
            const fallbackMapping = mapChangesToCatalogFlows(catalog, analysisTargets, 'gap', _config);
            mapping = {
                flows: fallbackMapping.flows,
                testsByFlow: fallbackMapping.testsByFlow,
                warnings: [
                    ...mapping.warnings,
                    ...fallbackMapping.warnings,
                    'No catalog flow matched changed files; applied full-catalog fallback because allowFallback=true.',
                ],
            };
        }
        flows = mapping.flows;
        testsByFlow = mapping.testsByFlow;
        warnings.push(...mapping.warnings);
        if (_config.profile === 'mattermost' && changedAppFiles.length > 0 && flows.length === 0) {
            throw new Error('Mattermost profile catalog mapping returned no impacted flows. Refresh traceability or AI flow mapping before target selection.');
        }
    } else {
        flows = analysis.flows;
        if (_config.impact.aiFlow.enabled) {
            const aiFlow = await mapAIFlowsFromFiles(
                _config.path,
                testsRoot,
                _config.impact.aiFlow,
                analysis.files,
                changedAppFiles,
            );
            warnings.push(...aiFlow.warnings);
            if (aiFlow.used) {
                flows = aiFlow.flows;
                flowMappingSource = 'ai';
            } else if (_config.impact.aiFlow.strict || _config.profile === 'mattermost') {
                throw new Error('AI flow analysis is required but unavailable. Check Anthropic/LLM provider configuration.');
            }
        }
    }
    if (_config.profile === 'mattermost' && flowMappingSource === 'heuristic') {
        throw new Error('Mattermost profile requires AI or catalog flow mapping; heuristic flow mapping is disabled.');
    }

    flows = applyBlastRadius(flows, analysis.files, _config);
    if (flowMappingSource === 'heuristic') {
        flows = applyPriorityThresholds(flows, _config);
    }

    if (Date.now() <= deadline) {
        if (catalog && testsByFlow) {
            coverage = mapCatalogTestsToFlows(flows, testsRoot, testsByFlow);
            testMappingSource = 'catalog';
            const coverageMap = new Map<string, string[]>();
            for (const entry of coverage) {
                coverageMap.set(entry.flowId, entry.coveredBy);
            }
            gaps = computeGaps(flows, coverageMap);
            recommendedTests = buildRecommendedTestsFromCoverage(flows, coverage);
        } else {
            const traceability = mapTraceabilityToFlows(testsRoot, _config.impact.traceability, flows);
            warnings.push(...traceability.warnings);
            traceabilityStats = traceability.stats;
            if (traceability.stats.manifestFound && traceability.stats.matchedFlows > 0) {
                coverage = traceability.coverage;
                testMappingSource = 'traceability';
                if (traceability.stats.coverageRatio < 0.8) {
                    const tests = discoverTests(testsRoot, testPatterns.patterns);
                    if (_config.impact.aiMapping.enabled) {
                        const aiMapping = await mapAITestsToFlows(
                            _config.path,
                            testsRoot,
                            _config.impact.aiMapping,
                            flows,
                            tests,
                        );
                        warnings.push(...aiMapping.warnings);
                        if (aiMapping.used) {
                            coverage = mergeCoverageWithHeuristicFallback(coverage, aiMapping.coverage);
                            testMappingSource = 'ai';
                        } else if (_config.profile === 'mattermost') {
                            warnings.push(buildMattermostFailClosedWarning(
                                'Mattermost profile requires AI mapping when traceability coverage is incomplete, but AI mapping did not produce target tests.',
                            ));
                            testMappingSource = 'ai';
                            mattermostFailClosedTargeting = true;
                        } else {
                            const heuristicCoverage = mapTestsToFlows(flows, tests);
                            coverage = mergeCoverageWithHeuristicFallback(coverage, heuristicCoverage);
                            warnings.push('Applied heuristic fallback for flows not covered by traceability mapping.');
                        }
                    } else if (_config.profile === 'mattermost') {
                        warnings.push(buildMattermostFailClosedWarning(
                            'Mattermost profile requires AI mapping when traceability coverage is incomplete, but AI mapping is disabled.',
                        ));
                        mattermostFailClosedTargeting = true;
                    } else {
                        const tests = discoverTests(testsRoot, testPatterns.patterns);
                        const heuristicCoverage = mapTestsToFlows(flows, tests);
                        coverage = mergeCoverageWithHeuristicFallback(coverage, heuristicCoverage);
                        warnings.push('Applied heuristic fallback for flows not covered by traceability mapping.');
                    }
                }
            } else {
                const tests = discoverTests(testsRoot, testPatterns.patterns);
                if (_config.impact.aiMapping.enabled) {
                    const aiMapping = await mapAITestsToFlows(
                        _config.path,
                        testsRoot,
                        _config.impact.aiMapping,
                        flows,
                        tests,
                    );
                    warnings.push(...aiMapping.warnings);
                    if (aiMapping.used) {
                        coverage = aiMapping.coverage;
                        testMappingSource = 'ai';
                    } else if (_config.profile === 'mattermost') {
                        warnings.push(buildMattermostFailClosedWarning(
                            'Mattermost profile requires AI mapping because traceability evidence did not produce target tests, but AI mapping returned no valid matches.',
                        ));
                        testMappingSource = 'ai';
                        mattermostFailClosedTargeting = true;
                    } else {
                        coverage = mapTestsToFlows(flows, tests);
                    }
                } else if (_config.profile === 'mattermost') {
                    warnings.push(buildMattermostFailClosedWarning(
                        'Mattermost profile requires traceability evidence or AI mapping to produce target tests, but AI mapping is disabled.',
                    ));
                    testMappingSource = 'traceability';
                    mattermostFailClosedTargeting = true;
                } else {
                    coverage = mapTestsToFlows(flows, tests);
                }
            }
            const coverageMap = new Map<string, string[]>();
            for (const entry of coverage) {
                coverageMap.set(entry.flowId, entry.coveredBy);
            }
            gaps = computeGaps(flows, coverageMap);
            recommendedTests = buildRecommendedTestsFromCoverage(flows, coverage);
        }
    }

    const mattermostAdjusted = applyMattermostEvidencePolicy(_config, {
        warnings,
        flows,
        coverage,
        recommendedTests,
        testMappingSource,
        traceabilityStats,
        failClosedTargeting: mattermostFailClosedTargeting,
    });
    coverage = mattermostAdjusted.coverage;
    recommendedTests = mattermostAdjusted.recommendedTests;
    testMappingSource = mattermostAdjusted.testMappingSource;
    if (Date.now() <= deadline) {
        const coverageMap = new Map<string, string[]>();
        for (const entry of coverage) {
            coverageMap.set(entry.flowId, entry.coveredBy);
        }
        gaps = computeGaps(flows, coverageMap);
    }

    if (Date.now() <= deadline) {
        testSuggestions = buildGapTestSuggestions(testsRoot, gaps, frameworkDetection.framework, testPatterns.patterns);
    }

    if (Date.now() <= deadline) {
        dataTestIds = analysis.files
            .filter((file) => file.isUI && file.content)
            .flatMap((file) => findDataTestIdSuggestions(file.relativePath, file.content, file.flowId));
    }

    if (_config.specPDF) {
        warnings.push('Spec PDF provided but parsing is not implemented in v1.');
    }

    const applied = _options.apply && Date.now() <= deadline
        ? applyChanges(_config, analysis.files, dataTestIds, gaps, frameworkDetection.framework, testPatterns.patterns)
        : undefined;

    let pipelineSummary: PipelineSummary | undefined;
    if (_config.pipeline.enabled && frameworkDetection.framework === 'playwright' && gaps.length > 0) {
        pipelineSummary = runPlaywrightPipeline(testsRoot, gaps, _config.pipeline);
        if (pipelineSummary.warnings.length > 0) {
            warnings.push(...pipelineSummary.warnings);
        }
    }

    const reportRoot = testsRoot;
    const report = writeReport(reportRoot, _config, {
        mode: 'gap',
        runMetadata: {
            runId,
            startedAt: runStartedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - runStartedTs,
            sinceRef: _config.git.since,
            appPath: _config.path,
            testsRoot,
        },
        changedFiles,
        flows: sortFlows(flows),
        coverage,
        gaps,
        dataTestIds,
        framework: frameworkDetection.framework,
        testPatterns: testPatterns.patterns,
        specPDF: _config.specPDF,
        warnings,
        flowCatalog: flowCatalogSource,
        recommendedTests,
        impactModel: {
            schemaVersion: '1.0.0',
            flowMapping: flowMappingSource,
            testMapping: testMappingSource,
            confidenceClass: classifyImpactModelConfidence(flowMappingSource, testMappingSource, dependencyGraph, traceabilityStats, warnings),
            traceability: traceabilityStats,
            dependencyGraph: dependencyGraph
                ? {
                      source: dependencyGraph.source,
                      enabled: _config.impact.dependencyGraph.enabled,
                      seedFiles: dependencyGraph.seedFiles.length,
                      expandedFiles: dependencyGraph.expandedFiles.length,
                      analyzedFiles: dependencyGraph.analyzedFiles,
                      analyzedEdges: dependencyGraph.analyzedEdges,
                      maxDepth: dependencyGraph.maxDepth,
                      truncated: dependencyGraph.truncated,
                  }
                : undefined,
            subsystemRisk: analysis.subsystemRisk.enabled ? analysis.subsystemRisk : undefined,
        },
        testSuggestions,
        pipeline: pipelineSummary,
        applied,
    });

    // eslint-disable-next-line no-console
    console.log(`Gap report: ${report.markdownPath}`);
    // eslint-disable-next-line no-console
    console.log(`Gap data: ${report.jsonPath}`);
}

function applyChanges(
    config: AgentConfig,
    files: {relativePath: string; content: string | null; flowId: string}[],
    dataTestIds: DataTestIdSuggestion[],
    gaps: FlowImpact[],
    framework: string,
    testPatterns: string[],
): {patchedFiles: string[]; generatedTests: string[]; skippedTests: string[]} {
    const patchedFiles: string[] = [];
    const suggestionsByFile = new Map<string, typeof dataTestIds>();
    for (const suggestion of dataTestIds) {
        const bucket = suggestionsByFile.get(suggestion.file) || [];
        bucket.push(suggestion);
        suggestionsByFile.set(suggestion.file, bucket);
    }

    if (config.selectors.patchOnApply) {
        for (const file of files) {
            const suggestions = suggestionsByFile.get(file.relativePath);
            if (!suggestions || !file.content) {
                continue;
            }
            const updated = applyDataTestIdSuggestions(file.content, suggestions as DataTestIdSuggestion[]);
            if (updated !== file.content) {
                const fullPath = join(config.path, file.relativePath);
                writeFileSync(fullPath, updated, 'utf-8');
                patchedFiles.push(file.relativePath);
            }
        }
    }

    const fileToFlow = new Map<string, string>();
    for (const file of files) {
        fileToFlow.set(file.relativePath, file.flowId);
    }
    const testIdsByFlow = new Map<string, string[]>();
    for (const suggestion of dataTestIds) {
        const flowId = fileToFlow.get(suggestion.file);
        if (!flowId) {
            continue;
        }
        const bucket = testIdsByFlow.get(flowId) || [];
        bucket.push(suggestion.testId);
        testIdsByFlow.set(flowId, bucket);
    }

    let generatedTests: string[] = [];
    let skippedTests: string[] = [];
    if (!config.pipeline.enabled) {
        const frameworkType =
            framework === 'playwright' || framework === 'cypress' || framework === 'selenium' ? framework : 'playwright';
        const testsRoot = config.testsRoot || config.path;
        const generated = generateTests(testsRoot, gaps, frameworkType, testPatterns, testIdsByFlow);
        generatedTests = generated.filter((entry) => entry.created).map((entry) => entry.path);
        skippedTests = generated.filter((entry) => !entry.created).map((entry) => entry.path);
    }

    return {patchedFiles, generatedTests, skippedTests};
}

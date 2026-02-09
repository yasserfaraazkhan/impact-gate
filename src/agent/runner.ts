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
        return {...flow, priority};
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
            if (!testNotes.has(test)) {
                testNotes.set(test, new Set());
            }
            if (flagSummary !== 'none') {
                testNotes.get(test)?.add(flagSummary);
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
            if (!testNotes.has(test)) {
                testNotes.set(test, new Set());
            }
            if (flagSummary !== 'none') {
                testNotes.get(test)?.add(flagSummary);
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

export interface RunOptions {
    apply: boolean;
}

export async function runImpact(_config: AgentConfig, _options: RunOptions): Promise<void> {
    ensureAppRoot(_config.path);
    if (_config.testsRoot) {
        ensureAppRoot(_config.testsRoot);
    }
    const deadline = Date.now() + _config.timeLimitMinutes * 60 * 1000;

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

    let analysisTargets = changedFiles.filter((file) => !isTestFilePath(file));
    if (analysisTargets.length === 0 && _config.impact.allowFallback) {
        warnings.push('No changed files detected. Falling back to repository scan for screens.');
        analysisTargets = scanRepositoryFlows(
            _config.path,
            250,
            _config.flowDiscovery.patterns,
            _config.flowDiscovery.exclude,
        );
    }

    const analysis = analyzeFiles(_config.path, analysisTargets, _config);
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

    const catalog = loadFlowCatalog(_config);
    if (catalog) {
        flowCatalogSource = catalog.source;
        const mapping = mapChangesToCatalogFlows(catalog, analysisTargets, 'impact', _config);
        flows = mapping.flows;
        testsByFlow = mapping.testsByFlow;
        warnings.push(...mapping.warnings);
    } else {
        flows = analysis.flows;
    }

    flows = applyBlastRadius(flows, analysis.files, _config);
    if (!catalog) {
        flows = applyPriorityThresholds(flows, _config);
    }

    if (Date.now() <= deadline) {
        if (catalog && testsByFlow) {
            coverage = mapCatalogTestsToFlows(flows, testsRoot, testsByFlow);
            const coverageMap = new Map<string, string[]>();
            for (const entry of coverage) {
                coverageMap.set(entry.flowId, entry.coveredBy);
            }
            gaps = computeGaps(flows, coverageMap);
            recommendedTests = buildRecommendedTestsWithFlags(flows, testsByFlow);
        } else {
            const tests = discoverTests(testsRoot, testPatterns.patterns);
            coverage = mapTestsToFlows(flows, tests);
            const coverageMap = new Map<string, string[]>();
            for (const entry of coverage) {
                coverageMap.set(entry.flowId, entry.coveredBy);
            }
            gaps = computeGaps(flows, coverageMap);
            recommendedTests = buildRecommendedTestsFromCoverage(flows, coverage);
        }
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

    let analysisTargets = changedFiles.filter((file) => !isTestFilePath(file));
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

    const analysis = analyzeFiles(_config.path, analysisTargets, _config);
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

    const catalog = loadFlowCatalog(_config);
    if (catalog) {
        flowCatalogSource = catalog.source;
        const mapping = mapChangesToCatalogFlows(catalog, analysisTargets, 'gap', _config);
        flows = mapping.flows;
        testsByFlow = mapping.testsByFlow;
        warnings.push(...mapping.warnings);
    } else {
        flows = analysis.flows;
    }

    flows = applyBlastRadius(flows, analysis.files, _config);
    if (!catalog) {
        flows = applyPriorityThresholds(flows, _config);
    }

    if (Date.now() <= deadline) {
        if (catalog && testsByFlow) {
            coverage = mapCatalogTestsToFlows(flows, testsRoot, testsByFlow);
            const coverageMap = new Map<string, string[]>();
            for (const entry of coverage) {
                coverageMap.set(entry.flowId, entry.coveredBy);
            }
            gaps = computeGaps(flows, coverageMap);
            recommendedTests = buildRecommendedTestsWithFlags(flows, testsByFlow);
        } else {
            const tests = discoverTests(testsRoot, testPatterns.patterns);
            coverage = mapTestsToFlows(flows, tests);
            const coverageMap = new Map<string, string[]>();
            for (const entry of coverage) {
                coverageMap.set(entry.flowId, entry.coveredBy);
            }
            gaps = computeGaps(flows, coverageMap);
            recommendedTests = buildRecommendedTestsFromCoverage(flows, coverage);
        }
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

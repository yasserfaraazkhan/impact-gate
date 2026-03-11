// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {join} from 'path';
import {resolveConfig, type ConfigOverrides} from './agent/config.js';
import {
    appendPlanMetrics,
    type PlanReport,
} from './agent/plan.js';
import {analyzeImpact as analyzeImpactV2, type ImpactResult} from './engine/impact_engine.js';
import {
    buildPlanFromImpact,
    renderCiSummaryMarkdown,
    writeCiSummary,
    writePlanReport,
} from './engine/plan_builder.js';
import {getChangedFiles} from './agent/git.js';
import {finalizeGeneratedTests, type FinalizeGeneratedTestsOptions, type FinalizeGeneratedTestsResult} from './agent/handoff.js';
import {
    ingestTraceabilityInput,
    type TraceabilityIngestOptions,
    type TraceabilityIngestResult,
} from './agent/traceability_ingest.js';
import {
    captureTraceabilityInput,
    type TraceabilityCaptureOptions,
    type TraceabilityCaptureResult,
} from './agent/traceability_capture.js';

export interface AgentApiOptions extends Omit<ConfigOverrides, 'mode'> {
    cwd?: string;
    configPath?: string;
    apply?: boolean;
    allowFallback?: boolean;
}

export interface TraceabilityIngestApiOptions {
    cwd?: string;
    configPath?: string;
    path?: string;
    testsRoot?: string;
    payload: unknown;
    options?: TraceabilityIngestOptions;
}

export interface TraceabilityCaptureApiOptions {
    cwd?: string;
    configPath?: string;
    path?: string;
    testsRoot?: string;
    reportPath: string;
    sinceRef?: string;
    outputPath?: string;
    coverageMapPath?: string;
    changedFilesPath?: string;
}

function resolveAgent(options: AgentApiOptions, mode: 'impact' | 'gap') {
    const cwd = options.cwd || process.cwd();
    const {config} = resolveConfig(cwd, options.configPath, {
        ...options,
        mode,
    });
    if (options.allowFallback) {
        config.impact.allowFallback = true;
    }
    return config;
}

export function handoffGeneratedTests(options: FinalizeGeneratedTestsOptions): FinalizeGeneratedTestsResult {
    return finalizeGeneratedTests(options);
}

export function ingestTraceability(options: TraceabilityIngestApiOptions): TraceabilityIngestResult {
    const cwd = options.cwd || process.cwd();
    const {config} = resolveConfig(cwd, options.configPath, {
        path: options.path,
        testsRoot: options.testsRoot,
        mode: 'impact',
    });
    const reportRoot = config.testsRoot || config.path;
    return ingestTraceabilityInput(reportRoot, config.impact.traceability, options.payload, options.options);
}

export interface RecommendTestsV2Result {
    impact: ImpactResult;
    plan: PlanReport;
    planPath: string;
    ciSummaryMarkdown: string;
    ciSummaryPath: string;
}

export function analyzeImpactDeterministic(options: AgentApiOptions = {}): ImpactResult {
    const config = resolveAgent(options, 'impact');
    const reportRoot = config.testsRoot || config.path;
    const gitResult = getChangedFiles(config.path, config.git.since, {includeUncommitted: config.git.includeUncommitted});
    return analyzeImpactV2(gitResult.files, {
        testsRoot: reportRoot,
        routeFamilies: config.routeFamilies,
    });
}

export function recommendTestsDeterministic(options: AgentApiOptions = {}): RecommendTestsV2Result {
    const config = resolveAgent(options, 'impact');
    const reportRoot = config.testsRoot || config.path;
    const gitResult = getChangedFiles(config.path, config.git.since, {includeUncommitted: config.git.includeUncommitted});
    const impact = analyzeImpactV2(gitResult.files, {
        testsRoot: reportRoot,
        routeFamilies: config.routeFamilies,
    });
    const plan = buildPlanFromImpact(impact, config.policy);
    const planPath = writePlanReport(reportRoot, plan);
    const ciSummaryMarkdown = renderCiSummaryMarkdown(plan);
    const ciSummaryPath = writeCiSummary(reportRoot, ciSummaryMarkdown);
    appendPlanMetrics(reportRoot, plan);
    return {impact, plan, planPath, ciSummaryMarkdown, ciSummaryPath};
}

export function captureTraceability(options: TraceabilityCaptureApiOptions): TraceabilityCaptureResult {
    const cwd = options.cwd || process.cwd();
    const {config} = resolveConfig(cwd, options.configPath, {
        path: options.path,
        testsRoot: options.testsRoot,
        mode: 'impact',
    });
    const reportRoot = config.testsRoot || config.path;
    const captureOptions: TraceabilityCaptureOptions = {
        appPath: config.path,
        testsRoot: reportRoot,
        reportPath: options.reportPath,
        sinceRef: options.sinceRef || config.git.since,
        outputPath: options.outputPath,
        coverageMapPath: options.coverageMapPath,
        changedFilesPath: options.changedFilesPath,
    };
    return captureTraceabilityInput(captureOptions);
}

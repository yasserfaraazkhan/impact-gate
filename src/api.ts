// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';
import {resolveConfig, type ConfigOverrides} from './agent/config.js';
import {runGap, runImpact} from './agent/runner.js';
import {
    appendPlanMetrics,
    attachDeveloperActions,
    buildPlanFromImpactReport,
    renderCiSummaryMarkdown,
    writeCiSummary,
    writePlanReport,
    type PlanReport,
} from './agent/plan.js';
import type {ReportData} from './agent/report.js';
import {applyOperationalInsights} from './agent/operational_insights.js';
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

export interface AnalyzeResult {
    report: ReportData;
    reportPath: string;
}

export interface RecommendTestsResult extends AnalyzeResult {
    plan: PlanReport;
    planPath: string;
    ciSummaryMarkdown: string;
    ciSummaryPath: string;
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

function readReportJson(reportPath: string): ReportData {
    if (!existsSync(reportPath)) {
        throw new Error(`Expected report not found: ${reportPath}`);
    }
    const raw = readFileSync(reportPath, 'utf-8');
    return JSON.parse(raw) as ReportData;
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

function reportPathFor(configPath: string, mode: 'impact' | 'gap'): string {
    return join(configPath, '.e2e-ai-agents', mode === 'impact' ? 'impact.json' : 'gap.json');
}

export async function analyzeImpact(options: AgentApiOptions = {}): Promise<AnalyzeResult> {
    const config = resolveAgent(options, 'impact');
    await runImpact(config, {apply: options.apply ?? false});
    const reportRoot = config.testsRoot || config.path;
    const reportPath = reportPathFor(reportRoot, 'impact');
    const report = readReportJson(reportPath);
    return {report, reportPath};
}

export async function findGaps(options: AgentApiOptions = {}): Promise<AnalyzeResult> {
    const config = resolveAgent(options, 'gap');
    await runGap(config, {apply: options.apply ?? false});
    const reportRoot = config.testsRoot || config.path;
    const reportPath = reportPathFor(reportRoot, 'gap');
    const report = readReportJson(reportPath);
    return {report, reportPath};
}

export async function recommendTests(options: AgentApiOptions = {}): Promise<RecommendTestsResult> {
    const config = resolveAgent(options, 'impact');
    await runImpact(config, {apply: options.apply ?? false});
    const reportRoot = config.testsRoot || config.path;
    const impactPath = reportPathFor(reportRoot, 'impact');
    const report = readReportJson(impactPath);
    const basePlan = buildPlanFromImpactReport(report, config.policy);
    const withActions = attachDeveloperActions(basePlan, {
        appPath: config.path,
        testsRoot: reportRoot,
        sinceRef: config.git.since,
    });
    const plan = applyOperationalInsights(withActions, reportRoot);
    const planPath = writePlanReport(reportRoot, plan);
    const ciSummaryMarkdown = renderCiSummaryMarkdown(plan);
    const ciSummaryPath = writeCiSummary(reportRoot, ciSummaryMarkdown);
    appendPlanMetrics(reportRoot, plan);
    return {
        report,
        reportPath: impactPath,
        plan,
        planPath,
        ciSummaryMarkdown,
        ciSummaryPath,
    };
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

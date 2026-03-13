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
import {getAdaptiveThresholds} from './agent/feedback.js';
import {loadDiffs} from './engine/diff_loader.js';
import {enrichImpactWithAI, type AIEnrichmentResult} from './engine/ai_enrichment.js';
import {AnthropicProvider} from './anthropic_provider.js';
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
    const adaptive = getAdaptiveThresholds(reportRoot);
    const plan = buildPlanFromImpact(impact, config.policy, undefined, adaptive);
    const planPath = writePlanReport(reportRoot, plan);
    const ciSummaryMarkdown = renderCiSummaryMarkdown(plan);
    const ciSummaryPath = writeCiSummary(reportRoot, ciSummaryMarkdown);
    appendPlanMetrics(reportRoot, plan);
    return {impact, plan, planPath, ciSummaryMarkdown, ciSummaryPath};
}

export async function recommendTestsAI(options: AgentApiOptions = {}): Promise<RecommendTestsV2Result & { aiEnrichment?: AIEnrichmentResult }> {
    const config = resolveAgent(options, 'impact');
    const reportRoot = config.testsRoot || config.path;
    const gitResult = getChangedFiles(config.path, config.git.since, {includeUncommitted: config.git.includeUncommitted});
    const impact = analyzeImpactV2(gitResult.files, {
        testsRoot: reportRoot,
        routeFamilies: config.routeFamilies,
    });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    let aiEnrichment: AIEnrichmentResult | undefined;

    if (apiKey) {
        const diffs = loadDiffs(config.path, config.git.since, gitResult.files);
        const provider = new AnthropicProvider({apiKey});
        // Collect all known spec paths and scenario details from impacted features
        const specSet = new Set<string>();
        const specDetailsMap = new Map<string, {file: string; scenarios: string[]}>();
        for (const feature of impact.impactedFeatures) {
            for (const s of feature.playwrightSpecs) {
                specSet.add(s);
            }
            for (const detail of feature.playwrightSpecDetails) {
                if (!specDetailsMap.has(detail.file)) {
                    specDetailsMap.set(detail.file, detail);
                }
            }
            for (const detail of feature.cypressSpecDetails) {
                if (!specDetailsMap.has(detail.file)) {
                    specDetailsMap.set(detail.file, detail);
                }
            }
        }
        aiEnrichment = await enrichImpactWithAI({
            deterministicImpact: impact,
            diffs,
            provider,
            specList: [...specSet],
            specDetails: [...specDetailsMap.values()],
        });
    }

    const adaptive = getAdaptiveThresholds(reportRoot);
    const plan = buildPlanFromImpact(impact, config.policy, aiEnrichment, adaptive);
    const planPath = writePlanReport(reportRoot, plan);
    const ciSummaryMarkdown = renderCiSummaryMarkdown(plan);
    const ciSummaryPath = writeCiSummary(reportRoot, ciSummaryMarkdown);
    appendPlanMetrics(reportRoot, plan);
    return {impact, plan, planPath, ciSummaryMarkdown, ciSummaryPath, aiEnrichment};
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

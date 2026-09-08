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
import {LLMProviderFactory} from './provider_factory.js';
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
    advisory?: boolean;
    suite?: string;
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
    if (options.advisory) return recommendTestsDeterministic(options).impact;
    const config = resolveAgent(options, 'impact');
    const reportRoot = config.testsRoot || config.path;
    const gitResult = getChangedFiles(config.path, config.git.since, {includeUncommitted: options.advisory ? false : config.git.includeUncommitted});
    if (gitResult.error) throw new Error(gitResult.error);
    return analyzeImpactV2(gitResult.files, {
        testsRoot: reportRoot,
        routeFamilies: config.routeFamilies,
        filteredTestFiles: gitResult.filteredTestFiles,
    });
}

export function recommendTestsDeterministic(options: AgentApiOptions = {}): RecommendTestsV2Result {
    if (options.advisory && options.apply) throw new Error('Advisory planning cannot apply changes.');
    const config = resolveAgent(options, 'impact');
    const reportRoot = config.testsRoot || config.path;
    const gitResult = getChangedFiles(config.path, config.git.since, {includeUncommitted: options.advisory ? false : config.git.includeUncommitted});
    if (gitResult.error) throw new Error(gitResult.error);
    const advisory = options.advisory
        ? (() => {
            if (!config.advisory || !options.suite) throw new Error('Advisory planning requires advisory configuration and --suite.');
            return {git: gitResult, config: config.advisory, suite: options.suite};
        })() : undefined;
    const impact = analyzeImpactV2(gitResult.files, {
        advisory,
        testsRoot: reportRoot,
        routeFamilies: config.routeFamilies,
        filteredTestFiles: gitResult.filteredTestFiles,
    });
    if (options.advisory) {
        const plan = buildPlanFromImpact(impact, config.policy);
        return {impact, plan, planPath: '', ciSummaryMarkdown: renderCiSummaryMarkdown(plan), ciSummaryPath: ''};
    }
    const adaptive = getAdaptiveThresholds(reportRoot);
    const plan = buildPlanFromImpact(impact, config.policy, undefined, adaptive);
    const planPath = writePlanReport(reportRoot, plan);
    const ciSummaryMarkdown = renderCiSummaryMarkdown(plan);
    const ciSummaryPath = writeCiSummary(reportRoot, ciSummaryMarkdown);
    appendPlanMetrics(reportRoot, plan);
    return {impact, plan, planPath, ciSummaryMarkdown, ciSummaryPath};
}

export async function recommendTestsAI(options: AgentApiOptions = {}): Promise<RecommendTestsV2Result & { aiEnrichment?: AIEnrichmentResult }> {
    if (options.advisory) return recommendTestsDeterministic(options);
    const config = resolveAgent(options, 'impact');
    const reportRoot = config.testsRoot || config.path;
    const gitResult = getChangedFiles(config.path, config.git.since, {includeUncommitted: options.advisory ? false : config.git.includeUncommitted});
    if (gitResult.error) throw new Error(gitResult.error);
    const impact = analyzeImpactV2(gitResult.files, {
        testsRoot: reportRoot,
        routeFamilies: config.routeFamilies,
        filteredTestFiles: gitResult.filteredTestFiles,
    });

    let aiEnrichment: AIEnrichmentResult | undefined;

    let provider;
    try {
        provider = await LLMProviderFactory.createFromPreference(config.llm.provider);
    } catch (error) {
        const configuredProvider = config.llm.provider?.trim().toLowerCase();
        const envProvider = process.env.LLM_PROVIDER?.trim().toLowerCase();
        const shouldThrow = Boolean(
            (configuredProvider && configuredProvider !== 'auto') ||
            (envProvider && envProvider !== 'auto'),
        );
        if (shouldThrow) {
            throw error;
        }
    }

    if (provider) {
        const diffs = loadDiffs(config.path, config.git.since, gitResult.files);
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

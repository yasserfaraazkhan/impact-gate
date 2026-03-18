// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {appendFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import type {resolveConfig} from '../../agent/config.js';
import type {PlanReport} from '../../agent/plan.js';
import {writeCiSummary} from '../../engine/plan_builder.js';
import {recommendTestsAI, recommendTestsDeterministic} from '../../api.js';
import {appendCrewToSummary, runPlanCrewAnalysis, writeCrewArtifacts} from './plan_crew.js';

import type {ParsedArgs} from '../types.js';

export async function runPlanCommand(args: ParsedArgs, autoConfig: string | undefined, config: ReturnType<typeof resolveConfig>['config']): Promise<void> {
    const reportRoot = config.testsRoot || config.path;
    const apiOptions = {
        cwd: process.cwd(),
        configPath: autoConfig,
        path: args.path,
        profile: args.profile,
        testsRoot: args.testsRoot,
        gitSince: args.gitSince,
        llmProvider: args.llmProvider,
        policy:
            args.policyMinConfidence !== undefined ||
            args.policySafeMergeConfidence !== undefined ||
            args.policyWarningsThreshold !== undefined ||
            (args.policyRiskyPatterns && args.policyRiskyPatterns.length > 0) ||
            args.policyEnforcementMode !== undefined ||
            (args.policyBlockActions && args.policyBlockActions.length > 0)
                ? {
                      minConfidenceForTargeted: args.policyMinConfidence,
                      safeMergeMinConfidence: args.policySafeMergeConfidence,
                      forceFullOnWarningsAtOrAbove: args.policyWarningsThreshold,
                      riskyFilePatterns: args.policyRiskyPatterns,
                      enforcementMode: args.policyEnforcementMode,
                      blockOnActions: args.policyBlockActions,
                  }
                : undefined,
    };

    let result: Awaited<ReturnType<typeof recommendTestsAI>>;
    if (args.noAi) {
        result = recommendTestsDeterministic(apiOptions);
    } else {
        result = await recommendTestsAI(apiOptions);
        if (result.aiEnrichment) {
            const {aiEnrichment} = result;
            console.log(`AI enrichment: ${aiEnrichment.enrichedFeatures.length} features enriched (${aiEnrichment.tokenUsage.input + aiEnrichment.tokenUsage.output} tokens)`);
        } else if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.LLM_PROVIDER) {
            console.log('Tip: configure ANTHROPIC_API_KEY, OPENAI_API_KEY, or LLM_PROVIDER to enable AI-powered enrichment');
        }
    }

    const {plan, planPath, ciSummaryMarkdown, ciSummaryPath} = result;
    let planReport: PlanReport = plan;
    let combinedSummaryMarkdown = ciSummaryMarkdown;
    let crewSummaryPath = '';
    let crewMarkdownPath = '';
    let crewTestPlanPath = '';

    if (args.crew) {
        try {
            const crew = await runPlanCrewAnalysis(plan, config, args);
            planReport = {
                ...plan,
                crew,
            };
            combinedSummaryMarkdown = appendCrewToSummary(ciSummaryMarkdown, crew, plan);
            const artifacts = writeCrewArtifacts(reportRoot, crew, plan);
            crewSummaryPath = artifacts.crewSummaryPath;
            crewMarkdownPath = artifacts.crewMarkdownPath;
            crewTestPlanPath = artifacts.crewTestPlanPath;
            writeFileSync(planPath, JSON.stringify(planReport, null, 2), 'utf-8');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`Crew analysis unavailable: ${message}`);
        }
    }

    writeCiSummary(reportRoot, combinedSummaryMarkdown);
    const summaryPath = args.ciCommentPath
        ? writeCiSummary(reportRoot, combinedSummaryMarkdown, args.ciCommentPath)
        : ciSummaryPath;
    // Compute metrics paths (api already wrote metrics; derive paths for GHA output)
    const metricsEventsPath = join(reportRoot, '.e2e-ai-agents/metrics.jsonl');
    const metricsSummaryPath = join(reportRoot, '.e2e-ai-agents/metrics-summary.json');
    const ghaOutput = args.githubOutputPath || process.env.GITHUB_OUTPUT;
    if (ghaOutput) {
        appendFileSync(ghaOutput, `run_set=${planReport.runSet}\n`);
        appendFileSync(ghaOutput, `action=${planReport.decision.action}\n`);
        appendFileSync(ghaOutput, `confidence=${planReport.confidence}\n`);
        appendFileSync(ghaOutput, `enforcement_mode=${planReport.enforcement.mode}\n`);
        appendFileSync(ghaOutput, `enforcement_should_fail=${planReport.enforcement.shouldFail}\n`);
        appendFileSync(ghaOutput, `recommended_tests_count=${planReport.recommendedTests.length}\n`);
        appendFileSync(ghaOutput, `required_new_tests_count=${planReport.requiredNewTests.length}\n`);
        appendFileSync(ghaOutput, `plan_path=${planPath}\n`);
        appendFileSync(ghaOutput, `summary_path=${summaryPath}\n`);
        appendFileSync(ghaOutput, `metrics_events_path=${metricsEventsPath}\n`);
        appendFileSync(ghaOutput, `metrics_summary_path=${metricsSummaryPath}\n`);
        appendFileSync(ghaOutput, `crew_enabled=${planReport.crew ? 'true' : 'false'}\n`);
        appendFileSync(ghaOutput, `crew_workflow=${planReport.crew?.workflow || ''}\n`);
        appendFileSync(ghaOutput, `crew_summary_path=${crewSummaryPath}\n`);
        appendFileSync(ghaOutput, `crew_markdown_path=${crewMarkdownPath}\n`);
        appendFileSync(ghaOutput, `crew_test_plan_path=${crewTestPlanPath}\n`);
        appendFileSync(ghaOutput, `crew_impacted_flows=${planReport.crew?.summary.impactedFlows || 0}\n`);
        appendFileSync(ghaOutput, `crew_strategy_entries=${planReport.crew?.summary.strategyEntries || 0}\n`);
        appendFileSync(ghaOutput, `crew_test_designs=${planReport.crew?.summary.testDesigns || 0}\n`);
    }
    console.log(`Suggested run set: ${planReport.runSet} (confidence ${planReport.confidence})`);
    console.log(`Decision: ${planReport.decision.action} - ${planReport.decision.summary}`);
    console.log(`Enforcement: ${planReport.enforcement.mode} (shouldFail=${planReport.enforcement.shouldFail})`);
    console.log(`Plan data: ${planPath}`);
    console.log(`CI summary: ${summaryPath}`);
    if (planReport.crew) {
        console.log(`Crew workflow: ${planReport.crew.workflow} (impactedFlows=${planReport.crew.summary.impactedFlows}, strategyEntries=${planReport.crew.summary.strategyEntries}, testDesigns=${planReport.crew.summary.testDesigns})`);
        console.log(`Crew summary: ${crewSummaryPath}`);
        console.log(`Crew test plan: ${crewTestPlanPath}`);
    }
    console.log(`Plan metrics: ${metricsSummaryPath}`);
    const failOnLegacyFlag = args.failOnMustAddTests && planReport.decision.action === 'must-add-tests';
    if (failOnLegacyFlag || planReport.enforcement.shouldFail) {
        process.exit(2);
    }
}

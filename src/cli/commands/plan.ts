// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {appendFileSync} from 'fs';
import {join} from 'path';

import type {resolveConfig} from '../../agent/config.js';
import {writeCiSummary} from '../../engine/plan_builder.js';
import {recommendTestsAI, recommendTestsDeterministic} from '../../api.js';

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
        } else if (!process.env.ANTHROPIC_API_KEY) {
            console.log('Tip: set ANTHROPIC_API_KEY to enable AI-powered enrichment');
        }
    }

    const {plan, planPath, ciSummaryMarkdown, ciSummaryPath} = result;

    // Write CI summary to an additional path if --ci-comment-path was specified
    if (args.ciCommentPath) {
        writeCiSummary(reportRoot, ciSummaryMarkdown, args.ciCommentPath);
    }

    const summaryPath = ciSummaryPath;
    // Compute metrics paths (api already wrote metrics; derive paths for GHA output)
    const metricsEventsPath = join(reportRoot, '.e2e-ai-agents/metrics.jsonl');
    const metricsSummaryPath = join(reportRoot, '.e2e-ai-agents/metrics-summary.json');
    const ghaOutput = args.githubOutputPath || process.env.GITHUB_OUTPUT;
    if (ghaOutput) {
        appendFileSync(ghaOutput, `run_set=${plan.runSet}\n`);
        appendFileSync(ghaOutput, `action=${plan.decision.action}\n`);
        appendFileSync(ghaOutput, `confidence=${plan.confidence}\n`);
        appendFileSync(ghaOutput, `enforcement_mode=${plan.enforcement.mode}\n`);
        appendFileSync(ghaOutput, `enforcement_should_fail=${plan.enforcement.shouldFail}\n`);
        appendFileSync(ghaOutput, `recommended_tests_count=${plan.recommendedTests.length}\n`);
        appendFileSync(ghaOutput, `required_new_tests_count=${plan.requiredNewTests.length}\n`);
        appendFileSync(ghaOutput, `plan_path=${planPath}\n`);
        appendFileSync(ghaOutput, `summary_path=${summaryPath}\n`);
        appendFileSync(ghaOutput, `metrics_events_path=${metricsEventsPath}\n`);
        appendFileSync(ghaOutput, `metrics_summary_path=${metricsSummaryPath}\n`);
    }
    console.log(`Suggested run set: ${plan.runSet} (confidence ${plan.confidence})`);
    console.log(`Decision: ${plan.decision.action} - ${plan.decision.summary}`);
    console.log(`Enforcement: ${plan.enforcement.mode} (shouldFail=${plan.enforcement.shouldFail})`);
    console.log(`Plan data: ${planPath}`);
    console.log(`CI summary: ${summaryPath}`);
    console.log(`Plan metrics: ${metricsSummaryPath}`);
    const failOnLegacyFlag = args.failOnMustAddTests && plan.decision.action === 'must-add-tests';
    if (failOnLegacyFlag || plan.enforcement.shouldFail) {
        process.exit(2);
    }
}

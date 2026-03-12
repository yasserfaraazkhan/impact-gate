#!/usr/bin/env node
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {resolveConfig} from './agent/config.js';
import {parseArgs, resolveAutoConfig} from './cli/parse_args.js';
import {printUsage} from './cli/usage.js';
import {runLlmHealth} from './cli/commands/llm_health.js';
import {runAnalyzeCommand} from './cli/commands/analyze.js';
import {runFeedbackCommand} from './cli/commands/feedback.js';
import {runTraceabilityCaptureCommand, runTraceabilityIngestCommand} from './cli/commands/traceability.js';
import {runFinalizeCommand} from './cli/commands/finalize.js';
import {runHealCommand} from './cli/commands/heal.js';
import {runImpactCommand} from './cli/commands/impact.js';
import {runPlanCommand} from './cli/commands/plan.js';
import {runGenerateCommand} from './cli/commands/generate.js';
import {runInitCommand} from './cli/commands/init.js';

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const autoConfig = resolveAutoConfig(args);

    if (args.command === 'init') {
        const hasYes = process.argv.includes('--yes') || process.argv.includes('-y');
        await runInitCommand(hasYes);
        return;
    }

    if (args.help || !args.command) {
        printUsage();
        process.exit(args.command ? 0 : 1);
    }

    if (args.command === 'llm-health') {
        await runLlmHealth();
        return;
    }

    if (args.command === 'analyze') {
        await runAnalyzeCommand(args, autoConfig);
        return;
    }

    if (args.command === 'feedback') {
        runFeedbackCommand(args, autoConfig);
        return;
    }

    if (args.command === 'traceability-capture') {
        runTraceabilityCaptureCommand(args, autoConfig);
        return;
    }

    if (args.command === 'traceability-ingest') {
        runTraceabilityIngestCommand(args, autoConfig);
        return;
    }

    if (args.command === 'finalize-generated-tests') {
        runFinalizeCommand(args, autoConfig);
        return;
    }

    if (args.command === 'heal') {
        runHealCommand(args, autoConfig);
        return;
    }

    if (!args.path && !autoConfig) {
        console.error('Error: --path is required (or provide a config file with path set)');
        printUsage();
        process.exit(1);
    }

    const {config} = resolveConfig(process.cwd(), autoConfig, {
        path: args.path,
        profile: args.profile,
        testsRoot: args.testsRoot,
        mode: 'impact',
        framework: args.framework,
        timeLimitMinutes: args.timeLimitMinutes,
        budget: {
            maxUSD: args.budgetUSD,
            maxTokens: args.budgetTokens,
        },
        testPatterns: args.testPatterns,
        flowPatterns: args.flowPatterns,
        flowExclude: args.flowExclude,
        flowCatalogPath: args.flowCatalogPath,
        specPDF: args.specPDF,
        gitSince: args.gitSince,
        llmProvider: args.llmProvider,
        pipeline: args.pipeline
            ? {
                  enabled: true,
                  scenarios: args.pipelineScenarios,
                  outputDir: args.pipelineOutput,
                  baseUrl: args.pipelineBaseUrl,
                  browser: args.pipelineBrowser,
                  headless: args.pipelineHeadless,
                  project: args.pipelineProject,
                  parallel: args.pipelineParallel,
                  dryRun: args.pipelineDryRun,
                  mcp: args.pipelineMcp,
                  mcpAllowFallback: args.pipelineMcpAllowFallback,
                  mcpOnly: args.pipelineMcpOnly,
                  mcpCommandTimeoutMs: args.pipelineMcpTimeoutMs,
                  mcpRetries: args.pipelineMcpRetries,
              }
            : undefined,
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
    });

    if (args.command === 'impact') {
        runImpactCommand(args, config);
        return;
    }

    if (args.command === 'suggest' || args.command === 'plan') {
        await runPlanCommand(args, autoConfig, config);
        return;
    }

    if (args.command === 'generate') {
        await runGenerateCommand(args, config);
        return;
    }

    console.error(`Unknown command: ${args.command}`);
    printUsage();
    process.exit(1);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

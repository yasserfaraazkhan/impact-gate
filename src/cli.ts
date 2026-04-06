#!/usr/bin/env node
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {resolveConfig} from './agent/config.js';
import {parseArgs, resolveAutoConfig} from './cli/parse_args.js';
import {resolveDefaults} from './cli/defaults.js';
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
import {runTrainCommand} from './cli/commands/train.js';
import {runCrewCommand} from './cli/commands/crew.js';
import {runCostReportCommand} from './cli/commands/cost_report.js';
import {runGateCommand} from './cli/commands/gate.js';
import {runBootstrapCommand} from './cli/commands/bootstrap.js';
import {runInstallSkillCommand} from './cli/commands/install_skill.js';
import {runPredictCommand, runPredictFeedbackCommand} from './cli/commands/predict.js';
import {classifyError, EXIT_CODES} from './cli/errors.js';

// Commands that skip default resolution (they handle their own setup)
const SKIP_DEFAULTS_COMMANDS = new Set(['init', 'llm-health', 'cost-report', 'bootstrap', 'install-skill', 'predict', 'predict-feedback']);

// Commands that need path/testsRoot/framework/since
const NEEDS_DEFAULTS_COMMANDS = new Set([
    'impact', 'plan', 'suggest', 'crew', 'generate', 'heal', 'analyze', 'train',
    'feedback', 'traceability-capture', 'traceability-ingest', 'finalize-generated-tests',
]);

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const autoConfig = resolveAutoConfig(args);

    // Auto-detect defaults for commands that need them (when no config file found)
    if (args.command && NEEDS_DEFAULTS_COMMANDS.has(args.command) && !SKIP_DEFAULTS_COMMANDS.has(args.command)) {
        const defaults = resolveDefaults({
            path: args.path,
            testsRoot: args.testsRoot,
            framework: args.framework,
            gitSince: args.gitSince,
        });
        args.path = args.path || defaults.path;
        args.testsRoot = args.testsRoot || defaults.testsRoot;
        args.framework = args.framework || defaults.framework;
        args.gitSince = args.gitSince || defaults.since;
    }

    if (args.command === 'init') {
        const hasYes = process.argv.includes('--yes') || process.argv.includes('-y');
        await runInitCommand(hasYes);
        return;
    }

    if (args.command === 'install-skill') {
        const skillName = process.argv[3]; // impact-gate install-skill <name>
        runInstallSkillCommand(skillName);
        return;
    }

    if (args.command === 'bootstrap') {
        await runBootstrapCommand(args);
        return;
    }

    if (args.command === 'train') {
        await runTrainCommand(args, autoConfig);
        return;
    }

    if (args.help) {
        printUsage();
        process.exit(0);
    }

    if (!args.command) {
        printUsage();
        process.exit(1);
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

    if (args.command === 'crew') {
        await runCrewCommand(args, autoConfig);
        return;
    }

    if (args.command === 'cost-report') {
        runCostReportCommand(args);
        return;
    }

    if (args.command === 'predict') {
        await runPredictCommand(args);
        return;
    }

    if (args.command === 'predict-feedback') {
        runPredictFeedbackCommand(args);
        return;
    }

    if (args.command === 'gate') {
        await runGateCommand(args, autoConfig);
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
    const exitCode = classifyError(error);
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    if (exitCode === EXIT_CODES.BUDGET_EXCEEDED) {
        console.error('Hint: Increase --budget or use --degraded-mode to skip AI features.');
    } else if (exitCode === EXIT_CODES.PROVIDER_UNAVAILABLE) {
        console.error('Hint: Check API key or use --degraded-mode for deterministic analysis only.');
    }
    process.exit(exitCode);
});

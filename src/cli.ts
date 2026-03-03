#!/usr/bin/env node
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {appendFileSync, existsSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join, resolve} from 'path';

import {resolveConfig, type AnalysisMode, type AnalysisProfile, type FrameworkType} from './agent/config.js';
import {AnthropicProvider} from './anthropic_provider.js';
import {LLMProviderError} from './provider_interface.js';
import {runGap, runImpact} from './agent/runner.js';
import {
    appendPlanMetrics,
    attachDeveloperActions,
    buildPlanFromImpactReport,
    renderCiSummaryMarkdown,
    writeCiSummary,
    writePlanReport,
} from './agent/plan.js';
import type {ReportData} from './agent/report.js';
import {applyOperationalInsights} from './agent/operational_insights.js';
import {appendFeedbackAndRecompute, type RecommendationFeedbackEntry} from './agent/feedback.js';
import {finalizeGeneratedTests} from './agent/handoff.js';
import {ingestTraceabilityInput} from './agent/traceability_ingest.js';
import {captureTraceabilityInput} from './agent/traceability_capture.js';
import {runTargetedSpecHeal} from './agent/pipeline.js';
import {extractPlaywrightUnstableSpecs} from './agent/playwright_report.js';

type Command =
    AnalysisMode
    | 'plan'
    | 'generate'
    | 'heal'
    | 'suggest'
    | 'approve-and-generate'
    | 'auto-heal-pr'
    | 'finalize-generated-tests'
    | 'feedback'
    | 'traceability-capture'
    | 'traceability-ingest'
    | 'llm-health';

interface ParsedArgs {
    command?: Command;
    configPath?: string;
    path?: string;
    profile?: AnalysisProfile;
    testsRoot?: string;
    framework?: FrameworkType;
    timeLimitMinutes?: number;
    budgetUSD?: number;
    budgetTokens?: number;
    testPatterns?: string[];
    flowPatterns?: string[];
    flowExclude?: string[];
    flowCatalogPath?: string;
    specPDF?: string;
    gitSince?: string;
    allowFallback?: boolean;
    pipeline?: boolean;
    pipelineScenarios?: number;
    pipelineOutput?: string;
    pipelineBaseUrl?: string;
    pipelineBrowser?: 'chrome' | 'chromium' | 'firefox' | 'webkit';
    pipelineHeadless?: boolean;
    pipelineProject?: string;
    pipelineParallel?: boolean;
    pipelineDryRun?: boolean;
    pipelineMcp?: boolean;
    pipelineMcpAllowFallback?: boolean;
    pipelineMcpOnly?: boolean;
    pipelineMcpTimeoutMs?: number;
    pipelineMcpRetries?: number;
    policyMinConfidence?: number;
    policySafeMergeConfidence?: number;
    policyWarningsThreshold?: number;
    policyRiskyPatterns?: string[];
    policyEnforcementMode?: 'advisory' | 'warn' | 'block';
    policyBlockActions?: Array<'run-now' | 'must-add-tests' | 'safe-to-merge'>;
    ciCommentPath?: string;
    githubOutputPath?: string;
    failOnMustAddTests?: boolean;
    feedbackInputPath?: string;
    traceabilityReportPath?: string;
    traceabilityCaptureOutputPath?: string;
    traceabilityCoverageMapPath?: string;
    traceabilityChangedFilesPath?: string;
    traceabilityInputPath?: string;
    traceabilityMinHits?: number;
    traceabilityMaxFilesPerTest?: number;
    traceabilityMaxAgeDays?: number;
    branch?: string;
    commitMessage?: string;
    createPr?: boolean;
    prTitle?: string;
    prBody?: string;
    prBase?: string;
    dryRun?: boolean;
    apply: boolean;
    help: boolean;
}

const CONFIG_CANDIDATES = ['e2e-ai-agents.config.json', '.e2e-ai-agents.config.json'];

function findConfigUpwards(startDir: string | undefined): string | undefined {
    if (!startDir) {
        return undefined;
    }
    let current = resolve(startDir);
    while (true) {
        for (const candidate of CONFIG_CANDIDATES) {
            const fullPath = join(current, candidate);
            if (existsSync(fullPath)) {
                return fullPath;
            }
        }
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return undefined;
}

function resolveAutoConfig(args: ParsedArgs): string | undefined {
    if (args.configPath) {
        return args.configPath;
    }

    const searchRoots = [
        process.cwd(),
        args.testsRoot,
        args.path,
    ].filter(Boolean) as string[];

    for (const root of searchRoots) {
        const found = findConfigUpwards(root);
        if (found) {
            return found;
        }
    }

    return undefined;
}

function printUsage(): void {
    // eslint-disable-next-line no-console
    console.log(
        [
            'Usage:',
            '  e2e-ai-agents impact --path <app-root> [options]',
            '  e2e-ai-agents gap --path <app-root> [options]',
            '  e2e-ai-agents plan --path <app-root> [options]',
            '  e2e-ai-agents generate --path <app-root> [options]',
            '  e2e-ai-agents heal --path <app-root> --traceability-report <json> [options]',
            '  e2e-ai-agents suggest --path <app-root> [options]',
            '  e2e-ai-agents approve-and-generate --path <app-root> [options]',
            '  e2e-ai-agents auto-heal-pr --path <app-root> [options]',
            '  e2e-ai-agents finalize-generated-tests --path <app-root> [options]',
            '  e2e-ai-agents feedback --path <app-root> --feedback-input <json>',
            '  e2e-ai-agents traceability-capture --path <app-root> --traceability-report <json>',
            '  e2e-ai-agents traceability-ingest --path <app-root> --traceability-input <json>',
            '  e2e-ai-agents llm-health',
            '',
            'Options:',
            '  --config <path>       Path to e2e-ai-agents.config.json (auto-discovered if present)',
            '  --path <app-root>     Path to the web app (required)',
            '  --profile <name>     default | mattermost',
            '  --mattermost         Shortcut for --profile mattermost',
            '  --tests-root <path>   Path to tests root (optional)',
            '  --framework <name>    auto | playwright | cypress | selenium',
            '  --patterns <globs>    Comma-separated test patterns',
            '  --flow-patterns <g>   Comma-separated flow discovery patterns',
            '  --flow-exclude <g>    Comma-separated flow exclude patterns',
            '  --flow-catalog <path> Path to flow catalog JSON',
            '  --allow-fallback      Allow impact analysis without diff',
            '  --pipeline            Run Playwright AI pipeline for missing P0/P1 flows',
            '  --pipeline-scenarios  Number of scenarios per flow (default 3)',
            '  --pipeline-output     Output directory for generated tests',
            '  --pipeline-base-url   Base URL for Playwright runs',
            '  --pipeline-browser    Browser: chrome|chromium|firefox|webkit',
            '  --pipeline-headless   Run in headless mode',
            '  --pipeline-headed     Run in headed mode',
            '  --pipeline-project    Playwright project name',
            '  --pipeline-parallel   Enable parallel mode in generator',
            '  --pipeline-dry-run    Do not execute pipeline (report only)',
            '  --pipeline-mcp        Use Playwright MCP server for exploration/healing',
            '  --pipeline-mcp-allow-fallback  Allow non-MCP fallback if official MCP setup fails',
            '  --pipeline-mcp-only   Require MCP for UI exploration (fail if unavailable)',
            '  --pipeline-mcp-timeout-ms <n>  Timeout per MCP CLI invocation in milliseconds',
            '  --pipeline-mcp-retries <n>  Retry count for retryable MCP CLI failures',
            '  --spec <path>         Optional spec PDF for context',
            '  --since <git-ref>     Git ref for impact analysis (default HEAD~1)',
            '  --time <minutes>      Time limit in minutes',
            '  --budget-usd <amount> Max LLM budget in USD',
            '  --budget-tokens <n>   Max LLM tokens',
            '  --policy-min-confidence <n>   Minimum confidence for targeted suite',
            '  --policy-safe-merge-confidence <n> Confidence needed for safe-to-merge',
            '  --policy-force-full-on-warnings <n> Escalate to full at warning count',
            '  --policy-risky-patterns <globs>     Comma-separated risky file globs',
            '  --policy-enforcement-mode <mode>    advisory | warn | block',
            '  --policy-block-actions <actions>    Comma-separated CI actions to block/warn',
            '  --ci-comment-path <path>            Write CI markdown summary',
            '  --github-output <path>              Write GitHub Actions outputs',
            '  --fail-on-must-add-tests            Exit non-zero on must-add-tests decision',
            '  --feedback-input <path>             Path to recommendation feedback JSON',
            '  --traceability-report <path>        Path to Playwright JSON report for traceability capture',
            '  --traceability-capture-output <path> Output path for generated traceability ingest JSON',
            '  --traceability-coverage-map <path>  Optional coverage map (test<->files) to enrich traceability capture',
            '  --traceability-changed-files <path> Optional changed-files list/JSON fallback for traceability capture',
            '  --traceability-input <path>         Path to traceability ingest JSON payload',
            '  --traceability-min-hits <n>         Minimum signal hits required per file mapping',
            '  --traceability-max-files-per-test <n> Cap max mapped files per test',
            '  --traceability-max-age-days <n>     Drop stale mappings older than N days',
            '  --branch <name>      Optional handoff branch (prefixed with codex/)',
            '  --commit-message <m> Commit message for finalize-generated-tests',
            '  --create-pr          Open PR with gh after commit',
            '  --pr-title <title>   PR title for finalize-generated-tests',
            '  --pr-body <body>     PR body for finalize-generated-tests',
            '  --pr-base <branch>   PR base branch for finalize-generated-tests',
            '                      (auto-heal-pr defaults to base=master)',
            '  --dry-run            Preview actions without mutating git state',
            '  --apply               Apply data-testid patches and generate tests',
            '                        (legacy shortcut; prefer approve-and-generate)',
            '  --help                Show help',
        ].join('\n'),
    );
}

function parseArgs(argv: string[]): ParsedArgs {
    const parsed: ParsedArgs = {apply: false, help: false};
    if (argv.length === 0) {
        return parsed;
    }

    const command = argv[0];
    if (
        command === 'impact'
        || command === 'gap'
        || command === 'plan'
        || command === 'generate'
        || command === 'heal'
        || command === 'suggest'
            || command === 'approve-and-generate'
            || command === 'auto-heal-pr'
            || command === 'finalize-generated-tests'
            || command === 'feedback'
            || command === 'traceability-capture'
            || command === 'traceability-ingest'
            || command === 'llm-health'
    ) {
        parsed.command = command;
    }

    for (let i = 1; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === '--help' || arg === '-h') {
            parsed.help = true;
            continue;
        }
        if (arg === '--apply') {
            parsed.apply = true;
            continue;
        }
        if (arg === '--config' && next) {
            parsed.configPath = next;
            i += 1;
            continue;
        }
        if (arg === '--path' && next) {
            parsed.path = next;
            i += 1;
            continue;
        }
        if (arg === '--profile' && next) {
            if (next === 'default' || next === 'mattermost') {
                parsed.profile = next;
            }
            i += 1;
            continue;
        }
        if (arg === '--mattermost') {
            parsed.profile = 'mattermost';
            continue;
        }
        if (arg === '--tests-root' && next) {
            parsed.testsRoot = next;
            i += 1;
            continue;
        }
        if (arg === '--framework' && next) {
            parsed.framework = next as FrameworkType;
            i += 1;
            continue;
        }
        if (arg === '--patterns' && next) {
            parsed.testPatterns = next.split(',').map((value) => value.trim()).filter(Boolean);
            i += 1;
            continue;
        }
        if (arg === '--flow-patterns' && next) {
            parsed.flowPatterns = next.split(',').map((value) => value.trim()).filter(Boolean);
            i += 1;
            continue;
        }
        if (arg === '--flow-exclude' && next) {
            parsed.flowExclude = next.split(',').map((value) => value.trim()).filter(Boolean);
            i += 1;
            continue;
        }
        if (arg === '--flow-catalog' && next) {
            parsed.flowCatalogPath = next;
            i += 1;
            continue;
        }
        if (arg === '--allow-fallback') {
            parsed.allowFallback = true;
            continue;
        }
        if (arg === '--pipeline') {
            parsed.pipeline = true;
            continue;
        }
        if (arg === '--pipeline-mcp') {
            parsed.pipelineMcp = true;
            continue;
        }
        if (arg === '--pipeline-mcp-allow-fallback') {
            parsed.pipelineMcpAllowFallback = true;
            continue;
        }
        if (arg === '--pipeline-mcp-only') {
            parsed.pipelineMcpOnly = true;
            continue;
        }
        if (arg === '--pipeline-mcp-timeout-ms' && next) {
            parsed.pipelineMcpTimeoutMs = Number(next);
            i += 1;
            continue;
        }
        if (arg === '--pipeline-mcp-retries' && next) {
            parsed.pipelineMcpRetries = Number(next);
            i += 1;
            continue;
        }
        if (arg === '--pipeline-scenarios' && next) {
            const value = Number(next);
            if (Number.isFinite(value)) {
                parsed.pipelineScenarios = value;
            }
            i += 1;
            continue;
        }
        if (arg === '--pipeline-output' && next) {
            parsed.pipelineOutput = next;
            i += 1;
            continue;
        }
        if (arg === '--pipeline-base-url' && next) {
            parsed.pipelineBaseUrl = next;
            i += 1;
            continue;
        }
        if (arg === '--pipeline-browser' && next) {
            const value = next as ParsedArgs['pipelineBrowser'];
            if (value === 'chrome' || value === 'chromium' || value === 'firefox' || value === 'webkit') {
                parsed.pipelineBrowser = value;
            }
            i += 1;
            continue;
        }
        if (arg === '--pipeline-headless') {
            parsed.pipelineHeadless = true;
            continue;
        }
        if (arg === '--pipeline-headed') {
            parsed.pipelineHeadless = false;
            continue;
        }
        if (arg === '--pipeline-project' && next) {
            parsed.pipelineProject = next;
            i += 1;
            continue;
        }
        if (arg === '--pipeline-parallel') {
            parsed.pipelineParallel = true;
            continue;
        }
        if (arg === '--pipeline-dry-run') {
            parsed.pipelineDryRun = true;
            continue;
        }
        if (arg === '--spec' && next) {
            parsed.specPDF = next;
            i += 1;
            continue;
        }
        if (arg === '--since' && next) {
            parsed.gitSince = next;
            i += 1;
            continue;
        }
        if (arg === '--time' && next) {
            const value = Number(next);
            if (Number.isFinite(value)) {
                parsed.timeLimitMinutes = value;
            }
            i += 1;
            continue;
        }
        if (arg === '--budget-usd' && next) {
            const value = Number(next);
            if (Number.isFinite(value)) {
                parsed.budgetUSD = value;
            }
            i += 1;
            continue;
        }
        if (arg === '--budget-tokens' && next) {
            const value = Number(next);
            if (Number.isFinite(value)) {
                parsed.budgetTokens = value;
            }
            i += 1;
            continue;
        }
        if (arg === '--policy-min-confidence' && next) {
            const value = Number(next);
            if (Number.isFinite(value)) {
                parsed.policyMinConfidence = value;
            }
            i += 1;
            continue;
        }
        if (arg === '--policy-safe-merge-confidence' && next) {
            const value = Number(next);
            if (Number.isFinite(value)) {
                parsed.policySafeMergeConfidence = value;
            }
            i += 1;
            continue;
        }
        if (arg === '--policy-force-full-on-warnings' && next) {
            const value = Number(next);
            if (Number.isFinite(value)) {
                parsed.policyWarningsThreshold = value;
            }
            i += 1;
            continue;
        }
        if (arg === '--policy-risky-patterns' && next) {
            parsed.policyRiskyPatterns = next.split(',').map((value) => value.trim()).filter(Boolean);
            i += 1;
            continue;
        }
        if (arg === '--policy-enforcement-mode' && next) {
            if (next === 'advisory' || next === 'warn' || next === 'block') {
                parsed.policyEnforcementMode = next;
            }
            i += 1;
            continue;
        }
        if (arg === '--policy-block-actions' && next) {
            parsed.policyBlockActions = next
                .split(',')
                .map((value) => value.trim())
                .filter((value): value is 'run-now' | 'must-add-tests' | 'safe-to-merge' => (
                    value === 'run-now' || value === 'must-add-tests' || value === 'safe-to-merge'
                ));
            i += 1;
            continue;
        }
        if (arg === '--ci-comment-path' && next) {
            parsed.ciCommentPath = next;
            i += 1;
            continue;
        }
        if (arg === '--github-output' && next) {
            parsed.githubOutputPath = next;
            i += 1;
            continue;
        }
        if (arg === '--fail-on-must-add-tests') {
            parsed.failOnMustAddTests = true;
            continue;
        }
        if (arg === '--feedback-input' && next) {
            parsed.feedbackInputPath = next;
            i += 1;
            continue;
        }
        if (arg === '--traceability-report' && next) {
            parsed.traceabilityReportPath = next;
            i += 1;
            continue;
        }
        if (arg === '--traceability-capture-output' && next) {
            parsed.traceabilityCaptureOutputPath = next;
            i += 1;
            continue;
        }
        if (arg === '--traceability-coverage-map' && next) {
            parsed.traceabilityCoverageMapPath = next;
            i += 1;
            continue;
        }
        if (arg === '--traceability-changed-files' && next) {
            parsed.traceabilityChangedFilesPath = next;
            i += 1;
            continue;
        }
        if (arg === '--traceability-input' && next) {
            parsed.traceabilityInputPath = next;
            i += 1;
            continue;
        }
        if (arg === '--traceability-min-hits' && next) {
            const value = Number(next);
            if (Number.isFinite(value)) {
                parsed.traceabilityMinHits = value;
            }
            i += 1;
            continue;
        }
        if (arg === '--traceability-max-files-per-test' && next) {
            const value = Number(next);
            if (Number.isFinite(value)) {
                parsed.traceabilityMaxFilesPerTest = value;
            }
            i += 1;
            continue;
        }
        if (arg === '--traceability-max-age-days' && next) {
            const value = Number(next);
            if (Number.isFinite(value)) {
                parsed.traceabilityMaxAgeDays = value;
            }
            i += 1;
            continue;
        }
        if (arg === '--branch' && next) {
            parsed.branch = next;
            i += 1;
            continue;
        }
        if (arg === '--commit-message' && next) {
            parsed.commitMessage = next;
            i += 1;
            continue;
        }
        if (arg === '--create-pr') {
            parsed.createPr = true;
            continue;
        }
        if (arg === '--pr-title' && next) {
            parsed.prTitle = next;
            i += 1;
            continue;
        }
        if (arg === '--pr-body' && next) {
            parsed.prBody = next;
            i += 1;
            continue;
        }
        if (arg === '--pr-base' && next) {
            parsed.prBase = next;
            i += 1;
            continue;
        }
        if (arg === '--dry-run') {
            parsed.dryRun = true;
            continue;
        }
    }

    return parsed;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const autoConfig = resolveAutoConfig(args);

    if (args.help || !args.command) {
        printUsage();
        process.exit(args.command ? 0 : 1);
    }

    if (args.command === 'llm-health') {
        await runLlmHealth();
        return;
    }

    if (args.command === 'feedback') {
        if (!args.path && !autoConfig) {
            // eslint-disable-next-line no-console
            console.error('Error: --path is required for feedback command');
            process.exit(1);
        }
        if (!args.feedbackInputPath) {
            // eslint-disable-next-line no-console
            console.error('Error: --feedback-input <path> is required for feedback command');
            process.exit(1);
        }

        const {config} = resolveConfig(process.cwd(), autoConfig, {
            path: args.path,
            profile: args.profile,
            testsRoot: args.testsRoot,
            mode: 'impact',
        });
        const reportRoot = config.testsRoot || config.path;
        const raw = JSON.parse(readFileSync(args.feedbackInputPath, 'utf-8')) as RecommendationFeedbackEntry;
        const payload: RecommendationFeedbackEntry = {
            timestamp: raw.timestamp || new Date().toISOString(),
            runSet: raw.runSet || 'targeted',
            recommendedTests: raw.recommendedTests || [],
            executedTests: raw.executedTests || [],
            failedTests: raw.failedTests || [],
            escapedFailures: raw.escapedFailures || [],
        };
        const output = appendFeedbackAndRecompute(reportRoot, payload);
        // eslint-disable-next-line no-console
        console.log(`Feedback data: ${output.feedbackPath}`);
        // eslint-disable-next-line no-console
        console.log(`Calibration data: ${output.calibrationPath}`);
        // eslint-disable-next-line no-console
        console.log(
            `Calibration overall: precision=${output.calibration.overall.precision}, recall=${output.calibration.overall.recall}, fnr=${output.calibration.overall.falseNegativeRate}`,
        );
        return;
    }

    if (args.command === 'traceability-capture') {
        if (!args.path && !autoConfig) {
            // eslint-disable-next-line no-console
            console.error('Error: --path is required for traceability-capture command');
            process.exit(1);
        }
        if (!args.traceabilityReportPath) {
            // eslint-disable-next-line no-console
            console.error('Error: --traceability-report <path> is required for traceability-capture command');
            process.exit(1);
        }

        const {config} = resolveConfig(process.cwd(), autoConfig, {
            path: args.path,
            profile: args.profile,
            testsRoot: args.testsRoot,
            mode: 'impact',
            gitSince: args.gitSince,
        });
        const reportRoot = config.testsRoot || config.path;
        const output = captureTraceabilityInput({
            appPath: config.path,
            testsRoot: reportRoot,
            reportPath: args.traceabilityReportPath,
            sinceRef: args.gitSince || config.git.since,
            outputPath: args.traceabilityCaptureOutputPath,
            coverageMapPath: args.traceabilityCoverageMapPath,
            changedFilesPath: args.traceabilityChangedFilesPath,
        });
        // eslint-disable-next-line no-console
        console.log(`Traceability input: ${output.outputPath}`);
        // eslint-disable-next-line no-console
        console.log(`Traceability tests seen: ${output.testsSeen}`);
        // eslint-disable-next-line no-console
        console.log(`Traceability runs generated: ${output.runsGenerated}`);
        // eslint-disable-next-line no-console
        console.log(`Traceability changed files used: ${output.changedFilesUsed}`);
        if (output.warnings.length > 0) {
            // eslint-disable-next-line no-console
            console.log(`Traceability warnings: ${output.warnings.join(' | ')}`);
        }
        return;
    }

    if (args.command === 'traceability-ingest') {
        if (!args.path && !autoConfig) {
            // eslint-disable-next-line no-console
            console.error('Error: --path is required for traceability-ingest command');
            process.exit(1);
        }
        if (!args.traceabilityInputPath) {
            // eslint-disable-next-line no-console
            console.error('Error: --traceability-input <path> is required for traceability-ingest command');
            process.exit(1);
        }

        const {config} = resolveConfig(process.cwd(), autoConfig, {
            path: args.path,
            profile: args.profile,
            testsRoot: args.testsRoot,
            mode: 'impact',
        });
        const reportRoot = config.testsRoot || config.path;
        const raw = JSON.parse(readFileSync(args.traceabilityInputPath, 'utf-8')) as unknown;
        const output = ingestTraceabilityInput(
            reportRoot,
            config.impact.traceability,
            raw,
            {
                minHits: args.traceabilityMinHits,
                maxFilesPerTest: args.traceabilityMaxFilesPerTest,
                maxAgeDays: args.traceabilityMaxAgeDays,
            },
        );
        // eslint-disable-next-line no-console
        console.log(`Traceability manifest: ${output.manifestPath}`);
        // eslint-disable-next-line no-console
        console.log(`Traceability state: ${output.statePath}`);
        // eslint-disable-next-line no-console
        console.log(`Traceability ingested entries: ${output.entriesIngested}`);
        // eslint-disable-next-line no-console
        console.log(`Traceability tracked tests: ${output.testsTracked}`);
        // eslint-disable-next-line no-console
        console.log(`Traceability tracked edges: ${output.edgesTracked}`);
        if (output.warnings.length > 0) {
            // eslint-disable-next-line no-console
            console.log(`Traceability warnings: ${output.warnings.join(' | ')}`);
        }
        return;
    }

    if (args.command === 'finalize-generated-tests') {
        if (!args.path && !autoConfig) {
            // eslint-disable-next-line no-console
            console.error('Error: --path is required for finalize-generated-tests command');
            process.exit(1);
        }
        const {config} = resolveConfig(process.cwd(), autoConfig, {
            path: args.path,
            profile: args.profile,
            testsRoot: args.testsRoot,
            mode: 'gap',
        });
        const result = finalizeGeneratedTests({
            appPath: config.path,
            testsRoot: config.testsRoot || config.path,
            branch: args.branch,
            commitMessage: args.commitMessage,
            createPr: args.createPr,
            prTitle: args.prTitle,
            prBody: args.prBody,
            baseBranch: args.prBase,
            dryRun: args.dryRun,
        });
        // eslint-disable-next-line no-console
        console.log(`Finalize repo root: ${result.repoRoot}`);
        // eslint-disable-next-line no-console
        console.log(`Finalize branch: ${result.branch}`);
        // eslint-disable-next-line no-console
        console.log(`Finalize staged paths: ${result.stagedPaths.join(', ') || 'none'}`);
        // eslint-disable-next-line no-console
        console.log(`Finalize commit: ${result.committed ? 'created' : 'skipped'}`);
        if (result.commitSha) {
            // eslint-disable-next-line no-console
            console.log(`Finalize commit sha: ${result.commitSha}`);
        }
        if (result.prUrl) {
            // eslint-disable-next-line no-console
            console.log(`Finalize PR: ${result.prUrl}`);
        }
        return;
    }

    if (args.command === 'auto-heal-pr') {
        if (!args.path && !autoConfig) {
            // eslint-disable-next-line no-console
            console.error('Error: --path is required for auto-heal-pr command');
            process.exit(1);
        }
        const {config} = resolveConfig(process.cwd(), autoConfig, {
            path: args.path,
            profile: args.profile,
            testsRoot: args.testsRoot,
            mode: 'gap',
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
            pipeline: {
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
            },
        });
        if (args.allowFallback) {
            config.impact.allowFallback = true;
        }

        await runGap(config, {apply: true});
        const reportRoot = config.testsRoot || config.path;
        if (args.traceabilityReportPath) {
            const unstableSpecs = extractPlaywrightUnstableSpecs(args.traceabilityReportPath, [reportRoot, config.path]);
            if (unstableSpecs.length > 0) {
                const targetedSummary = runTargetedSpecHeal(
                    reportRoot,
                    unstableSpecs.map((spec) => ({
                        specPath: spec.specPath,
                        status: spec.status,
                        reason: `Playwright report: failingTests=${spec.failingTests}, flakyTests=${spec.flakyTests}`,
                    })),
                    {
                        ...config.pipeline,
                        enabled: true,
                        heal: true,
                    },
                );
                const healedCount = targetedSummary.results.filter((result) => result.healStatus === 'success').length;
                // eslint-disable-next-line no-console
                console.log(`Auto-heal targeted unstable specs: ${unstableSpecs.length} (healed=${healedCount})`);
                if (targetedSummary.warnings.length > 0) {
                    // eslint-disable-next-line no-console
                    console.log(`Auto-heal warnings: ${targetedSummary.warnings.join(' | ')}`);
                }

                const gapPath = join(reportRoot, '.e2e-ai-agents', 'gap.json');
                if (existsSync(gapPath)) {
                    const gap = JSON.parse(readFileSync(gapPath, 'utf-8')) as {
                        pipeline?: {
                            runner?: string;
                            results?: unknown[];
                            warnings?: string[];
                        };
                    };
                    const existingResults = Array.isArray(gap.pipeline?.results) ? gap.pipeline?.results : [];
                    const existingWarnings = Array.isArray(gap.pipeline?.warnings) ? gap.pipeline?.warnings : [];
                    gap.pipeline = {
                        runner: gap.pipeline?.runner || targetedSummary.runner,
                        results: [...existingResults, ...targetedSummary.results],
                        warnings: Array.from(new Set([...(existingWarnings || []), ...targetedSummary.warnings])),
                    };
                    writeFileSync(gapPath, `${JSON.stringify(gap, null, 2)}\n`, 'utf-8');
                }
            } else {
                // eslint-disable-next-line no-console
                console.log('Auto-heal targeted unstable specs: 0');
            }
        }

        const branchSuffix = new Date().toISOString().replace(/[:.]/g, '-');
        const result = finalizeGeneratedTests({
            appPath: config.path,
            testsRoot: reportRoot,
            branch: args.branch || `auto-heal-${branchSuffix}`,
            commitMessage: args.commitMessage || 'test(e2e): auto-heal generated specs',
            createPr: true,
            prTitle: args.prTitle || 'test(e2e): auto-heal generated specs',
            prBody: args.prBody || 'Automated e2e-heal run generated by @yasserkhanorg/e2e-agents.',
            baseBranch: args.prBase || 'master',
            dryRun: args.dryRun,
        });
        // eslint-disable-next-line no-console
        console.log(`Auto-heal repo root: ${result.repoRoot}`);
        // eslint-disable-next-line no-console
        console.log(`Auto-heal branch: ${result.branch}`);
        // eslint-disable-next-line no-console
        console.log(`Auto-heal staged paths: ${result.stagedPaths.join(', ') || 'none'}`);
        // eslint-disable-next-line no-console
        console.log(`Auto-heal commit: ${result.committed ? 'created' : 'skipped'}`);
        if (result.commitSha) {
            // eslint-disable-next-line no-console
            console.log(`Auto-heal commit sha: ${result.commitSha}`);
        }
        if (result.prUrl) {
            // eslint-disable-next-line no-console
            console.log(`Auto-heal PR: ${result.prUrl}`);
        }
        return;
    }

    if (args.command === 'heal') {
        if (!args.path && !autoConfig) {
            // eslint-disable-next-line no-console
            console.error('Error: --path is required for heal command');
            process.exit(1);
        }
        if (!args.traceabilityReportPath) {
            // eslint-disable-next-line no-console
            console.error('Error: --traceability-report <path> is required for heal command');
            process.exit(1);
        }

        const {config} = resolveConfig(process.cwd(), autoConfig, {
            path: args.path,
            profile: args.profile,
            testsRoot: args.testsRoot,
            mode: 'gap',
            framework: args.framework,
            pipeline: {
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
            },
        });

        const reportRoot = config.testsRoot || config.path;
        const unstableSpecs = extractPlaywrightUnstableSpecs(args.traceabilityReportPath, [reportRoot, config.path]);
        if (unstableSpecs.length === 0) {
            // eslint-disable-next-line no-console
            console.log('Heal targeted unstable specs: 0');
            return;
        }

        const targetedSummary = runTargetedSpecHeal(
            reportRoot,
            unstableSpecs.map((spec) => ({
                specPath: spec.specPath,
                status: spec.status,
                reason: `Playwright report: failingTests=${spec.failingTests}, flakyTests=${spec.flakyTests}`,
            })),
            {
                ...config.pipeline,
                enabled: true,
                heal: true,
            },
        );
        const healedCount = targetedSummary.results.filter((result) => result.healStatus === 'success').length;
        // eslint-disable-next-line no-console
        console.log(`Heal targeted unstable specs: ${unstableSpecs.length} (healed=${healedCount})`);
        if (targetedSummary.warnings.length > 0) {
            // eslint-disable-next-line no-console
            console.log(`Heal warnings: ${targetedSummary.warnings.join(' | ')}`);
        }
        return;
    }

    if (!args.path && !autoConfig) {
        // eslint-disable-next-line no-console
        console.error('Error: --path is required (or provide a config file with path set)');
        printUsage();
        process.exit(1);
    }

    const forcePipelineFromApproval = args.command === 'approve-and-generate' || args.command === 'generate';
    const forceAIPipelineFromApproval = args.command === 'approve-and-generate' || args.command === 'generate';
    const {config, configPath} = resolveConfig(process.cwd(), autoConfig, {
        path: args.path,
        profile: args.profile,
        testsRoot: args.testsRoot,
        mode: (args.command === 'gap' || args.command === 'approve-and-generate' || args.command === 'generate') ? 'gap' : 'impact',
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
        pipeline: (args.pipeline || forcePipelineFromApproval)
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
                  mcp: args.pipelineMcp !== undefined ? args.pipelineMcp : forceAIPipelineFromApproval,
                  mcpAllowFallback: args.pipelineMcpAllowFallback,
                  mcpOnly: args.pipelineMcpOnly !== undefined ? args.pipelineMcpOnly : forceAIPipelineFromApproval,
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

    if (args.allowFallback) {
        config.impact.allowFallback = true;
    }

    if (args.command === 'impact') {
        await runImpact(config, {apply: args.apply});
        return;
    }

    if (args.command === 'suggest' || args.command === 'plan') {
        await runImpact(config, {apply: args.apply});
        const reportRoot = config.testsRoot || config.path;
        const impactPath = join(reportRoot, '.e2e-ai-agents', 'impact.json');
        if (!existsSync(impactPath)) {
            throw new Error(`Impact report not found at ${impactPath}`);
        }
        const impact = JSON.parse(readFileSync(impactPath, 'utf-8')) as ReportData;
        const basePlan = buildPlanFromImpactReport(impact, config.policy);
        const withActions = attachDeveloperActions(basePlan, {
            appPath: config.path,
            testsRoot: reportRoot,
            sinceRef: config.git.since,
            configPath,
        });
        const plan = applyOperationalInsights(withActions, reportRoot);
        const planPath = writePlanReport(reportRoot, plan);
        const summaryMarkdown = renderCiSummaryMarkdown(plan);
        const summaryPath = writeCiSummary(reportRoot, summaryMarkdown, args.ciCommentPath);
        const metrics = appendPlanMetrics(reportRoot, plan);
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
            appendFileSync(ghaOutput, `metrics_events_path=${metrics.eventsPath}\n`);
            appendFileSync(ghaOutput, `metrics_summary_path=${metrics.summaryPath}\n`);
        }
        // eslint-disable-next-line no-console
        console.log(`Suggested run set: ${plan.runSet} (confidence ${plan.confidence})`);
        // eslint-disable-next-line no-console
        console.log(`Decision: ${plan.decision.action} - ${plan.decision.summary}`);
        // eslint-disable-next-line no-console
        console.log(`Enforcement: ${plan.enforcement.mode} (shouldFail=${plan.enforcement.shouldFail})`);
        // eslint-disable-next-line no-console
        console.log(`Plan data: ${planPath}`);
        // eslint-disable-next-line no-console
        console.log(`CI summary: ${summaryPath}`);
        // eslint-disable-next-line no-console
        console.log(`Plan metrics: ${metrics.summaryPath}`);
        if (plan.nextActions) {
            // eslint-disable-next-line no-console
            console.log(`Next action (run existing): ${plan.nextActions.runRecommendedTests || plan.nextActions.runSmokeSuite}`);
            // eslint-disable-next-line no-console
            console.log(`Next action (approve + generate): ${plan.nextActions.approveAndGenerate || plan.nextActions.generateMissingTests}`);
            // eslint-disable-next-line no-console
            console.log(`Next action (heal): ${plan.nextActions.healGeneratedTests}`);
        }
        const failOnLegacyFlag = args.failOnMustAddTests && plan.decision.action === 'must-add-tests';
        if (failOnLegacyFlag || plan.enforcement.shouldFail) {
            process.exit(2);
        }
        return;
    }

    if (args.command === 'approve-and-generate' || args.command === 'generate') {
        await runGap(config, {apply: args.apply});
        return;
    }

    await runGap(config, {apply: args.apply});
}

async function runLlmHealth(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) {
        // eslint-disable-next-line no-console
        console.error('ANTHROPIC_API_KEY is required for llm-health.');
        process.exit(1);
    }

    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
    const provider = new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model,
    });

    try {
        const response = await provider.generateText('Reply with OK.', {maxTokens: 8, timeout: 15000});
        const text = response.text.trim();
        // eslint-disable-next-line no-console
        console.log(`Anthropic OK (${model}) -> ${text}`);
    } catch (error) {
        if (error instanceof LLMProviderError) {
            // eslint-disable-next-line no-console
            console.error(`Anthropic failed: ${error.message}`);
            if (error.cause instanceof Error) {
                // eslint-disable-next-line no-console
                console.error(`Cause: ${error.cause.message}`);
            }
        } else if (error instanceof Error) {
            // eslint-disable-next-line no-console
            console.error(`Anthropic failed: ${error.message}`);
        } else {
            // eslint-disable-next-line no-console
            console.error(`Anthropic failed: ${String(error)}`);
        }
        process.exit(1);
    }
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

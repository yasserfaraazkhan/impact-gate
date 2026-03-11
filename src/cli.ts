#!/usr/bin/env node
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join, resolve} from 'path';

import {resolveConfig, type AnalysisMode, type AnalysisProfile, type FrameworkType} from './agent/config.js';
import {AnthropicProvider} from './anthropic_provider.js';
import {LLMProviderError} from './provider_interface.js';
import {analyzeImpact as analyzeImpactV2} from './engine/impact_engine.js';
import {writeCiSummary} from './engine/plan_builder.js';
import {getChangedFiles} from './agent/git.js';
import {recommendTestsAI, recommendTestsDeterministic} from './api.js';
import {appendFeedbackAndRecompute, type RecommendationFeedbackEntry} from './agent/feedback.js';
import {finalizeGeneratedTests} from './agent/handoff.js';
import {ingestTraceabilityInput} from './agent/traceability_ingest.js';
import {captureTraceabilityInput} from './agent/traceability_capture.js';
import {runTargetedSpecHeal} from './agent/pipeline.js';
import {extractPlaywrightUnstableSpecs} from './agent/playwright_report.js';
import {runPipeline} from './pipeline/orchestrator.js';
import {LLMProviderFactory} from './provider_factory.js';
import {runAgenticGeneration, type ScenarioInput} from './agentic/runner.js';
import {loadOrBuildApiSurface} from './knowledge/api_surface.js';

type Command =
    'impact'
    | 'plan'
    | 'heal'
    | 'suggest'
    | 'generate'
    | 'finalize-generated-tests'
    | 'feedback'
    | 'traceability-capture'
    | 'traceability-ingest'
    | 'analyze'
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
    llmProvider?: string;
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
    analyzeGenerate?: boolean;
    analyzeGenerateOutputDir?: string;
    analyzeHeal?: boolean;
    analyzeHealReport?: string;
    noAi?: boolean;
    maxAttempts?: number;
    generateScenarios?: string;
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
            '  e2e-ai-agents plan --path <app-root> [options]',
            '  e2e-ai-agents suggest --path <app-root> [options]',
            '  e2e-ai-agents heal --path <app-root> --traceability-report <json> [options]',
            '  e2e-ai-agents finalize-generated-tests --path <app-root> [options]',
            '  e2e-ai-agents feedback --path <app-root> --feedback-input <json>',
            '  e2e-ai-agents traceability-capture --path <app-root> --traceability-report <json>',
            '  e2e-ai-agents traceability-ingest --path <app-root> --traceability-input <json>',
            '  e2e-ai-agents generate [--scenarios <path|json>] [--max-attempts <n>] [--dry-run]',
            '  e2e-ai-agents analyze --path <app-root> [--tests-root <path>] [--since <ref>] [--generate] [--generate-output <dir>] [--heal] [--heal-report <json>]',
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
            '  --llm-provider <name> LLM provider: auto | anthropic | openai | ollama',
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
            '  --max-attempts <n>    Max fix attempts per scenario (default: 3)',
            '  --scenarios <path|json>  Scenarios file/JSON for generate command',
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
        || command === 'plan'
        || command === 'heal'
        || command === 'suggest'
        || command === 'generate'
            || command === 'finalize-generated-tests'
            || command === 'feedback'
            || command === 'traceability-capture'
            || command === 'traceability-ingest'
            || command === 'analyze'
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
        if (arg === '--max-attempts' && next) {
            parsed.maxAttempts = parseInt(next, 10);
            i += 1;
            continue;
        }
        if (arg === '--scenarios' && next) {
            parsed.generateScenarios = next;
            i += 1;
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
        if (arg === '--llm-provider' && next) {
            parsed.llmProvider = next;
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
        if (arg === '--generate') {
            parsed.analyzeGenerate = true;
            continue;
        }
        if (arg === '--generate-output' && next) {
            parsed.analyzeGenerateOutputDir = next;
            i += 1;
            continue;
        }
        if (arg === '--heal') {
            parsed.analyzeHeal = true;
            continue;
        }
        if (arg === '--heal-report' && next) {
            parsed.analyzeHealReport = next;
            i += 1;
            continue;
        }
        if (arg === '--no-ai') {
            parsed.noAi = true;
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

    if (args.command === 'analyze') {
        if (!args.path && !autoConfig) {
            // eslint-disable-next-line no-console
            console.error('Error: --path is required for analyze command');
            process.exit(1);
        }

        const {config} = resolveConfig(process.cwd(), autoConfig, {
            path: args.path,
            profile: args.profile,
            testsRoot: args.testsRoot,
            mode: 'impact',
            gitSince: args.gitSince,
            llmProvider: args.llmProvider,
        });
        const testsRoot = config.testsRoot || config.path;

        const analyzeStages: Array<'preprocess' | 'impact' | 'coverage' | 'generation' | 'heal'> = [
            'preprocess', 'impact', 'coverage',
        ];
        if (args.analyzeGenerate) {
            analyzeStages.push('generation');
        }
        if (args.analyzeHeal || args.analyzeHealReport) {
            analyzeStages.push('heal');
        }

        const result = await runPipeline({
            appPath: config.path,
            testsRoot,
            gitSince: args.gitSince || config.git.since,
            routeFamilies: config.routeFamilies,
            apiSurface: config.apiSurface,
            stages: analyzeStages,
            generation: args.analyzeGenerate
                ? {
                      defaultOutputDir: args.analyzeGenerateOutputDir || 'specs/functional/ai-assisted',
                      dryRun: args.dryRun,
                  }
                : undefined,
            heal: (args.analyzeHeal || args.analyzeHealReport)
                ? {
                      mcp: args.pipelineMcp ?? true,
                      mcpAllowFallback: args.pipelineMcpAllowFallback ?? false,
                      mcpOnly: args.pipelineMcpOnly ?? false,
                      mcpCommandTimeoutMs: args.pipelineMcpTimeoutMs,
                      mcpRetries: args.pipelineMcpRetries ?? 1,
                      dryRun: args.dryRun,
                  }
                : undefined,
            playwrightReportPath: args.analyzeHealReport,
        });

        // eslint-disable-next-line no-console
        console.log(`Analyze report: ${result.reportPath}`);
        // eslint-disable-next-line no-console
        console.log(`Analyze flows identified: ${result.report.summary.flowsIdentified}`);
        // eslint-disable-next-line no-console
        console.log(`Analyze flows covered: ${result.report.summary.flowsCovered}`);
        // eslint-disable-next-line no-console
        console.log(`Analyze flows uncovered: ${result.report.summary.flowsUncovered}`);
        // eslint-disable-next-line no-console
        console.log(`Analyze overall confidence: ${result.report.summary.overallConfidence}`);
        // eslint-disable-next-line no-console
        console.log(`Analyze route families: ${result.report.summary.routeFamiliesImpacted.join(', ') || 'none'}`);
        if (result.generated && result.generated.length > 0) {
            const written = result.generated.filter((g) => g.written).length;
            // eslint-disable-next-line no-console
            console.log(`Analyze generated specs: ${result.generated.length} (written=${written})`);
            for (const g of result.generated) {
                // eslint-disable-next-line no-console
                console.log(`  ${g.mode}: ${g.specPath}`);
            }
        }
        if (result.healResult) {
            const healed = result.healResult.summary.results.filter((r) => r.healStatus === 'success').length;
            const healFailed = result.healResult.summary.results.filter((r) => r.healStatus === 'failed').length;
            // eslint-disable-next-line no-console
            console.log(`Analyze heal targets: ${result.healResult.targets.length} (healed=${healed}, failed=${healFailed})`);
        }
        if (result.warnings.length > 0) {
            // eslint-disable-next-line no-console
            console.log(`Analyze warnings: ${result.warnings.join(' | ')}`);
        }
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
            llmProvider: args.llmProvider,
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
            llmProvider: args.llmProvider,
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
            llmProvider: args.llmProvider,
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
            llmProvider: args.llmProvider,
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
            llmProvider: args.llmProvider,
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
        const reportRoot = config.testsRoot || config.path;
        const gitResult = getChangedFiles(config.path, config.git.since, {includeUncommitted: config.git.includeUncommitted});
        const impactResult = analyzeImpactV2(gitResult.files, {
            testsRoot: reportRoot,
            routeFamilies: config.routeFamilies,
        });
        // eslint-disable-next-line no-console
        console.log(`Impact: ${impactResult.changedFiles.length} changed files → ${impactResult.impactedFeatures.length} features impacted`);
        // eslint-disable-next-line no-console
        console.log(`Unbound files: ${impactResult.unboundFiles.length}`);
        for (const f of impactResult.impactedFeatures) {
            const label = f.featureId || f.familyId;
            // eslint-disable-next-line no-console
            console.log(`  [${f.priority}] ${label}: ${f.coverageStatus} (PW=${f.playwrightSpecs.length}, Cy=${f.cypressSpecs.length})`);
        }
        if (impactResult.warnings.length > 0) {
            for (const w of impactResult.warnings) {
                // eslint-disable-next-line no-console
                console.warn(`  Warning: ${w}`);
            }
        }
        return;
    }

    if (args.command === 'suggest' || args.command === 'plan') {
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
                // eslint-disable-next-line no-console
                console.log(`AI enrichment: ${aiEnrichment.enrichedFeatures.length} features enriched (${aiEnrichment.tokenUsage.input + aiEnrichment.tokenUsage.output} tokens)`);
            } else if (!process.env.ANTHROPIC_API_KEY) {
                // eslint-disable-next-line no-console
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
        console.log(`Plan metrics: ${metricsSummaryPath}`);
        const failOnLegacyFlag = args.failOnMustAddTests && plan.decision.action === 'must-add-tests';
        if (failOnLegacyFlag || plan.enforcement.shouldFail) {
            process.exit(2);
        }
        return;
    }

    if (args.command === 'generate') {
        const reportRoot = config.testsRoot || config.path;

        // Load scenarios from --scenarios flag or plan-report.json
        let scenarios: ScenarioInput[] = [];

        if (args.generateScenarios) {
            let raw: unknown;
            if (existsSync(args.generateScenarios)) {
                raw = JSON.parse(readFileSync(args.generateScenarios, 'utf-8'));
            } else {
                raw = JSON.parse(args.generateScenarios);
            }
            if (!Array.isArray(raw)) {
                // eslint-disable-next-line no-console
                console.error('--scenarios must be a JSON array of ScenarioInput objects.');
                process.exit(1);
            }
            for (const item of raw as Record<string, unknown>[]) {
                if (!item.id || !item.name || !Array.isArray(item.scenarios) || !item.routeFamily || !item.priority) {
                    // eslint-disable-next-line no-console
                    console.error(`Invalid scenario: each must have id, name, scenarios[], routeFamily, priority.`);
                    process.exit(1);
                }
            }
            scenarios = raw as ScenarioInput[];
        } else {
            const planReportPath = join(reportRoot, '.e2e-ai-agents', 'plan-report.json');
            if (!existsSync(planReportPath)) {
                // eslint-disable-next-line no-console
                console.error('No plan report found. Run `plan` first or pass --scenarios.');
                process.exit(1);
            }
            const planReport = JSON.parse(readFileSync(planReportPath, 'utf-8'));
            scenarios = (planReport.gapDetails || []).map((gap: {id: string; reasons: string[]; missingScenarios: string[]}) => ({
                id: gap.id,
                name: gap.id,
                scenarios: gap.missingScenarios || gap.reasons || ['Verify core user flow'],
                routeFamily: gap.id.split('.')[0] || gap.id,
                priority: 'P1',
            }));
        }

        if (scenarios.length === 0) {
            // eslint-disable-next-line no-console
            console.log('No scenarios to generate tests for.');
            return;
        }

        let apiSurface;
        try {
            apiSurface = loadOrBuildApiSurface(reportRoot, config.apiSurface);
        } catch {
            // eslint-disable-next-line no-console
            console.warn('Could not load API surface catalog. Generation will use generic selectors.');
        }

        const provider = await LLMProviderFactory.createFromEnv();

        // eslint-disable-next-line no-console
        console.log(`Generating tests for ${scenarios.length} scenario(s)...`);

        const summary = await runAgenticGeneration({
            scenarios,
            config: {
                maxAttempts: args.maxAttempts || 3,
                project: args.pipelineProject || 'chrome',
                baseUrl: args.pipelineBaseUrl,
                testTimeoutMs: 120000,
                testsRoot: reportRoot,
                dryRun: args.dryRun,
            },
            provider,
            apiSurface,
        });

        // eslint-disable-next-line no-console
        console.log(`\nAgentic Generation Summary:`);
        // eslint-disable-next-line no-console
        console.log(`  Generated: ${summary.totalGenerated}`);
        // eslint-disable-next-line no-console
        console.log(`  Passed:    ${summary.totalPassed}`);
        // eslint-disable-next-line no-console
        console.log(`  Failed:    ${summary.totalFailed}`);
        // eslint-disable-next-line no-console
        console.log(`  Attempts:  ${summary.totalAttempts}`);
        // eslint-disable-next-line no-console
        console.log(`  Duration:  ${(summary.durationMs / 1000).toFixed(1)}s`);

        for (const result of summary.results) {
            const icon = result.status === 'passed' ? 'PASS' : result.status === 'skipped' ? 'SKIP' : 'FAIL';
            // eslint-disable-next-line no-console
            console.log(`  [${icon}] ${result.scenarioSource} (${result.attempts} attempts)`);
            if (result.status === 'passed' || result.status === 'skipped') {
                // eslint-disable-next-line no-console
                console.log(`     ${result.specPath}`);
            }
        }

        if (summary.warnings.length > 0) {
            // eslint-disable-next-line no-console
            console.log(`\nWarnings:`);
            for (const w of summary.warnings) {
                // eslint-disable-next-line no-console
                console.warn(`  - ${w}`);
            }
        }

        const summaryDir = join(reportRoot, '.e2e-ai-agents');
        if (!existsSync(summaryDir)) {
            mkdirSync(summaryDir, {recursive: true});
        }
        const summaryPath = join(summaryDir, 'agentic-summary.json');
        writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
        // eslint-disable-next-line no-console
        console.log(`\nReport: ${summaryPath}`);

        if (summary.totalFailed > 0) {
            process.exit(1);
        }
        return;
    }

    // eslint-disable-next-line no-console
    console.error(`Unknown command: ${args.command}`);
    printUsage();
    process.exit(1);
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

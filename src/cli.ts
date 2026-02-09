#!/usr/bin/env node
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync} from 'fs';
import {dirname, join, resolve} from 'path';

import {resolveConfig, type AnalysisMode, type FrameworkType} from './agent/config.js';
import {AnthropicProvider} from './anthropic_provider.js';
import {LLMProviderError} from './provider_interface.js';
import {runGap, runImpact} from './agent/runner.js';

type Command = AnalysisMode | 'llm-health';

interface ParsedArgs {
    command?: Command;
    configPath?: string;
    path?: string;
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
            '  e2e-ai-agents llm-health',
            '',
            'Options:',
            '  --config <path>       Path to e2e-ai-agents.config.json (auto-discovered if present)',
            '  --path <app-root>     Path to the web app (required)',
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
            '  --pipeline-project    Playwright project name',
            '  --pipeline-parallel   Enable parallel mode in generator',
            '  --pipeline-dry-run    Do not execute pipeline (report only)',
            '  --pipeline-mcp        Use Playwright MCP server for exploration/healing',
            '  --spec <path>         Optional spec PDF for context',
            '  --since <git-ref>     Git ref for impact analysis (default HEAD~1)',
            '  --time <minutes>      Time limit in minutes',
            '  --budget-usd <amount> Max LLM budget in USD',
            '  --budget-tokens <n>   Max LLM tokens',
            '  --apply               Apply data-testid patches and generate tests',
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
    if (command === 'impact' || command === 'gap' || command === 'llm-health') {
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

    if (!args.path && !autoConfig) {
        // eslint-disable-next-line no-console
        console.error('Error: --path is required (or provide a config file with path set)');
        printUsage();
        process.exit(1);
    }

    const {config} = resolveConfig(process.cwd(), autoConfig, {
        path: args.path,
        testsRoot: args.testsRoot,
        mode: args.command,
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

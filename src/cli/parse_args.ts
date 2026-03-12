// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync} from 'fs';
import {dirname, join, resolve} from 'path';

import type {FrameworkType} from '../agent/config.js';

import type {ParsedArgs} from './types.js';

export const CONFIG_CANDIDATES = ['e2e-ai-agents.config.json', '.e2e-ai-agents.config.json'];

export function findConfigUpwards(startDir: string | undefined): string | undefined {
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

export function resolveAutoConfig(args: ParsedArgs): string | undefined {
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

export function parseArgs(argv: string[]): ParsedArgs {
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

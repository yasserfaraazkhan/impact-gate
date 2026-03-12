// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'fs';
import {join, relative, resolve} from 'path';
import type {PipelineConfig} from './config.js';
import type {FlowImpact} from './types.js';
import type {ApiSurfaceCatalog, CommandResult, PipelineResult, PipelineSummary} from './pipeline_types.js';
import {isPathWithinRoot, normalizePath} from './utils.js';
import {createMcpStatus, firstFlowFiles, toSafeSlug} from './pipeline_utils.js';
import {validateGeneratedSpecContent} from './spec_generator.js';
import {resolvePlaywrightBinary, runCommand, runCommandWithRetries, summarizeCommandOutput, resolveMcpCommandTimeoutMs, resolveMcpRetries} from './process_runner.js';
import {runPlaywrightListValidation, runPlaywrightRuntimeValidation} from './validation_runner.js';
import {buildApiSurfaceCatalog} from './api_catalog.js';

export function findSpecFiles(root: string): string[] {
    if (!existsSync(root)) {
        return [];
    }
    const entries = readdirSync(root, {withFileTypes: true});
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...findSpecFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
            files.push(fullPath);
        }
    }
    return files;
}

export function findDisallowedDescribeFiles(root: string): string[] {
    const files = findSpecFiles(root);
    return files.filter((file) => /\btest\.describe\s*\(/.test(readFileSync(file, 'utf-8')));
}

export function hasCommand(command: string, cwd: string): boolean {
    const result = runCommand(command, ['--version'], cwd);
    return result.status === 0;
}

export function hasPlaywrightAgentDefinitions(testsRoot: string): boolean {
    const required = [
        '.mcp.json',
        '.claude/agents/playwright-test-planner.md',
        '.claude/agents/playwright-test-generator.md',
        '.claude/agents/playwright-test-healer.md',
    ];
    return required.every((path) => existsSync(join(testsRoot, path)));
}

export function hasPlaywrightConfig(testsRoot: string): boolean {
    const candidates = [
        'playwright.config.ts',
        'playwright.config.js',
        'playwright.config.mts',
        'playwright.config.mjs',
        'playwright.config.cts',
        'playwright.config.cjs',
    ];
    return candidates.some((candidate) => existsSync(join(testsRoot, candidate)));
}

export function bootstrapPlaywrightAgentDefinitions(testsRoot: string, pipeline: PipelineConfig, timeoutMs: number): CommandResult {
    const args = ['playwright', 'init-agents', '--loop=claude', '--prompts'];
    if (pipeline.project) {
        args.push('--project', pipeline.project);
    }
    return runCommand('npx', args, testsRoot, timeoutMs);
}

export function resolveAgentSeedSpec(testsRoot: string): string | null {
    const preferred = join(testsRoot, 'specs', 'seed.spec.ts');
    const specsRoot = join(testsRoot, 'specs');
    const specFiles = findSpecFiles(specsRoot).filter((file) => !normalizePath(file).includes('/functional/ai-assisted/'));
    const scored = specFiles
        .map((file) => {
            const rel = normalizePath(relative(testsRoot, file));
            const content = readFileSync(file, 'utf-8');
            let score = 0;
            if (rel.endsWith('/seed.spec.ts')) {
                // Generated default seed from init-agents is often a placeholder; prefer real tests.
                if (!/generate code here/i.test(content)) {
                    score += 2;
                }
            }
            if (content.includes('@mattermost/playwright-lib')) {
                score += 8;
            }
            if (content.includes('pw.initSetup(')) {
                score += 6;
            }
            if (content.includes('testBrowser.login(')) {
                score += 4;
            }
            if (content.includes('channelsPage')) {
                score += 2;
            }
            if (rel.includes('/functional/channels/')) {
                score += 1;
            }
            return {rel, score};
        })
        .sort((a, b) => b.score - a.score);

    if (scored.length > 0 && scored[0].score > 0) {
        return scored[0].rel;
    }

    if (existsSync(preferred)) {
        return normalizePath(relative(testsRoot, preferred));
    }

    return null;
}

export function buildPlaywrightAgentsPrompt(
    flow: FlowImpact,
    seedFile: string,
    planFile: string,
    testFile: string,
    includeHealer: boolean,
): string {
    const linkedFiles = firstFlowFiles(flow).join(', ') || 'N/A';
    const reasons = (flow.reasons || []).slice(0, 5).join(' | ') || 'N/A';
    return [
        'Use official Playwright Test agents (planner, generator, healer) to implement exactly one high-quality test for this flow.',
        '',
        `Flow ID: ${flow.id}`,
        `Flow Name: ${flow.name}`,
        `Priority: ${flow.priority}`,
        `Linked files: ${linkedFiles}`,
        `Risk reasons: ${reasons}`,
        '',
        'Workflow requirements:',
        '1) Use #playwright-test-planner to explore and save a focused test plan.',
        '2) Use #playwright-test-generator to generate one test from that plan.',
        includeHealer
            ? '3) Use #playwright-test-healer to run and fix that generated test.'
            : '3) Skip runtime healing and focus on producing compile-ready test code.',
        '',
        `Seed file: ${seedFile}`,
        `Plan file to save: ${planFile}`,
        `Generated test file path (must be exact): ${testFile}`,
        '',
        'Quality constraints (must follow):',
        '- The generated file must contain a standalone test() and must not use test.describe or test.only.',
        '- Do not mark the test with test.fixme unless user explicitly requests skipping.',
        "- The generated test must include a single tag string '@ai-assisted'.",
        '- Match fixture/import style from the seed file. Prefer existing page-object APIs over raw brittle selectors.',
        '- Only use `pw` and page-object methods that already exist in the seed/current specs (for example, do not invent APIs like `pw.mainClient.*`).',
        '- For system-console/admin flows, avoid `systemConsolePage.toBeVisible()` and brittle class selectors (`.backstage-navbar`, `.admin-console__wrapper`, `.left-panel`, `.panel-card`).',
        '- Prefer stable assertions using URL patterns, test IDs, roles, labels, and established page-object methods.',
        '- Keep the scenario strictly aligned to the flow and linked files, not broad unrelated flows.',
        '',
        'At the end, return a short summary that includes the generated test file path and whether healing succeeded.',
    ].join('\n');
}

export function buildPlaywrightHealerPrompt(testFile: string, extra?: string): string {
    const lines = [
        'Heal this specific Playwright test file and keep edits minimal.',
        `Target test file: ${testFile}`,
        'Constraints:',
        '- Do not use test.describe or test.only.',
        "- Keep a single tag string '@ai-assisted'.",
        '- Use only existing Mattermost Playwright fixture/page-object APIs; do not invent new `pw.*` clients or methods.',
        '- Avoid `systemConsolePage.toBeVisible()` and brittle class selectors (`.backstage-navbar`, `.admin-console__wrapper`, `.left-panel`, `.panel-card`).',
        '- Prefer stable checks with URL/test IDs/roles/page-object methods.',
        '- Keep the test intent unchanged and focused.',
        '',
        'Run and fix this test until it compiles/passes, or mark test.fixme with a clear comment when behavior is truly broken.',
    ];
    if (extra) {
        lines.push('', `Context: ${extra}`);
    }
    return lines.join('\n');
}

export function runPlaywrightAgentsFlow(
    testsRoot: string,
    flow: FlowImpact,
    pipeline: PipelineConfig,
    outputDir: string,
    preferredTestFile: string,
    seedFile: string,
    apiSurface: ApiSurfaceCatalog,
    playwrightBinary: string | null,
    mcpTimeoutMs: number,
    mcpRetries: number,
): PipelineResult {
    mkdirSync(outputDir, {recursive: true});
    const slug = toSafeSlug(flow.id);
    const planFile = normalizePath(relative(testsRoot, join(outputDir, `${slug}.plan.md`)));
    const absolutePlanFile = join(testsRoot, planFile);
    const targetTestFile = normalizePath(relative(testsRoot, preferredTestFile));
    const existingSpecFiles = findSpecFiles(outputDir);
    const existingSpecSnapshots = new Map<string, string>();
    for (const specFile of existingSpecFiles) {
        try {
            existingSpecSnapshots.set(specFile, readFileSync(specFile, 'utf-8'));
        } catch {
            continue;
        }
    }
    const originalPlanContent = existsSync(absolutePlanFile) ? readFileSync(absolutePlanFile, 'utf-8') : null;

    const restoreArtifactsOnFailure = () => {
        for (const currentSpecFile of findSpecFiles(outputDir)) {
            const originalSpecContent = existingSpecSnapshots.get(currentSpecFile);
            if (originalSpecContent === undefined) {
                rmSync(currentSpecFile, {force: true});
                continue;
            }
            try {
                if (readFileSync(currentSpecFile, 'utf-8') !== originalSpecContent) {
                    writeFileSync(currentSpecFile, originalSpecContent, 'utf-8');
                }
            } catch {
                // best-effort restore only
            }
        }
        for (const [specFile, originalSpecContent] of existingSpecSnapshots.entries()) {
            if (!existsSync(specFile)) {
                writeFileSync(specFile, originalSpecContent, 'utf-8');
            }
        }
        if (originalPlanContent === null) {
            rmSync(absolutePlanFile, {force: true});
        } else {
            try {
                if (!existsSync(absolutePlanFile) || readFileSync(absolutePlanFile, 'utf-8') !== originalPlanContent) {
                    writeFileSync(absolutePlanFile, originalPlanContent, 'utf-8');
                }
            } catch {
                // best-effort restore only
            }
        }
    };

    const failFlow = (error: string): PipelineResult => {
        restoreArtifactsOnFailure();
        return {
            flowId: flow.id,
            flowName: flow.name,
            generatedDir: outputDir,
            generateStatus: 'failed',
            healStatus: pipeline.heal ? 'failed' : undefined,
            error,
        };
    };

    if (pipeline.dryRun) {
        return {
            flowId: flow.id,
            flowName: flow.name,
            generatedDir: outputDir,
            generateStatus: 'skipped',
            healStatus: pipeline.heal ? 'skipped' : undefined,
        };
    }

    const prompt = buildPlaywrightAgentsPrompt(flow, seedFile, planFile, targetTestFile, Boolean(pipeline.heal));
    const runArgs = [
        '-p',
        '--permission-mode',
        'bypassPermissions',
        '--setting-sources',
        'project,local',
        '--strict-mcp-config',
        '--mcp-config',
        '.mcp.json',
        '--add-dir',
        testsRoot,
        '--',
        prompt,
    ];
    const runResult = runCommandWithRetries('claude', runArgs, testsRoot, mcpTimeoutMs, mcpRetries);
    if (runResult.status !== 0) {
        return failFlow(summarizeCommandOutput(runResult.stdout, runResult.stderr) || runResult.error || 'Playwright agents run failed');
    }

    let actualTestFile = preferredTestFile;
    if (!existsSync(actualTestFile)) {
        const candidates = findSpecFiles(outputDir);
        if (candidates.length === 1) {
            actualTestFile = candidates[0];
        }
    }
    if (!existsSync(actualTestFile)) {
        return failFlow(`Playwright agents did not produce expected test file: ${targetTestFile}`);
    }

    const relativeActualTestFile = normalizePath(relative(testsRoot, actualTestFile));
    let qualityIssues = validateGeneratedSpecContent(readFileSync(actualTestFile, 'utf-8'), apiSurface);
    if (qualityIssues.length > 0 && pipeline.heal) {
        const healResult = runCommandWithRetries(
            'claude',
            [
                '-p',
                '--permission-mode',
                'bypassPermissions',
                '--setting-sources',
                'project,local',
                '--strict-mcp-config',
                '--agent',
                'playwright-test-healer',
                '--mcp-config',
                '.mcp.json',
                '--add-dir',
                testsRoot,
                '--',
                buildPlaywrightHealerPrompt(relativeActualTestFile, qualityIssues.map((issue) => issue.message).join(' | ')),
            ],
            testsRoot,
            mcpTimeoutMs,
            mcpRetries,
        );
        if (healResult.status === 0 && existsSync(actualTestFile)) {
            qualityIssues = validateGeneratedSpecContent(readFileSync(actualTestFile, 'utf-8'), apiSurface);
        }
    }
    if (qualityIssues.length > 0) {
        return failFlow(`Playwright agents produced invalid test content: ${qualityIssues.map((issue) => issue.message).join(' | ')}`);
    }

    if (pipeline.heal) {
        let compileValidation = runPlaywrightListValidation(testsRoot, actualTestFile, pipeline, playwrightBinary);
        if (compileValidation.status === 'failed') {
            const healResult = runCommandWithRetries(
                'claude',
                [
                    '-p',
                    '--permission-mode',
                    'bypassPermissions',
                    '--setting-sources',
                    'project,local',
                    '--strict-mcp-config',
                    '--agent',
                    'playwright-test-healer',
                    '--mcp-config',
                    '.mcp.json',
                    '--add-dir',
                    testsRoot,
                    '--',
                    buildPlaywrightHealerPrompt(relativeActualTestFile, compileValidation.detail || 'playwright --list failed'),
                ],
                testsRoot,
                mcpTimeoutMs,
                mcpRetries,
            );
            if (healResult.status === 0 && existsSync(actualTestFile)) {
                compileValidation = runPlaywrightListValidation(testsRoot, actualTestFile, pipeline, playwrightBinary);
            }
            if (compileValidation.status === 'failed') {
                return failFlow(`Playwright agents compile validation failed: ${compileValidation.detail || 'playwright --list failed'}`);
            }
        }

        let runtimeValidation = runPlaywrightRuntimeValidation(testsRoot, actualTestFile, pipeline, playwrightBinary);
        if (runtimeValidation.status === 'failed') {
            const healResult = runCommandWithRetries(
                'claude',
                [
                    '-p',
                    '--permission-mode',
                    'bypassPermissions',
                    '--setting-sources',
                    'project,local',
                    '--strict-mcp-config',
                    '--agent',
                    'playwright-test-healer',
                    '--mcp-config',
                    '.mcp.json',
                    '--add-dir',
                    testsRoot,
                    '--',
                    buildPlaywrightHealerPrompt(relativeActualTestFile, runtimeValidation.detail || 'playwright runtime failed'),
                ],
                testsRoot,
                mcpTimeoutMs,
                mcpRetries,
            );
            if (healResult.status === 0 && existsSync(actualTestFile)) {
                runtimeValidation = runPlaywrightRuntimeValidation(testsRoot, actualTestFile, pipeline, playwrightBinary);
            }
            if (runtimeValidation.status === 'failed') {
                return failFlow(`Playwright agents runtime validation failed: ${runtimeValidation.detail || 'playwright test failed'}`);
            }
        }
    }

    return {
        flowId: flow.id,
        flowName: flow.name,
        generatedDir: outputDir,
        generateStatus: 'success',
        healStatus: pipeline.heal ? 'success' : undefined,
    };
}

export function runPlaywrightAgentsPipeline(
    testsRoot: string,
    flows: FlowImpact[],
    pipeline: PipelineConfig,
): PipelineSummary {
    const warnings: string[] = [];
    const results: PipelineResult[] = [];
    const mcpTimeoutMs = resolveMcpCommandTimeoutMs(pipeline);
    const mcpRetries = resolveMcpRetries(pipeline);

    if (!hasCommand('claude', testsRoot)) {
        warnings.push('Claude CLI is required for official Playwright planner/generator/healer execution but was not found.');
        return {runner: 'unknown', results, warnings, mcp: createMcpStatus('unknown', true)};
    }

    if (!hasPlaywrightConfig(testsRoot)) {
        warnings.push('Playwright config file not found in testsRoot; skipping official Playwright agents backend.');
        return {runner: 'unknown', results, warnings, mcp: createMcpStatus('unknown', true)};
    }

    if (!hasPlaywrightAgentDefinitions(testsRoot)) {
        const bootstrap = bootstrapPlaywrightAgentDefinitions(testsRoot, pipeline, mcpTimeoutMs);
        if (bootstrap.status !== 0) {
            warnings.push(
                summarizeCommandOutput(bootstrap.stdout, bootstrap.stderr) ||
                bootstrap.error ||
                'Failed to initialize Playwright agents via `npx playwright init-agents`.',
            );
            return {runner: 'unknown', results, warnings, mcp: createMcpStatus('unknown', true)};
        }
    }

    if (!hasPlaywrightAgentDefinitions(testsRoot)) {
        warnings.push('Playwright agent definitions are missing after bootstrap.');
        return {runner: 'unknown', results, warnings, mcp: createMcpStatus('unknown', true)};
    }

    const seedFile = resolveAgentSeedSpec(testsRoot);
    if (!seedFile) {
        warnings.push('No seed spec file found under specs/. Playwright planner cannot be initialized.');
        return {runner: 'unknown', results, warnings, mcp: createMcpStatus('unknown', true)};
    }

    const playwrightBinary = pipeline.heal ? resolvePlaywrightBinary(testsRoot) : null;
    const apiSurface = buildApiSurfaceCatalog(testsRoot, seedFile);
    if (pipeline.heal && !playwrightBinary) {
        warnings.push('Playwright binary was not found. Healer runtime validation may be limited.');
    }

    const outputBase = resolve(testsRoot, pipeline.outputDir || 'specs/functional/ai-assisted');
    if (!isPathWithinRoot(testsRoot, outputBase)) {
        warnings.push(`Pipeline outputDir resolves outside testsRoot and was blocked: ${pipeline.outputDir}`);
        return {runner: 'unknown', results, warnings, mcp: createMcpStatus('unknown', true)};
    }

    for (const flow of flows) {
        if (flow.priority !== 'P0' && flow.priority !== 'P1') {
            continue;
        }

        const slug = toSafeSlug(flow.id);
        const outputDir = normalizePath(join(outputBase, slug));
        if (!isPathWithinRoot(testsRoot, outputDir)) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                error: 'output directory resolves outside testsRoot',
            });
            continue;
        }

        const testFile = normalizePath(join(outputDir, `${slug}.spec.ts`));
        if (!isPathWithinRoot(testsRoot, testFile)) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                error: 'generated test path resolves outside testsRoot',
            });
            continue;
        }

        results.push(
            runPlaywrightAgentsFlow(
                testsRoot,
                flow,
                pipeline,
                outputDir,
                testFile,
                seedFile,
                apiSurface,
                playwrightBinary,
                mcpTimeoutMs,
                mcpRetries,
            ),
        );
        if (pipeline.mcpOnly && results[results.length - 1].generateStatus === 'failed') {
            warnings.push(`MCP-only mode: stopping after first failed flow (${flow.id}).`);
            break;
        }
    }

    return {runner: 'playwright-agents', results, warnings, mcp: createMcpStatus('playwright-agents', true)};
}

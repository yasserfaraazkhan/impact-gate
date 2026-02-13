// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'fs';
import {basename, dirname, join, relative, resolve} from 'path';
import {spawnSync} from 'child_process';
import type {PipelineConfig} from './config.js';
import type {FlowImpact} from './analysis.js';
import {baseNameWithoutExt, isPathWithinRoot, normalizePath, titleCase, tokenize, uniqueTokens} from './utils.js';

export interface PipelineResult {
    flowId: string;
    flowName: string;
    generatedDir: string;
    generateStatus: 'success' | 'skipped' | 'failed';
    healStatus?: 'success' | 'skipped' | 'failed';
    error?: string;
}

export interface PipelineSummary {
    runner: 'e2e-test-gen' | 'package-native' | 'unknown';
    results: PipelineResult[];
    warnings: string[];
}

export interface SpecHealTarget {
    specPath: string;
    status?: 'failed' | 'flaky';
    reason?: string;
}

type NativeSpecStrategy =
    | 'thread-reply'
    | 'message-post'
    | 'channel-baseline'
    | 'search-baseline'
    | 'generic-baseline';

interface NativeSpecQualityIssue {
    code:
        | 'disallowed-describe'
        | 'disallowed-only'
        | 'missing-test'
        | 'missing-tag'
        | 'tag-array-disallowed';
    message: string;
}

interface CommandResult {
    status: number;
    stdout: string;
    stderr: string;
    error?: string;
}

interface ValidationResult {
    status: 'passed' | 'failed' | 'skipped';
    detail?: string;
}

function hasE2eTestGenCLI(testsRoot: string): string | null {
    const cliPath = join(testsRoot, 'e2e-test-gen-cli.ts');
    return existsSync(cliPath) ? cliPath : null;
}

function toSafeSlug(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'flow';
}

function stripSpecSuffix(value: string): string {
    return value.replace(/\.(spec|test)\.[^.]+$/i, '').replace(/\.[^.]+$/, '');
}

function buildSyntheticFlowFromSpecTarget(relativeSpecPath: string, target: SpecHealTarget): FlowImpact {
    const normalizedSpecPath = normalizePath(relativeSpecPath);
    const noSuffix = stripSpecSuffix(normalizedSpecPath);
    const flowId = toSafeSlug(noSuffix.replace(/\//g, '.'));
    const base = baseNameWithoutExt(stripSpecSuffix(basename(normalizedSpecPath)));
    const flowName = titleCase(base.replace(/[._-]+/g, ' ')) || 'Recovered Spec';
    const keywords = uniqueTokens(tokenize(noSuffix.replace(/[/.]/g, ' ')));
    const reasons = [
        `Playwright report marked this spec as ${target.status || 'unstable'}.`,
        target.reason || `Auto-heal target: ${normalizedSpecPath}`,
    ];
    return {
        id: flowId,
        name: flowName,
        kind: 'flow',
        score: target.status === 'failed' ? 12 : 9,
        priority: target.status === 'failed' ? 'P0' : 'P1',
        reasons,
        keywords,
        files: [normalizedSpecPath],
    };
}

function firstFlowFiles(flow: FlowImpact): string[] {
    return (flow.files || []).filter(Boolean).slice(0, 5);
}

function buildNativeStrategyOrder(flow: FlowImpact): NativeSpecStrategy[] {
    const haystack = [
        flow.id,
        flow.name,
        ...(flow.files || []),
        ...(flow.reasons || []),
        ...(flow.keywords || []),
    ].join(' ').toLowerCase();

    const strategies: NativeSpecStrategy[] = [];
    if (/(thread|reply|rhs|sidebar[_-]?right)/.test(haystack)) {
        strategies.push('thread-reply');
    }
    if (/(message|post|realtime|websocket|chat)/.test(haystack)) {
        strategies.push('message-post');
    }
    if (/(channel|navigation|sidebar|switch)/.test(haystack)) {
        strategies.push('channel-baseline');
    }
    if (/(search|find|spotlight)/.test(haystack)) {
        strategies.push('search-baseline');
    }
    strategies.push('generic-baseline');
    return Array.from(new Set(strategies));
}

function validateGeneratedSpecContent(content: string): NativeSpecQualityIssue[] {
    const issues: NativeSpecQualityIssue[] = [];
    if (/\btest\.describe\s*\(/.test(content)) {
        issues.push({
            code: 'disallowed-describe',
            message: 'Generated tests must not use test.describe.',
        });
    }
    if (/\btest\.only\s*\(/.test(content)) {
        issues.push({
            code: 'disallowed-only',
            message: 'Generated tests must not use test.only.',
        });
    }
    if (!/\btest\s*\(/.test(content)) {
        issues.push({
            code: 'missing-test',
            message: 'Generated file does not include a test() declaration.',
        });
    }
    if (/\btag\s*:\s*\[/.test(content)) {
        issues.push({
            code: 'tag-array-disallowed',
            message: 'Generated tests must use a single tag string, not a tag array.',
        });
    }
    const hasTagString = /\btag\s*:\s*['"][^'"]+['"]/.test(content);
    if (!hasTagString || !/@ai-assisted/.test(content)) {
        issues.push({
            code: 'missing-tag',
            message: "Generated tests must include a single '@ai-assisted' tag.",
        });
    }
    return issues;
}

function createNativePlaywrightSpec(flow: FlowImpact, slug: string, strategy: NativeSpecStrategy): string {
    const linkedFiles = firstFlowFiles(flow).join(', ') || 'N/A';
    const header = [
        "import {test, expect} from '@mattermost/playwright-lib';",
        '',
        '/**',
        ` * Auto-generated by @yasserkhanorg/e2e-agents`,
        ` * Flow: ${flow.id} (${flow.name})`,
        ` * Strategy: ${strategy}`,
        ` * Linked files: ${linkedFiles}`,
        ' */',
    ];

    const start = [
        `test('${flow.priority}: ${flow.name} generated coverage', {tag: '@ai-assisted'}, async ({pw}) => {`,
        '  const {user, team} = await pw.initSetup();',
        '  const {channelsPage} = await pw.testBrowser.login(user);',
        '  await channelsPage.goto(team.name);',
    ];

    const end = [
        '});',
        '',
    ];

    if (strategy === 'thread-reply') {
        return [
            ...header,
            ...start,
            `  const parentMessage = \`ai-${slug}-parent-\${Date.now()}\`;`,
            '  await channelsPage.postMessage(parentMessage);',
            '  await channelsPage.openAThread(parentMessage);',
            `  const replyMessage = \`ai-${slug}-reply-\${Date.now()}\`;`,
            '  await channelsPage.sidebarRight.postMessage(replyMessage);',
            '  await expect(channelsPage.sidebarRight.getLastPost()).toContainText(replyMessage);',
            ...end,
        ].join('\n');
    }

    if (strategy === 'message-post') {
        return [
            ...header,
            ...start,
            `  const message = \`ai-${slug}-message-\${Date.now()}\`;`,
            '  await channelsPage.postMessage(message);',
            '  await expect(channelsPage.getLastPost()).toContainText(message);',
            ...end,
        ].join('\n');
    }

    if (strategy === 'channel-baseline') {
        return [
            ...header,
            ...start,
            "  await expect(channelsPage.page.locator('#channelHeaderTitle')).toBeVisible();",
            "  await expect(channelsPage.page.locator('#SidebarContainer')).toBeVisible();",
            ...end,
        ].join('\n');
    }

    if (strategy === 'search-baseline') {
        return [
            ...header,
            ...start,
            `  const searchTerm = '${slug}'.slice(0, 20);`,
            "  await channelsPage.page.keyboard.press('ControlOrMeta+K');",
            '  await channelsPage.page.keyboard.type(searchTerm);',
            "  await channelsPage.page.keyboard.press('Escape');",
            '  await expect(channelsPage.page).toHaveURL(/\\/channels\\//);',
            ...end,
        ].join('\n');
    }

    return [
        ...header,
        ...start,
        '  await expect(channelsPage.page).toHaveURL(/\\/channels\\//);',
        "  await expect(channelsPage.page.locator('#channelHeaderTitle')).toBeVisible();",
        ...end,
    ].join('\n');
}

function resolvePlaywrightBinary(testsRoot: string): string | null {
    const unixPath = join(testsRoot, 'node_modules', '.bin', 'playwright');
    const windowsPath = join(testsRoot, 'node_modules', '.bin', 'playwright.cmd');
    if (existsSync(unixPath)) {
        return unixPath;
    }
    if (existsSync(windowsPath)) {
        return windowsPath;
    }
    return null;
}

function summarizeCommandOutput(stdout: string, stderr: string): string {
    const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
    if (!combined) {
        return '';
    }
    const lines = combined.split('\n').slice(-20);
    return lines.join('\n').slice(0, 2000);
}

function runCommand(command: string, args: string[], cwd: string): CommandResult {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf-8',
        timeout: 60 * 60 * 1000,
        stdio: 'pipe',
    });
    return {
        status: result.status ?? 1,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        error: result.error ? result.error.message : undefined,
    };
}

function runPlaywrightListValidation(
    testsRoot: string,
    testFile: string,
    pipeline: PipelineConfig,
    playwrightBinary: string | null,
): ValidationResult {
    if (!playwrightBinary) {
        return {
            status: 'skipped',
            detail: 'Playwright binary not found under testsRoot/node_modules/.bin; runtime compile validation skipped.',
        };
    }
    const relativeSpecPath = normalizePath(relative(testsRoot, testFile));
    if (relativeSpecPath.startsWith('../') || relativeSpecPath.startsWith('..\\')) {
        return {
            status: 'failed',
            detail: 'Generated spec path resolved outside testsRoot during validation.',
        };
    }

    const args = ['test', '--list', relativeSpecPath];
    if (pipeline.project) {
        args.push('--project', pipeline.project);
    }
    const commandResult = runCommand(playwrightBinary, args, testsRoot);
    if (commandResult.error && /ENOENT/.test(commandResult.error)) {
        return {
            status: 'skipped',
            detail: 'Playwright binary was not executable; runtime compile validation skipped.',
        };
    }
    if (commandResult.status === 0) {
        return {status: 'passed'};
    }
    const summary = summarizeCommandOutput(commandResult.stdout, commandResult.stderr);
    return {
        status: 'failed',
        detail: summary || commandResult.error || `playwright --list failed with status ${commandResult.status}`,
    };
}

function runPackageNativeFlow(
    testsRoot: string,
    flow: FlowImpact,
    pipeline: PipelineConfig,
    outputDir: string,
    testFile: string,
    playwrightBinary: string | null,
): PipelineResult {
    const flowId = flow.id;
    const flowName = flow.name;
    const existingFile = existsSync(testFile);
    const originalContent = existingFile ? readFileSync(testFile, 'utf-8') : null;

    if (existingFile && !pipeline.heal) {
        return {
            flowId,
            flowName,
            generatedDir: outputDir,
            generateStatus: 'skipped',
        };
    }

    const slug = toSafeSlug(flow.id);
    const strategies = buildNativeStrategyOrder(flow);
    const attempts: string[] = [];
    const candidates: Array<{label: string; strategy?: NativeSpecStrategy; content: string; write: boolean}> = [];

    if (pipeline.heal && originalContent !== null) {
        candidates.push({
            label: 'existing',
            content: originalContent,
            write: false,
        });
    }
    for (const strategy of strategies) {
        candidates.push({
            label: strategy,
            strategy,
            content: createNativePlaywrightSpec(flow, slug, strategy),
            write: true,
        });
    }

    mkdirSync(outputDir, {recursive: true});
    let wroteNewFile = false;

    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        if (candidate.write) {
            writeFileSync(testFile, candidate.content, 'utf-8');
            wroteNewFile = true;
        }
        const currentContent = candidate.write ? candidate.content : (originalContent || '');
        const qualityIssues = validateGeneratedSpecContent(currentContent);
        if (qualityIssues.length > 0) {
            attempts.push(`${candidate.label}: ${qualityIssues.map((issue) => issue.message).join(' ')}`);
            if (pipeline.heal && i < candidates.length - 1) {
                continue;
            }
            if (originalContent !== null) {
                writeFileSync(testFile, originalContent, 'utf-8');
            } else if (wroteNewFile && existsSync(testFile)) {
                rmSync(testFile, {force: true});
            }
            return {
                flowId,
                flowName,
                generatedDir: outputDir,
                generateStatus: 'failed',
                healStatus: pipeline.heal ? 'failed' : undefined,
                error: `Quality checks failed. Attempts: ${attempts.join(' | ')}`,
            };
        }

        if (pipeline.heal) {
            const validation = runPlaywrightListValidation(testsRoot, testFile, pipeline, playwrightBinary);
            if (validation.status === 'failed') {
                attempts.push(`${candidate.label}: ${validation.detail || 'playwright validation failed'}`);
                if (i < candidates.length - 1) {
                    continue;
                }
                if (originalContent !== null) {
                    writeFileSync(testFile, originalContent, 'utf-8');
                } else if (wroteNewFile && existsSync(testFile)) {
                    rmSync(testFile, {force: true});
                }
                return {
                    flowId,
                    flowName,
                    generatedDir: outputDir,
                    generateStatus: 'failed',
                    healStatus: 'failed',
                    error: `Heal validation failed. Attempts: ${attempts.join(' | ')}`,
                };
            }
        }

        return {
            flowId,
            flowName,
            generatedDir: outputDir,
            generateStatus: candidate.write ? 'success' : 'skipped',
            healStatus: pipeline.heal ? 'success' : undefined,
        };
    }

    if (originalContent !== null) {
        writeFileSync(testFile, originalContent, 'utf-8');
    } else if (wroteNewFile && existsSync(testFile)) {
        rmSync(testFile, {force: true});
    }
    return {
        flowId,
        flowName,
        generatedDir: outputDir,
        generateStatus: 'failed',
        healStatus: pipeline.heal ? 'failed' : undefined,
        error: attempts.length > 0 ? attempts.join(' | ') : 'No generation candidates were available.',
    };
}

function runPackageNativePipeline(
    testsRoot: string,
    flows: FlowImpact[],
    pipeline: PipelineConfig,
    baseWarnings: string[] = [],
): PipelineSummary {
    const warningSet = new Set(baseWarnings);
    if (pipeline.mcp) {
        warningSet.add('Package-native pipeline does not run Playwright MCP directly. Use follow-up heal workflows if MCP is required.');
    }

    const playwrightBinary = pipeline.heal ? resolvePlaywrightBinary(testsRoot) : null;
    if (pipeline.heal && !playwrightBinary) {
        warningSet.add('Playwright binary was not found. Heal uses static quality checks without runtime compile validation.');
    }

    const results: PipelineResult[] = [];
    const outputBase = resolve(testsRoot, pipeline.outputDir || 'specs/functional/ai-assisted');
    if (!isPathWithinRoot(testsRoot, outputBase)) {
        warningSet.add(`Pipeline outputDir resolves outside testsRoot and was blocked: ${pipeline.outputDir}`);
        return {runner: 'unknown', results, warnings: Array.from(warningSet)};
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

        if (pipeline.dryRun) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'skipped',
                healStatus: pipeline.heal ? 'skipped' : undefined,
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

        results.push(runPackageNativeFlow(testsRoot, flow, pipeline, outputDir, testFile, playwrightBinary));
    }

    return {runner: 'package-native', results, warnings: Array.from(warningSet)};
}

export function runTargetedSpecHeal(
    testsRoot: string,
    targets: SpecHealTarget[],
    pipeline: PipelineConfig,
): PipelineSummary {
    const warnings = new Set<string>();
    const results: PipelineResult[] = [];
    if (targets.length === 0) {
        warnings.add('No targeted specs provided for heal.');
        return {
            runner: 'package-native',
            results,
            warnings: Array.from(warnings),
        };
    }

    const playwrightBinary = pipeline.heal ? resolvePlaywrightBinary(testsRoot) : null;
    if (pipeline.heal && !playwrightBinary) {
        warnings.add('Playwright binary was not found. Targeted heal uses static quality checks without runtime compile validation.');
    }

    for (const target of targets) {
        const inputPath = target.specPath || '';
        const absoluteSpecPath = normalizePath(resolve(testsRoot, inputPath));
        if (!isPathWithinRoot(testsRoot, absoluteSpecPath)) {
            results.push({
                flowId: inputPath || 'unknown',
                flowName: inputPath || 'Unknown Spec',
                generatedDir: normalizePath(dirname(absoluteSpecPath)),
                generateStatus: 'failed',
                healStatus: pipeline.heal ? 'failed' : undefined,
                error: `Targeted spec resolves outside testsRoot: ${inputPath}`,
            });
            continue;
        }

        if (!existsSync(absoluteSpecPath)) {
            results.push({
                flowId: inputPath || 'unknown',
                flowName: inputPath || 'Unknown Spec',
                generatedDir: normalizePath(dirname(absoluteSpecPath)),
                generateStatus: 'failed',
                healStatus: pipeline.heal ? 'failed' : undefined,
                error: `Targeted spec does not exist: ${inputPath}`,
            });
            continue;
        }

        const relativeSpecPath = normalizePath(relative(testsRoot, absoluteSpecPath));
        if (!/\.(spec|test)\.[tj]sx?$/.test(relativeSpecPath)) {
            warnings.add(`Skipping non-spec target path: ${relativeSpecPath}`);
            results.push({
                flowId: relativeSpecPath,
                flowName: relativeSpecPath,
                generatedDir: normalizePath(dirname(absoluteSpecPath)),
                generateStatus: 'skipped',
                healStatus: pipeline.heal ? 'skipped' : undefined,
            });
            continue;
        }

        if (pipeline.dryRun) {
            results.push({
                flowId: relativeSpecPath,
                flowName: relativeSpecPath,
                generatedDir: normalizePath(dirname(absoluteSpecPath)),
                generateStatus: 'skipped',
                healStatus: pipeline.heal ? 'skipped' : undefined,
            });
            continue;
        }

        const syntheticFlow = buildSyntheticFlowFromSpecTarget(relativeSpecPath, target);
        results.push(
            runPackageNativeFlow(
                testsRoot,
                syntheticFlow,
                pipeline,
                normalizePath(dirname(absoluteSpecPath)),
                absoluteSpecPath,
                playwrightBinary,
            ),
        );
    }

    return {
        runner: 'package-native',
        results,
        warnings: Array.from(warnings),
    };
}

function findSpecFiles(root: string): string[] {
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

function findDisallowedDescribeFiles(root: string): string[] {
    const files = findSpecFiles(root);
    return files.filter((file) => /\btest\.describe\s*\(/.test(readFileSync(file, 'utf-8')));
}

export function runPlaywrightPipeline(
    testsRoot: string,
    flows: FlowImpact[],
    pipeline: PipelineConfig,
): PipelineSummary {
    const cliPath = hasE2eTestGenCLI(testsRoot);
    if (!cliPath) {
        return runPackageNativePipeline(
            testsRoot,
            flows,
            pipeline,
            ['e2e-test-gen-cli.ts not found; using package-native pipeline fallback.'],
        );
    }

    const warnings: string[] = [];
    const results: PipelineResult[] = [];
    const outputBase = resolve(testsRoot, pipeline.outputDir || 'specs/functional/ai-assisted');
    if (!isPathWithinRoot(testsRoot, outputBase)) {
        warnings.push(`Pipeline outputDir resolves outside testsRoot and was blocked: ${pipeline.outputDir}`);
        return {runner: 'unknown', results, warnings};
    }

    for (const flow of flows) {
        if (flow.priority !== 'P0' && flow.priority !== 'P1') {
            continue;
        }
        const slug = flow.id.replace(/[^a-zA-Z0-9._-]+/g, '-');
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

        if (pipeline.dryRun) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'skipped',
                healStatus: 'skipped',
            });
            continue;
        }

        const generateArgs = ['tsx', cliPath, 'generate', flow.name, '--output', outputDir, '--scenarios', `${pipeline.scenarios}`];
        if (pipeline.baseUrl) {
            generateArgs.push('--base-url', pipeline.baseUrl);
        }
        if (pipeline.headless) {
            generateArgs.push('--headless');
        }
        if (pipeline.browser) {
            generateArgs.push('--browser', pipeline.browser);
        }
        if (pipeline.project) {
            generateArgs.push('--project', pipeline.project);
        }
        if (pipeline.parallel) {
            generateArgs.push('--parallel');
        }
        if (pipeline.mcp) {
            generateArgs.push('--mcp');
        }

        const generateResult = runCommand('npx', generateArgs, testsRoot);
        if (generateResult.status !== 0) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                error: summarizeCommandOutput(generateResult.stdout, generateResult.stderr) || generateResult.error || 'generate failed',
            });
            continue;
        }

        let healStatus: PipelineResult['healStatus'] = 'skipped';
        if (pipeline.heal) {
            const healArgs = ['tsx', cliPath, 'heal', outputDir];
            if (pipeline.browser) {
                healArgs.push('--browser', pipeline.browser);
            }
            if (pipeline.project) {
                healArgs.push('--project', pipeline.project);
            }
            if (pipeline.parallel) {
                healArgs.push('--parallel');
            }
            if (pipeline.mcp) {
                healArgs.push('--mcp');
            }
            const healResult = runCommand('npx', healArgs, testsRoot);
            healStatus = healResult.status === 0 ? 'success' : 'failed';
        }

        const disallowedDescribeFiles = findDisallowedDescribeFiles(outputDir);
        if (disallowedDescribeFiles.length > 0) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                healStatus,
                error: `Generated tests contain test.describe (disallowed): ${disallowedDescribeFiles.join(', ')}`,
            });
            continue;
        }

        results.push({
            flowId: flow.id,
            flowName: flow.name,
            generatedDir: outputDir,
            generateStatus: 'success',
            healStatus,
        });
    }

    return {runner: 'e2e-test-gen', results, warnings};
}

// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync, readdirSync} from 'fs';
import {join, resolve} from 'path';
import {spawnSync} from 'child_process';
import type {PipelineConfig} from './config.js';
import type {FlowImpact} from './analysis.js';
import {normalizePath} from './utils.js';

export interface PipelineResult {
    flowId: string;
    flowName: string;
    generatedDir: string;
    generateStatus: 'success' | 'skipped' | 'failed';
    healStatus?: 'success' | 'skipped' | 'failed';
    error?: string;
}

export interface PipelineSummary {
    runner: 'e2e-test-gen' | 'unknown';
    results: PipelineResult[];
    warnings: string[];
}

function hasE2eTestGenCLI(testsRoot: string): string | null {
    const cliPath = join(testsRoot, 'e2e-test-gen-cli.ts');
    return existsSync(cliPath) ? cliPath : null;
}

function runCommand(command: string, args: string[], cwd: string): {status: number; error?: string} {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf-8',
        timeout: 60 * 60 * 1000,
        stdio: 'inherit',
    });
    if (result.error) {
        return {status: result.status ?? 1, error: result.error.message};
    }
    return {status: result.status ?? 0};
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
    const warnings: string[] = [];
    const cliPath = hasE2eTestGenCLI(testsRoot);
    if (!cliPath) {
        warnings.push('e2e-test-gen-cli.ts not found; skipping pipeline.');
        return {runner: 'unknown', results: [], warnings};
    }

    const results: PipelineResult[] = [];
    const outputBase = resolve(testsRoot, pipeline.outputDir || 'specs/functional/ai-assisted');

    for (const flow of flows) {
        if (flow.priority !== 'P0' && flow.priority !== 'P1') {
            continue;
        }
        const slug = flow.id.replace(/[^a-zA-Z0-9._-]+/g, '-');
        const outputDir = normalizePath(join(outputBase, slug));

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
                error: generateResult.error || 'generate failed',
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

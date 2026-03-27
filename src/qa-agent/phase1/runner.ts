// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawnSync} from 'child_process';
import {existsSync, readdirSync} from 'fs';
import {join} from 'path';

import {logger} from '../../logger.js';
import {safeEnv} from '../safe_env.js';
import type {Phase1Result, QAConfig, SpecResult} from '../types.js';
import {resolveScope} from './scope.js';

export function runPhase1(config: QAConfig): Phase1Result {
    const {flows, specPaths} = resolveScope(config);

    logger.info('Phase 1: Scope resolved', {
        flows: flows.length,
        specDirs: specPaths.length,
        mode: config.mode,
    });

    // Run impact-gate CLI for impact/plan if we have a since ref
    if (config.since && config.mode !== 'release') {
        runE2eAgentsCli(config);
    }

    // Run matched Playwright specs
    const specResults = runMatchedSpecs(specPaths, config);

    return {
        flows,
        specResults,
        planPath: config.testsRoot
            ? join(config.testsRoot, '.e2e-ai-agents', 'plan.json')
            : undefined,
    };
}

function runE2eAgentsCli(config: QAConfig): void {
    const args = ['impact-gate'];

    switch (config.mode) {
    case 'pr':
        args.push('plan');
        if (config.since) args.push('--since', config.since);
        break;
    case 'hunt':
        args.push('impact');
        if (config.huntTarget) args.push('--flow-patterns', config.huntTarget);
        if (config.since) args.push('--since', config.since);
        break;
    case 'fix':
        args.push('heal');
        break;
    default:
        return;
    }

    if (config.testsRoot) {
        args.push('--tests-root', config.testsRoot);
    }

    logger.info('Running impact-gate', {args: args.slice(1)});

    const result = spawnSync('npx', args, {
        cwd: config.testsRoot || process.cwd(),
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        env: safeEnv(),
    });

    // Exit code 2 = "no changes detected" from impact-gate CLI, not an error
    if (result.status !== 0 && result.status !== 2) {
        logger.warn('impact-gate exited with non-zero status', {
            status: result.status,
            stderr: (result.stderr || '').slice(0, 500),
        });
    }
}

function runMatchedSpecs(specPaths: string[], config: QAConfig): SpecResult[] {
    const results: SpecResult[] = [];
    const specFiles = collectSpecFiles(specPaths);

    if (specFiles.length === 0) {
        logger.info('No spec files found to run');
        return results;
    }

    logger.info('Running matched specs', {count: specFiles.length});

    for (const specFile of specFiles) {
        const result = runSingleSpec(specFile, config);
        results.push(result);
    }

    return results;
}

function collectSpecFiles(specPaths: string[]): string[] {
    const files: string[] = [];
    for (const p of specPaths) {
        if (!existsSync(p)) continue;
        try {
            const entries = readdirSync(p, {recursive: true, encoding: 'utf-8'});
            for (const entry of entries) {
                if (typeof entry === 'string' && (entry.endsWith('.spec.ts') || entry.endsWith('.test.ts'))) {
                    files.push(join(p, entry));
                }
            }
        } catch {
            // Skip unreadable directories
        }
    }
    return files;
}

function runSingleSpec(specPath: string, config: QAConfig): SpecResult {
    const args = [
        'playwright', 'test',
        specPath,
        '--reporter', 'json',
    ];
    if (config.project) {
        args.push('--project', config.project);
    }

    const result = spawnSync('npx', args, {
        cwd: config.testsRoot || process.cwd(),
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        env: safeEnv(config.baseUrl ? {BASE_URL: config.baseUrl} : {}),
    });

    // Try to parse JSON output
    try {
        const report = JSON.parse(result.stdout || '{}');
        return {
            specPath,
            passed: report.stats?.expected || 0,
            failed: report.stats?.unexpected || 0,
            flaky: report.stats?.flaky || 0,
            skipped: report.stats?.skipped || 0,
        };
    } catch {
        return {
            specPath,
            passed: result.status === 0 ? 1 : 0,
            failed: result.status === 0 ? 0 : 1,
            flaky: 0,
            skipped: 0,
        };
    }
}

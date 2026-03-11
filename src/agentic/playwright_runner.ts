// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawnSync} from 'child_process';
import {existsSync, readFileSync, mkdirSync, rmSync} from 'fs';
import {join, resolve} from 'path';
import type {PlaywrightRunResult, TestFailure} from './types.js';

const MAX_STDOUT_CHARS = 8000;
const MAX_ERROR_CHARS = 2000;
const MAX_STACK_CHARS = 1000;

interface PlaywrightReportSpec {
    title: string;
    ok: boolean;
    tests: Array<{
        status: string;
        results: Array<{
            status: string;
            duration: number;
            error?: {message: string; stack?: string};
        }>;
    }>;
}

interface PlaywrightReportSuite {
    title: string;
    specs: PlaywrightReportSpec[];
    suites?: PlaywrightReportSuite[];
}

interface PlaywrightReport {
    suites: PlaywrightReportSuite[];
    stats: {
        expected: number;
        unexpected: number;
        flaky: number;
        skipped: number;
        duration: number;
    };
}

function extractSpecs(suites: PlaywrightReportSuite[]): PlaywrightReportSpec[] {
    const specs: PlaywrightReportSpec[] = [];
    for (const suite of suites) {
        specs.push(...suite.specs);
        if (suite.suites) {
            specs.push(...extractSpecs(suite.suites));
        }
    }
    return specs;
}

export function parsePlaywrightJsonReport(report: PlaywrightReport, specPath: string): PlaywrightRunResult {
    const failures: TestFailure[] = [];
    const allSpecs = extractSpecs(report.suites);

    let passed = 0;
    let failed = 0;

    for (const spec of allSpecs) {
        if (spec.ok) {
            passed++;
        } else {
            failed++;
            const lastResult = spec.tests[0]?.results?.at(-1);
            failures.push({
                testTitle: spec.title,
                specPath,
                error: (lastResult?.error?.message || 'Unknown error').slice(0, MAX_ERROR_CHARS),
                stack: (lastResult?.error?.stack || '').slice(0, MAX_STACK_CHARS),
                line: extractLineNumber(lastResult?.error?.stack),
            });
        }
    }

    return {
        specPath,
        passed,
        failed,
        flaky: report.stats.flaky || 0,
        skipped: report.stats.skipped || 0,
        failures,
        stdout: '',
        durationMs: report.stats.duration || 0,
        compiled: true,
    };
}

function extractLineNumber(stack?: string): number | undefined {
    if (!stack) return undefined;
    const match = stack.match(/:(\d+):\d+\)?$/m);
    return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Run a single Playwright spec file and return structured results.
 * Uses a temp JSON reporter to get machine-readable output.
 */
export function runPlaywrightSpec(
    specPath: string,
    testsRoot: string,
    options: {project?: string; baseUrl?: string; timeoutMs?: number},
): PlaywrightRunResult {
    // SECURITY: Validate spec path is within testsRoot and has valid extension
    const resolvedSpec = resolve(specPath);
    const resolvedRoot = resolve(testsRoot);
    if (!resolvedSpec.startsWith(resolvedRoot + '/')) {
        throw new Error(`Security: spec path ${specPath} is outside testsRoot`);
    }
    if (!resolvedSpec.endsWith('.spec.ts') && !resolvedSpec.endsWith('.test.ts')) {
        throw new Error(`Security: spec path must end in .spec.ts or .test.ts`);
    }

    const reportDir = join(testsRoot, '.e2e-ai-agents', 'agentic-reports');
    if (!existsSync(reportDir)) {
        mkdirSync(reportDir, {recursive: true});
    }
    const reportPath = join(reportDir, `report-${Date.now()}.json`);

    const args = [
        'playwright', 'test',
        specPath,
        '--reporter', 'json',
        '--project', options.project || 'chrome',
    ];
    if (options.baseUrl) {
        args.push('--config', 'playwright.config.ts');
    }

    const startTime = Date.now();
    const result = spawnSync('npx', args, {
        cwd: testsRoot,
        encoding: 'utf-8',
        timeout: options.timeoutMs || 120000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
            ...process.env,
            PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
        },
    });
    const durationMs = Date.now() - startTime;

    const stdout = (result.stdout || '').slice(0, MAX_STDOUT_CHARS);
    const stderr = (result.stderr || '').slice(0, MAX_STDOUT_CHARS);

    // Check for compile errors
    if (stderr.includes('SyntaxError') || stderr.includes('Cannot find module') || stderr.includes('TypeError')) {
        return {
            specPath,
            passed: 0,
            failed: 1,
            flaky: 0,
            skipped: 0,
            failures: [{
                testTitle: '(compile)',
                specPath,
                error: stderr.slice(0, MAX_ERROR_CHARS),
                stack: '',
            }],
            stdout: `${stdout}\n${stderr}`,
            durationMs,
            compiled: false,
        };
    }

    // Try to parse JSON report from stdout (Playwright JSON reporter writes to stdout)
    try {
        const jsonReport = JSON.parse(stdout) as PlaywrightReport;
        const parsed = parsePlaywrightJsonReport(jsonReport, specPath);
        parsed.durationMs = durationMs;
        parsed.stdout = stdout;
        return parsed;
    } catch {
        // Fallback: try the file-based report
    }

    // Try file-based report
    if (existsSync(reportPath)) {
        try {
            const jsonReport = JSON.parse(readFileSync(reportPath, 'utf-8')) as PlaywrightReport;
            const parsed = parsePlaywrightJsonReport(jsonReport, specPath);
            parsed.durationMs = durationMs;
            parsed.stdout = stdout;
            try { rmSync(reportPath); } catch { /* ignore */ }
            return parsed;
        } catch {
            // Fallback to exit code
        }
    }

    // Last resort: use exit code
    return {
        specPath,
        passed: result.status === 0 ? 1 : 0,
        failed: result.status === 0 ? 0 : 1,
        flaky: 0,
        skipped: 0,
        failures: result.status !== 0
            ? [{testTitle: '(unknown)', specPath, error: stderr.slice(0, MAX_ERROR_CHARS), stack: ''}]
            : [],
        stdout,
        durationMs,
        compiled: !stderr.includes('Error'),
    };
}

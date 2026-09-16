// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawnSync} from 'child_process';
import {existsSync, readFileSync, mkdirSync} from 'fs';
import {join, resolve} from 'path';
import ts from 'typescript';
import type {PlaywrightRunResult, TestFailure} from './types.js';

interface ReportError {message?: string; stack?: string; matcherResult?: {name?: string; pass?: boolean}; location?: {file: string; line: number; column: number}}
interface ReportSpec {
    title: string;
    file?: string;
    tests: Array<{status: string; expectedStatus?: string; results: Array<{status: string; duration: number; error?: ReportError; errors?: ReportError[]}>}>;
}
interface ReportSuite {specs?: ReportSpec[]; suites?: ReportSuite[]}
interface PlaywrightReport {
    suites: ReportSuite[];
    config?: {rootDir?: string};
    errors?: ReportError[];
    stats: {flaky: number; skipped: number; duration: number};
}
function extractSpecs(suites: ReportSuite[]): ReportSpec[] {
    return suites.flatMap((suite) => [...(suite.specs || []), ...extractSpecs(suite.suites || [])]);
}

// The JSON reporter omits matcherResult. In that case also require the failure
// location to be an expect(...) matcher call in the requested artifact.
function assertionAtLocation(error: ReportError | undefined, specPath: string): boolean {
    if (error?.matcherResult?.pass === false) return true;
    const location = error?.location;
    if (!location || resolve(location.file) !== resolve(specPath)) return false;
    try {
        const source = ts.createSourceFile(specPath, readFileSync(specPath, 'utf8'), ts.ScriptTarget.Latest, true);
        const offset = source.getPositionOfLineAndCharacter(location.line - 1, location.column - 1);
        let assertion = false;
        const visit = (node: ts.Node) => {
            if (node.getStart(source) <= offset && offset < node.end && ts.isCallExpression(node)) {
                let expression: ts.Expression = node.expression;
                while (ts.isPropertyAccessExpression(expression)) expression = expression.expression;
                if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'expect') assertion = true;
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        return assertion;
    } catch { return false; }
}

export function parsePlaywrightJsonReport(report: PlaywrightReport, specPath: string): PlaywrightRunResult {
    const failures: TestFailure[] = [];
    let passed = 0;
    let failed = 0;
    let assertionFailures = 0;
    for (const spec of extractSpecs(report.suites)) {
        // A report for a different file must never certify the requested artifact.
        if (spec.file && resolve(report.config?.rootDir || '.', spec.file) !== resolve(specPath)) continue;
        for (const test of spec.tests) {
            const last = test.results.at(-1);
            const singleRun = test.results.length === 1;
            if (singleRun && test.status === 'expected' && (test.expectedStatus ?? 'passed') === 'passed' && last?.status === 'passed') passed++;
            else if (last && last.status !== 'skipped') {
                failed++;
                const error = last.error || last.errors?.[0];
                const message = error?.message || 'No terminal passing result';
                // Playwright serializes matcher errors as an expect matcher message and stack.
                // Reject runtime/load/timeout errors even when their process exits nonzero.
                const matcher = error?.matcherResult?.pass === false || /\bexpect\([^\n]*\)\.(?:not\.)?to[A-Z]\w*\(/.test(message.replace(/\u001b\[[0-9;]*m/g, ''));
                if (singleRun && test.status === 'unexpected' && (test.expectedStatus ?? 'passed') === 'passed' && last.status === 'failed' && matcher && assertionAtLocation(error, specPath)) assertionFailures++;
                failures.push({testTitle: spec.title, specPath, error: message.slice(0, 2000), stack: (error?.stack || '').slice(0, 1000)});
            }
        }
    }
    return {specPath, passed, failed, assertionFailures, flaky: report.stats.flaky || 0, skipped: report.stats.skipped || 0, failures, stdout: '', durationMs: report.stats.duration || 0, compiled: !report.errors?.length};
}

export function isCleanRun(run: PlaywrightRunResult): boolean {
    return run.compiled && run.passed > 0 && run.failed === 0 && run.flaky === 0 && run.skipped === 0 && run.exitCode === 0;
}

/** Execute only the requested spec. Raw JSON reports are retained as verification evidence. */
export function runPlaywrightSpec(specPath: string, testsRoot: string, options: {project?: string; baseUrl?: string; timeoutMs?: number}): PlaywrightRunResult {
    const resolvedSpec = resolve(specPath);
    const resolvedRoot = resolve(testsRoot);
    if (!resolvedSpec.startsWith(resolvedRoot + '/')) throw new Error(`Security: spec path ${specPath} is outside testsRoot`);
    if (!/\.(spec|test)\.ts$/.test(resolvedSpec)) throw new Error('Security: spec path must end in .spec.ts or .test.ts');
    const reportDir = join(resolvedRoot, '.e2e-ai-agents', 'agentic-reports');
    mkdirSync(reportDir, {recursive: true});
    const reportPath = join(reportDir, `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    const startTime = Date.now();
    const result = spawnSync('npx', ['--no-install', 'playwright', 'test', resolvedSpec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), '--reporter', 'json', '--project', options.project || 'chrome', '--retries', '0', '--workers', '1'], {
        cwd: resolvedRoot, encoding: 'utf8', timeout: options.timeoutMs || 120000, maxBuffer: 4 * 1024 * 1024,
        env: {...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath},
    });
    const stdout = `${result.stdout || ''}\n${result.stderr || ''}`.slice(0, 8000);
    const fallback: PlaywrightRunResult = {specPath, passed: 0, failed: 1, assertionFailures: 0, flaky: 0, skipped: 0, failures: [{testTitle: '(execution)', specPath, error: stdout || 'No valid Playwright report', stack: ''}], stdout, durationMs: Date.now() - startTime, compiled: false, exitCode: result.status, reportPath};
    try {
        if (!existsSync(reportPath)) return fallback;
        const report = JSON.parse(readFileSync(reportPath, 'utf8')) as PlaywrightReport;
        // Production evidence requires exact file identity; older synthetic parser callers may omit it.
        if (extractSpecs(report.suites).some((spec) => !spec.file || resolve(report.config?.rootDir || '.', spec.file) !== resolvedSpec)) return fallback;
        const parsed = parsePlaywrightJsonReport(report, resolvedSpec);
        if (result.error || result.signal || result.status === null || (result.status !== 0 && result.status !== 1)) return fallback;
        if (result.status !== 0 && parsed.failed === 0) return fallback;
        return {...parsed, stdout, durationMs: Date.now() - startTime, exitCode: result.status, reportPath};
    } catch {
        return fallback;
    }
}

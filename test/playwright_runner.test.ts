// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {parsePlaywrightJsonReport} from '../dist/agentic/playwright_runner.js';

describe('parsePlaywrightJsonReport', () => {
    it('parses a passing report', () => {
        const report = {
            suites: [{
                title: 'test.spec.ts',
                specs: [{
                    title: 'should do something',
                    ok: true,
                    tests: [{
                        status: 'expected',
                        results: [{status: 'passed', duration: 1000}],
                    }],
                }],
            }],
            stats: {
                expected: 1,
                unexpected: 0,
                flaky: 0,
                skipped: 0,
                duration: 1500,
            },
        };

        const result = parsePlaywrightJsonReport(report, 'test.spec.ts');
        assert.equal(result.passed, 1);
        assert.equal(result.failed, 0);
        assert.equal(result.failures.length, 0);
        assert.equal(result.compiled, true);
    });

    it('parses a failing report with error details', () => {
        const report = {
            suites: [{
                title: 'test.spec.ts',
                specs: [{
                    title: 'should fail',
                    ok: false,
                    tests: [{
                        status: 'unexpected',
                        results: [{
                            status: 'failed',
                            duration: 2000,
                            error: {
                                message: 'Expected "Hello" but got "World"',
                                stack: 'at Object.<anonymous> (test.spec.ts:10:5)',
                            },
                        }],
                    }],
                }],
            }],
            stats: {
                expected: 0,
                unexpected: 1,
                flaky: 0,
                skipped: 0,
                duration: 2500,
            },
        };

        const result = parsePlaywrightJsonReport(report, 'test.spec.ts');
        assert.equal(result.passed, 0);
        assert.equal(result.failed, 1);
        assert.equal(result.failures.length, 1);
        assert.equal(result.failures[0].testTitle, 'should fail');
        assert.ok(result.failures[0].error.includes('Expected'));
    });

    it('handles empty report', () => {
        const report = {suites: [], stats: {expected: 0, unexpected: 0, flaky: 0, skipped: 0, duration: 0}};
        const result = parsePlaywrightJsonReport(report, 'test.spec.ts');
        assert.equal(result.passed, 0);
        assert.equal(result.failed, 0);
    });
});

describe('verification report evidence', () => {
    const reportFor = (status, result, extra = {}) => ({suites: [{title: 'suite', specs: [{title: 'test', ok: true, tests: [{status, results: [result]}]}]}], stats: {expected: 1, unexpected: 0, flaky: 0, skipped: 0, duration: 1}, ...extra});
    it('does not count skipped, timed out, or flaky tests as passes even when spec.ok is true', () => {
        for (const [status, result] of [['skipped', 'skipped'], ['unexpected', 'timedOut'], ['flaky', 'passed']]) {
            assert.equal(parsePlaywrightJsonReport(reportFor(status, {status: result, duration: 1}), 'test.spec.ts').passed, 0);
        }
    });
    it('requires matcher evidence for assertion failures; runtime failures are not kills', () => {
        const assertion = parsePlaywrightJsonReport(reportFor('unexpected', {status: 'failed', duration: 1, error: {message: 'expect(received).toBe(expected)', matcherResult: {name: 'toBe', pass: false}}}), 'test.spec.ts');
        const runtime = parsePlaywrightJsonReport(reportFor('unexpected', {status: 'failed', duration: 1, error: {message: 'TypeError: broken'}}), 'test.spec.ts');
        assert.equal(assertion.assertionFailures, 1);
        assert.equal(runtime.assertionFailures, 0);
        const spoof = parsePlaywrightJsonReport(reportFor('unexpected', {status: 'failed', duration: 1, error: {message: 'TypeError: expect(received).toBe(expected)'}}), 'test.spec.ts');
        assert.equal(spoof.assertionFailures, 0);
    });
    it('does not treat report-level compile errors as executed passes', () => {
        const result = parsePlaywrightJsonReport(reportFor('expected', {status: 'passed', duration: 1}, {errors: [{message: 'SyntaxError'}]}), 'test.spec.ts');
        assert.equal(result.compiled, false);
        assert.equal(result.failed, 1);
        assert.equal(result.failures[0].testTitle, '(compile)');
        assert.equal(result.failures[0].error, 'SyntaxError');
    });
});

import {runPlaywrightSpec, isCleanRun} from '../dist/agentic/playwright_runner.js';
import {mkdtempSync, writeFileSync, symlinkSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

describe('real Playwright execution negatives', () => {
    it('uses the configured default project when no project is requested', () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'impact-default-project-')));
        try {
            symlinkSync(realpathSync(resolve('node_modules')), join(root, 'node_modules'), 'dir');
            writeFileSync(join(root, 'playwright.config.ts'), `export default {testDir: '.'};`);
            const path = join(root, 'default.spec.ts');
            writeFileSync(path, `import {test, expect} from '@playwright/test'; test('default project', () => {expect(1).toBe(1)});`);
            const result = runPlaywrightSpec(path, root, {timeoutMs: 30000});
            assert.equal(isCleanRun(result), true, result.stdout);
            assert.equal(result.passed, 1);
        } finally {rmSync(root, {recursive: true, force: true});}
    });

    it('rejects zero/skipped tests, load errors, runtime failures, timeouts, and exit without a report', () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'impact-report-fixture-')));
        symlinkSync(realpathSync(resolve('node_modules')), join(root, 'node_modules'), 'dir');
        writeFileSync(join(root, 'playwright.config.ts'), `export default {testDir: '.', projects: [{name: 'chrome'}], timeout: 200};`);
        const bodies = [
            `import {test} from '@playwright/test';`,
            `import {test} from '@playwright/test'; test.skip('skip', () => {});`,
            `import {test} from '@playwright/test'; import './missing-module'; test('load', () => {});`,
            `import {test} from '@playwright/test'; test('runtime', () => {throw new TypeError('runtime failure')});`,
            `import {test} from '@playwright/test'; test('timeout', async () => {await new Promise(() => {})});`,
            `process.exit(0);`,
        ];
        for (const [index, body] of bodies.entries()) {
            const path = join(root, `negative-${index}.spec.ts`);
            writeFileSync(path, body);
            const result = runPlaywrightSpec(path, root, {project: 'chrome', timeoutMs: 10000});
            assert.equal(isCleanRun(result), false, body);
            assert.equal(result.assertionFailures, 0, body);
            if (index === 2) {
                assert.equal(result.failures[0].testTitle, '(compile)');
                assert.match(result.failures[0].error, /missing-module/);
            }
        }
        console.log(`REAL_PLAYWRIGHT_NEGATIVE_FIXTURE=${root}`);
    });
    it('rejects other-file reports, expected failures and retry successes', () => {
        const report = {config: {rootDir: '/tmp'}, suites: [{specs: [{file: 'other.spec.ts', title: 'other', tests: [{status: 'expected', results: [{status: 'passed'}]}]}]}], stats: {flaky: 0, skipped: 0, duration: 0}};
        assert.equal(parsePlaywrightJsonReport(report, '/tmp/requested.spec.ts').passed, 0);
        for (const test of [
            {status: 'expected', expectedStatus: 'failed', results: [{status: 'failed', error: {message: 'expect(received).toBe(expected)'}}]},
            {status: 'flaky', results: [{status: 'failed'}, {status: 'passed'}]},
        ]) {
            report.suites[0].specs[0].tests = [test];
            const result = parsePlaywrightJsonReport(report, '/tmp/other.spec.ts');
            assert.equal(result.passed, 0);
            assert.equal(result.assertionFailures, 0);
        }
    });
});

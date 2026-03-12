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

import assert from 'assert';
import test from 'node:test';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {extractPlaywrightUnstableSpecs} from '../dist/agent/playwright_report.js';

test('extractPlaywrightUnstableSpecs returns failed and flaky specs from nested suites', () => {
    const root = mkdtempSync(join(tmpdir(), 'playwright-report-'));
    try {
        const reportPath = join(root, 'report.json');
        const report = {
            suites: [
                {
                    specs: [
                        {
                            file: join(root, 'specs/functional/channels/realtime.spec.ts'),
                            tests: [
                                {
                                    outcome: 'unexpected',
                                    results: [{status: 'failed'}],
                                },
                            ],
                        },
                        {
                            file: join(root, 'specs/functional/channels/threads.spec.ts'),
                            tests: [
                                {
                                    outcome: 'flaky',
                                    results: [{status: 'failed'}, {status: 'passed'}],
                                },
                            ],
                        },
                        {
                            file: join(root, 'specs/functional/channels/passing.spec.ts'),
                            tests: [
                                {
                                    outcome: 'expected',
                                    results: [{status: 'passed'}],
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

        const unstable = extractPlaywrightUnstableSpecs(reportPath, [root]);
        assert.equal(unstable.length, 2);
        assert.equal(unstable[0].specPath, 'specs/functional/channels/realtime.spec.ts');
        assert.equal(unstable[0].status, 'failed');
        assert.equal(unstable[1].specPath, 'specs/functional/channels/threads.spec.ts');
        assert.equal(unstable[1].status, 'flaky');
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('extractPlaywrightUnstableSpecs prefers failed status when same spec has flaky and failed tests', () => {
    const root = mkdtempSync(join(tmpdir(), 'playwright-report-merge-'));
    try {
        const reportPath = join(root, 'report.json');
        const specFile = join(root, 'specs/functional/channels/messaging.spec.ts');
        const report = {
            suites: [
                {
                    specs: [
                        {
                            file: specFile,
                            tests: [
                                {outcome: 'flaky', results: [{status: 'failed'}, {status: 'passed'}]},
                                {outcome: 'unexpected', results: [{status: 'failed'}]},
                            ],
                        },
                    ],
                },
            ],
        };
        writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

        const unstable = extractPlaywrightUnstableSpecs(reportPath, [root]);
        assert.equal(unstable.length, 1);
        assert.equal(unstable[0].status, 'failed');
        assert.equal(unstable[0].failingTests, 1);
        assert.equal(unstable[0].flakyTests, 1);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

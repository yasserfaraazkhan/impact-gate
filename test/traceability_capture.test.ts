import assert from 'assert';
import test from 'node:test';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {captureTraceabilityInput} from '../dist/agent/traceability_capture.js';

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf-8'));
}

test('traceability capture uses coverage map when available', () => {
    const root = mkdtempSync(join(tmpdir(), 'traceability-capture-coverage-'));
    try {
        const appPath = join(root, 'webapp');
        const testsRoot = join(root, 'e2e-tests', 'playwright');
        mkdirSync(appPath, {recursive: true});
        mkdirSync(testsRoot, {recursive: true});

        const specPath = join(testsRoot, 'specs', 'channels', 'channels.switch.spec.ts');
        mkdirSync(join(testsRoot, 'specs', 'channels'), {recursive: true});
        writeFileSync(specPath, '// test', 'utf-8');

        const reportPath = join(root, 'playwright-report.json');
        writeFileSync(
            reportPath,
            JSON.stringify({
                suites: [
                    {
                        specs: [
                            {
                                file: specPath,
                                tests: [{status: 'passed'}],
                            },
                        ],
                    },
                ],
            }),
            'utf-8',
        );

        const coveragePath = join(root, 'coverage-map.json');
        writeFileSync(
            coveragePath,
            JSON.stringify({
                tests: [
                    {
                        test: 'specs/channels/channels.switch.spec.ts',
                        touchedFiles: ['channels/src/components/channel_switcher/channel_switcher.tsx'],
                    },
                ],
            }),
            'utf-8',
        );

        const changedFilesPath = join(root, 'changed-files.txt');
        writeFileSync(changedFilesPath, 'channels/src/unused/fallback.ts\n', 'utf-8');

        const result = captureTraceabilityInput({
            appPath,
            testsRoot,
            reportPath,
            sinceRef: 'HEAD~1',
            coverageMapPath: coveragePath,
            changedFilesPath,
        });

        assert.equal(result.testsSeen, 1);
        assert.equal(result.runsGenerated, 1);
        assert.equal(result.changedFilesUsed, 1);
        assert.equal(result.warnings.length, 0);

        const payload = readJson(result.outputPath);
        assert.equal(payload.runs.length, 1);
        assert.equal(payload.runs[0].test, 'specs/channels/channels.switch.spec.ts');
        assert.deepEqual(payload.runs[0].touchedFiles, ['channels/src/components/channel_switcher/channel_switcher.tsx']);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('traceability capture emits no coverage edges when per-test coverage is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'traceability-capture-fallback-'));
    try {
        const appPath = join(root, 'webapp');
        const testsRoot = join(root, 'e2e-tests', 'playwright');
        mkdirSync(appPath, {recursive: true});
        mkdirSync(testsRoot, {recursive: true});

        const reportPath = join(root, 'playwright-report.json');
        writeFileSync(
            reportPath,
            JSON.stringify({
                suites: [
                    {
                        specs: [
                            {
                                file: 'specs/channels/channels.switch.spec.ts',
                                tests: [{results: [{status: 'failed'}]}],
                            },
                            {
                                file: 'specs/channels/skipped.spec.ts',
                                tests: [{status: 'skipped'}],
                            },
                        ],
                    },
                ],
            }),
            'utf-8',
        );

        const changedFilesPath = join(root, 'changed-files.txt');
        writeFileSync(
            changedFilesPath,
            ['channels/src/components/channel_switcher/channel_switcher.tsx', 'channels/src/actions/websocket_actions.ts'].join('\n'),
            'utf-8',
        );

        const result = captureTraceabilityInput({
            appPath,
            testsRoot,
            reportPath,
            sinceRef: 'HEAD~1',
            changedFilesPath,
        });

        assert.equal(result.testsSeen, 1);
        assert.equal(result.runsGenerated, 0);
        assert.equal(result.changedFilesUsed, 2);
        assert.match(result.warnings.join(' '), /Per-test source coverage unavailable/);

        const payload = readJson(result.outputPath);
        assert.deepEqual(payload.runs, []);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

import assert from 'assert';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {ingestTraceabilityInput} from '../dist/agent/traceability_ingest.js';

const TRACEABILITY_CONFIG = {
    enabled: true,
    manifestPath: '.e2e-ai-agents/traceability.json',
    minSignalsPerTest: 1,
};

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf-8'));
}

test('traceability ingest writes manifest and state', () => {
    const root = mkdtempSync(join(tmpdir(), 'traceability-ingest-'));
    try {
        const result = ingestTraceabilityInput(
            root,
            TRACEABILITY_CONFIG,
            {
                runs: [
                    {
                        test: 'specs/channels/channels.switch.spec.ts',
                        touchedFiles: [
                            'channels/src/components/channel_switcher/channel_switcher.tsx',
                            'channels/src/components/channel_switcher/channel_switcher_dropdown.tsx',
                        ],
                    },
                ],
            },
        );

        assert.equal(result.entriesIngested, 1);
        assert.equal(result.testsTracked, 1);
        assert.equal(result.edgesTracked, 2);

        const manifest = readJson(result.manifestPath);
        assert.equal(manifest.tests.length, 1);
        assert.equal(manifest.tests[0].test, 'specs/channels/channels.switch.spec.ts');
        assert.deepEqual(
            manifest.tests[0].touchedFiles.sort(),
            [
                'channels/src/components/channel_switcher/channel_switcher.tsx',
                'channels/src/components/channel_switcher/channel_switcher_dropdown.tsx',
            ].sort(),
        );

        const state = readJson(result.statePath);
        assert(state.tests['specs/channels/channels.switch.spec.ts']);
        assert.equal(
            state.tests['specs/channels/channels.switch.spec.ts'].files['channels/src/components/channel_switcher/channel_switcher.tsx'],
            1,
        );
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('traceability ingest honors minHits threshold across runs', () => {
    const root = mkdtempSync(join(tmpdir(), 'traceability-ingest-threshold-'));
    try {
        const payload = {
            tests: [
                {
                    test: 'specs/messaging/realtime.spec.ts',
                    touchedFiles: ['channels/src/actions/websocket_actions.ts'],
                },
            ],
        };

        const first = ingestTraceabilityInput(root, TRACEABILITY_CONFIG, payload, {minHits: 2});
        const firstManifest = readJson(first.manifestPath);
        assert.equal(firstManifest.tests.length, 0);

        const second = ingestTraceabilityInput(root, TRACEABILITY_CONFIG, payload, {minHits: 2});
        const secondManifest = readJson(second.manifestPath);
        assert.equal(secondManifest.tests.length, 1);
        assert.deepEqual(
            secondManifest.tests[0].touchedFiles,
            ['channels/src/actions/websocket_actions.ts'],
        );
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

import {captureTraceabilityInput} from '../dist/agent/traceability_capture.js';

test('W3 capture origins survive ingest without becoming measured and invalid dates are pruned', () => {
    const root = mkdtempSync(join(tmpdir(), 'w3-origin-'));
    try {
        const reportPath = join(root, 'report.json'); const coverageMapPath = join(root, 'map.json'); const changedFilesPath = join(root, 'changed.txt');
        writeFileSync(reportPath, JSON.stringify({suites: [{specs: [{file: 'ledger.spec.ts', tests: [{status: 'passed'}]}]}]}));
        writeFileSync(coverageMapPath, JSON.stringify({tests: [{test: 'ledger.spec.ts', touchedFiles: ['ledger.ts', 'other.ts']}]}));
        writeFileSync(changedFilesPath, 'unknown.ts');
        const captured = captureTraceabilityInput({appPath: root, testsRoot: root, reportPath, coverageMapPath, changedFilesPath, sinceRef: 'HEAD'});
        const result = ingestTraceabilityInput(root, TRACEABILITY_CONFIG, readJson(captured.outputPath));
        let entry = readJson(result.manifestPath).tests[0];
        assert.deepEqual(entry.origins, ['traceability-capture']);
        assert.equal(entry.evidence, 'declared');
        assert.equal(entry.signalCount, 2, 'two file hits are not two executions');
        ingestTraceabilityInput(root, TRACEABILITY_CONFIG, {tests: [{test: 'ledger.spec.ts', touchedFiles: ['ledger.ts']}]});
        entry = readJson(result.manifestPath).tests[0];
        assert.deepEqual(entry.origins, ['legacy-import', 'traceability-capture']);
        const bad = ingestTraceabilityInput(root, TRACEABILITY_CONFIG, {tests: [{test: 'bad.spec.ts', touchedFiles: ['bad.ts'], timestamp: 'invalid'}]});
        assert.equal(readJson(bad.manifestPath).tests.some((x) => x.test === 'bad.spec.ts'), false);
    } finally {rmSync(root, {recursive: true, force: true});}
});


test('rejects impossible calendar timestamps during ingest pruning and retains valid ISO forms', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'traceability-calendar-'));
    let now = Date.parse('2026-09-16T00:00:00Z');
    t.mock.method(Date, 'now', () => now);
    try {
        for (const [timestamp, clock, eligible] of [
            ['2026-06-31T00:00:00Z', '2026-09-16', false],
            ['2025-02-29T00:00:00Z', '2025-03-02', false],
            ['2024-02-30T00:00:00Z', '2024-03-02', false],
            ['2100-02-29T00:00:00Z', '2100-03-02', false],
            ['2000-02-29T00:00:00Z', '2000-03-02', true],
            ['2024-02-29T00:00:00.000Z', '2024-03-02', true],
            ['2024-02-29', '2024-03-02', true],
            ['2024-03-01T00:30:00+05:30', '2024-03-02', true],
            ['2024-03-03T00:00:00Z', '2024-03-02', false],
            ['2023-02-28T00:00:00Z', '2024-03-02', false],
        ]) {
            now = Date.parse(clock);
            const result = ingestTraceabilityInput(root, TRACEABILITY_CONFIG, {runs: [{test: 'calendar.spec.ts', touchedFiles: ['calendar.ts'], timestamp}]});
            assert.equal(readJson(result.manifestPath).tests.length > 0, eligible, timestamp);
        }
    } finally {rmSync(root, {recursive: true, force: true});}
});

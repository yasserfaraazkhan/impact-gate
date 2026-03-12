import assert from 'assert';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync} from 'fs';
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

import assert from 'assert';
import test from 'node:test';
import {chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {runPlaywrightPipeline, runTargetedSpecHeal} from '../dist/agent/pipeline.js';

function writeFakePlaywrightBinary(root, body) {
    const binDir = join(root, 'node_modules', '.bin');
    mkdirSync(binDir, {recursive: true});
    const binPath = join(binDir, 'playwright');
    writeFileSync(binPath, body, 'utf-8');
    chmodSync(binPath, 0o755);
}

test('runPlaywrightPipeline falls back to package-native generation and static heal when local playwright binary is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'pipeline-fallback-'));
    try {
        const summary = runPlaywrightPipeline(
            root,
            [
                {
                    id: 'messaging.realtime',
                    name: 'Realtime Messaging',
                    kind: 'flow',
                    score: 42,
                    priority: 'P0',
                    reasons: ['High risk area'],
                    keywords: ['realtime', 'messaging'],
                    files: ['channels/src/actions/websocket_actions.ts'],
                },
            ],
            {
                enabled: true,
                scenarios: 3,
                outputDir: 'specs/functional/ai-assisted',
                heal: true,
                mcp: true,
                mcpAllowFallback: true,
            },
        );

        assert.equal(summary.runner, 'package-native');
        assert.equal(summary.mcp.requested, true);
        assert.equal(summary.mcp.active, false);
        assert.equal(summary.mcp.backend, 'package-native');
        assert.equal(summary.warnings.some((warning) => warning.includes('package-native pipeline fallback')), false);
        assert(summary.warnings.some((warning) => warning.includes('Playwright binary was not found')));
        assert.equal(summary.results.length, 1);
        assert.equal(summary.results[0].generateStatus, 'success');
        assert.equal(summary.results[0].healStatus, 'success');

        const generatedDir = summary.results[0].generatedDir;
        const specPath = join(generatedDir, 'messaging.realtime.spec.ts');
        assert.equal(existsSync(specPath), true);
        const content = readFileSync(specPath, 'utf-8');
        assert(content.includes("test('P0: Realtime Messaging generated coverage'"));
        assert(content.includes("tag: '@ai-assisted'"));
        assert.equal(content.includes('test.describe('), false);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('runPlaywrightPipeline keeps strict official MCP mode by default and does not auto-fallback', () => {
    const root = mkdtempSync(join(tmpdir(), 'pipeline-mcp-strict-'));
    try {
        const summary = runPlaywrightPipeline(
            root,
            [
                {
                    id: 'messaging.realtime',
                    name: 'Realtime Messaging',
                    kind: 'flow',
                    score: 42,
                    priority: 'P0',
                    reasons: ['High risk area'],
                    keywords: ['realtime', 'messaging'],
                    files: ['channels/src/actions/websocket_actions.ts'],
                },
            ],
            {
                enabled: true,
                scenarios: 3,
                outputDir: 'specs/functional/ai-assisted',
                heal: true,
                mcp: true,
            },
        );

        assert.equal(summary.runner, 'unknown');
        assert.equal(summary.mcp.requested, true);
        assert.equal(summary.mcp.active, false);
        assert.equal(summary.mcp.backend, 'unknown');
        assert(summary.warnings.some((warning) => warning.includes('strict')));
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('package-native heal rewrites an invalid existing spec when quality guardrails fail', () => {
    const root = mkdtempSync(join(tmpdir(), 'pipeline-heal-existing-'));
    try {
        writeFakePlaywrightBinary(root, '#!/bin/sh\nexit 0\n');
        const specPath = join(
            root,
            'specs/functional/ai-assisted/messaging.realtime/messaging.realtime.spec.ts',
        );
        mkdirSync(join(root, 'specs/functional/ai-assisted/messaging.realtime'), {recursive: true});
        writeFileSync(
            specPath,
            "import {test} from '@mattermost/playwright-lib';\n\ntest.describe('bad', () => { test('x', async ({pw}) => { await pw.mainClient.addToChannel('x'); }); });\n",
            'utf-8',
        );

        const summary = runPlaywrightPipeline(
            root,
            [
                {
                    id: 'messaging.realtime',
                    name: 'Realtime Messaging',
                    kind: 'flow',
                    score: 42,
                    priority: 'P0',
                    reasons: ['High risk area'],
                    keywords: ['realtime', 'messaging'],
                    files: ['channels/src/actions/websocket_actions.ts'],
                },
            ],
            {
                enabled: true,
                scenarios: 3,
                outputDir: 'specs/functional/ai-assisted',
                heal: true,
                mcp: false,
            },
        );

        assert.equal(summary.runner, 'package-native');
        assert.equal(summary.results[0].generateStatus, 'success');
        assert.equal(summary.results[0].healStatus, 'success');
        const healed = readFileSync(specPath, 'utf-8');
        assert.equal(healed.includes('test.describe('), false);
        assert.equal(healed.includes('pw.mainClient'), false);
        assert(healed.includes("tag: '@ai-assisted'"));
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('package-native heal reports failure and removes new generated file when all validation attempts fail', () => {
    const root = mkdtempSync(join(tmpdir(), 'pipeline-heal-fail-'));
    try {
        writeFakePlaywrightBinary(root, '#!/bin/sh\necho "forced validation failure" >&2\nexit 1\n');
        const summary = runPlaywrightPipeline(
            root,
            [
                {
                    id: 'messaging.realtime',
                    name: 'Realtime Messaging',
                    kind: 'flow',
                    score: 42,
                    priority: 'P0',
                    reasons: ['High risk area'],
                    keywords: ['realtime', 'messaging'],
                    files: ['channels/src/actions/websocket_actions.ts'],
                },
            ],
            {
                enabled: true,
                scenarios: 3,
                outputDir: 'specs/functional/ai-assisted',
                heal: true,
                mcp: false,
            },
        );

        assert.equal(summary.runner, 'package-native');
        assert.equal(summary.results[0].generateStatus, 'failed');
        assert.equal(summary.results[0].healStatus, 'failed');
        assert(summary.results[0].error.includes('Heal validation failed.'));

        const generatedPath = join(
            root,
            'specs/functional/ai-assisted/messaging.realtime/messaging.realtime.spec.ts',
        );
        assert.equal(existsSync(generatedPath), false);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('runTargetedSpecHeal heals an invalid existing failing spec in place', () => {
    const root = mkdtempSync(join(tmpdir(), 'pipeline-targeted-heal-'));
    try {
        writeFakePlaywrightBinary(root, '#!/bin/sh\nexit 0\n');
        const specPath = join(root, 'specs/functional/channels/threads_list.spec.ts');
        mkdirSync(join(root, 'specs/functional/channels'), {recursive: true});
        writeFileSync(
            specPath,
            "import {test} from '@mattermost/playwright-lib';\n\ntest.describe('broken', () => { test('x', async () => {}); });\n",
            'utf-8',
        );

        const summary = runTargetedSpecHeal(
            root,
            [
                {
                    specPath: 'specs/functional/channels/threads_list.spec.ts',
                    status: 'failed',
                    reason: 'playwright report failure',
                },
            ],
            {
                enabled: true,
                scenarios: 3,
                outputDir: 'specs/functional/ai-assisted',
                heal: true,
                mcp: false,
            },
        );

        assert.equal(summary.runner, 'package-native');
        assert.equal(summary.results.length, 1);
        assert.equal(summary.results[0].generateStatus, 'success');
        assert.equal(summary.results[0].healStatus, 'success');

        const healed = readFileSync(specPath, 'utf-8');
        assert.equal(healed.includes('test.describe('), false);
        assert(healed.includes("tag: '@ai-assisted'"));
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

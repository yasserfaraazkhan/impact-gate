import assert from 'assert';
import test from 'node:test';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';

import {mapAIFlowsFromFiles} from '../dist/agent/ai_flow_analysis.js';

const BASE_CONFIG = {
    enabled: true,
    strict: false,
    provider: 'anthropic',
    contextFiles: ['CLAUDE.OPTIONAL.md'],
    maxFilesPerRequest: 50,
    maxFlowsPerRequest: 20,
    maxTokens: 1000,
    temperature: 0,
};

function sampleFile(relativePath) {
    return {
        relativePath,
        extension: 'tsx',
        exists: true,
        content: 'export function Example(){return <button onClick={() => true}>Example</button>;}',
        isUI: true,
        isScreen: false,
        isComponent: true,
        isState: false,
        isStyle: false,
        hasInteractions: true,
        keywords: ['analytics', 'system'],
        flowId: 'analytics',
        flowName: 'Analytics',
        flowKind: 'flow',
        audience: ['member'],
        flags: [],
    };
}

test('ai flow analysis returns disabled state when feature flag is off', async () => {
    const result = await mapAIFlowsFromFiles(
        '/tmp/app',
        '/tmp/tests',
        {...BASE_CONFIG, enabled: false},
        [sampleFile('channels/src/components/analytics/system_analytics/system_analytics.tsx')],
        ['channels/src/components/analytics/system_analytics/system_analytics.tsx'],
    );

    assert.equal(result.enabled, false);
    assert.equal(result.used, false);
    assert.equal(result.flows.length, 0);
});

test('ai flow analysis degrades gracefully when Anthropic key is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-flow-analysis-'));
    const appRoot = join(root, 'app');
    const testsRoot = join(root, 'tests');
    mkdirSync(appRoot, {recursive: true});
    mkdirSync(testsRoot, {recursive: true});
    writeFileSync(join(testsRoot, 'CLAUDE.OPTIONAL.md'), '# Context\nUse system console patterns.', 'utf-8');

    const previousKey = process.env.ANTHROPIC_API_KEY;
    try {
        delete process.env.ANTHROPIC_API_KEY;
        const result = await mapAIFlowsFromFiles(
            appRoot,
            testsRoot,
            BASE_CONFIG,
            [sampleFile('channels/src/components/analytics/system_analytics/system_analytics.tsx')],
            ['channels/src/components/analytics/system_analytics/system_analytics.tsx'],
        );

        assert.equal(result.enabled, true);
        assert.equal(result.used, false);
        assert.equal(result.flows.length, 0);
        assert(
            result.warnings.some((warning) => warning.includes('AI flow analysis unavailable')),
            `expected missing-key warning, got: ${result.warnings.join(' | ')}`,
        );
    } finally {
        if (previousKey) {
            process.env.ANTHROPIC_API_KEY = previousKey;
        } else {
            delete process.env.ANTHROPIC_API_KEY;
        }
        rmSync(root, {recursive: true, force: true});
    }
});

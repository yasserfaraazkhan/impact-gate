import assert from 'assert';
import test from 'node:test';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';

import {mapAITestsToFlows} from '../dist/agent/ai_mapping.js';

const BASE_CONFIG = {
    enabled: true,
    provider: 'anthropic',
    contextFiles: ['CLAUDE.OPTIONAL.md'],
    maxFlowsPerRequest: 10,
    maxCandidateTests: 50,
    maxTokens: 1000,
    temperature: 0,
};

test('ai mapping returns disabled state when feature flag is off', async () => {
    const result = await mapAITestsToFlows(
        '/tmp/app',
        '/tmp/tests',
        {...BASE_CONFIG, enabled: false},
        [],
        [],
    );

    assert.equal(result.enabled, false);
    assert.equal(result.used, false);
    assert.equal(result.coverage.length, 0);
});

test('ai mapping degrades gracefully when Anthropic key is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-mapping-missing-key-'));
    const appRoot = join(root, 'app');
    const testsRoot = join(root, 'tests');
    mkdirSync(appRoot, {recursive: true});
    mkdirSync(join(testsRoot, 'specs'), {recursive: true});
    writeFileSync(join(testsRoot, 'CLAUDE.OPTIONAL.md'), '# Test context\nUse system console E2E patterns.', 'utf-8');

    const previousKey = process.env.ANTHROPIC_API_KEY;
    try {
        delete process.env.ANTHROPIC_API_KEY;
        const result = await mapAITestsToFlows(
            appRoot,
            testsRoot,
            BASE_CONFIG,
            [
                {
                    id: 'system.analytics',
                    name: 'System Analytics',
                    kind: 'flow',
                    score: 10,
                    priority: 'P0',
                    reasons: ['Changed analytics panel'],
                    keywords: ['analytics'],
                    files: ['channels/src/components/analytics/system_analytics/system_analytics.tsx'],
                },
            ],
            [
                {
                    path: 'specs/functional/system_console/system_analytics.spec.ts',
                    content: null,
                },
            ],
        );

        assert.equal(result.enabled, true);
        assert.equal(result.used, false);
        assert.equal(result.coverage.length, 0);
        assert(
            result.warnings.some((warning) => warning.includes('AI mapping unavailable')),
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

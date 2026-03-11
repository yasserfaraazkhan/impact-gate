// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it, mock} from 'node:test';
import assert from 'node:assert/strict';
import {runAgenticGeneration} from '../dist/agentic/runner.js';

// Mock provider
function createMockProvider(responses) {
    let callIndex = 0;
    return {
        name: 'mock',
        generateText: mock.fn(async () => {
            const resp = responses[callIndex] || responses[responses.length - 1];
            callIndex++;
            return {text: resp, usage: {inputTokens: 100, outputTokens: 50}};
        }),
    };
}

describe('runAgenticGeneration', () => {
    it('returns summary with results for dry run', async () => {
        const provider = createMockProvider([
            "import {test} from '@mattermost/playwright-lib';\ntest('my test', async ({pw}) => { const {user} = await pw.initSetup(); });",
        ]);

        const summary = await runAgenticGeneration({
            scenarios: [{
                id: 'test-flow',
                name: 'Test Flow',
                scenarios: ['Verify user can post a message'],
                routeFamily: 'channels',
                priority: 'P0',
            }],
            config: {
                maxAttempts: 3,
                project: 'chrome',
                testTimeoutMs: 120000,
                testsRoot: '/tmp/e2e-agentic-test-' + Date.now(),
                dryRun: true,
            },
            provider,
            apiSurfaceHint: 'ChannelsPage: goto(), toBeVisible()',
        });

        assert.ok(summary.totalGenerated >= 1);
        assert.ok(summary.results.length >= 1);
        // Dry run skips execution
        assert.equal(summary.results[0].status, 'skipped');
    });

    it('handles LLM returning invalid code', async () => {
        const provider = createMockProvider(['This is not valid test code at all.']);

        const summary = await runAgenticGeneration({
            scenarios: [{
                id: 'bad-flow',
                name: 'Bad Flow',
                scenarios: ['Something'],
                routeFamily: 'channels',
                priority: 'P1',
            }],
            config: {
                maxAttempts: 3,
                project: 'chrome',
                testTimeoutMs: 120000,
                testsRoot: '/tmp/e2e-agentic-test-' + Date.now(),
                dryRun: true,
            },
            provider,
            apiSurfaceHint: '',
        });

        assert.equal(summary.results[0].status, 'failed');
        assert.ok(summary.warnings.length > 0);
    });
});

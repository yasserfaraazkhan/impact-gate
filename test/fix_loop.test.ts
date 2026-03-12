// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {buildFixPrompt, applyFix} from '../dist/agentic/fix_loop.js';

describe('buildFixPrompt', () => {
    it('includes failure details and spec code in prompt', () => {
        const prompt = buildFixPrompt({
            specCode: "import {test} from '@mattermost/playwright-lib';\ntest('foo', async ({pw}) => { throw new Error('boom'); });",
            failures: [
                {testTitle: 'foo', specPath: 'test.spec.ts', error: 'boom', stack: 'at test.spec.ts:2:50'},
            ],
            attempt: 1,
            maxAttempts: 3,
            apiSurfaceHint: 'ChannelsPage: goto(), toBeVisible(), postMessage(msg)',
        });

        assert.ok(prompt.includes('boom'));
        assert.ok(prompt.includes('foo'));
        assert.ok(prompt.includes('ChannelsPage'));
        assert.ok(prompt.includes('attempt 1 of 3'));
    });

    it('includes compile error context', () => {
        const prompt = buildFixPrompt({
            specCode: "import {test} from 'wrong-lib';",
            failures: [{testTitle: '(compile)', specPath: 'test.spec.ts', error: 'Cannot find module', stack: ''}],
            attempt: 1,
            maxAttempts: 3,
        });

        assert.ok(prompt.includes('Cannot find module'));
        assert.ok(prompt.includes('COMPILE ERROR'));
    });
});

describe('applyFix', () => {
    it('extracts code from LLM response', () => {
        const llmResponse = "```typescript\nimport {test} from '@mattermost/playwright-lib';\ntest('fixed', async ({pw}) => {});\n```";
        const result = applyFix(llmResponse);
        assert.ok(result.includes("test('fixed'"));
        assert.ok(!result.includes('```'));
    });

    it('returns raw response if no fences', () => {
        const llmResponse = "import {test} from '@mattermost/playwright-lib';\ntest('fixed', async ({pw}) => {});";
        const result = applyFix(llmResponse);
        assert.ok(result.includes("test('fixed'"));
    });

    it('returns null for empty/invalid response', () => {
        assert.equal(applyFix(''), null);
        assert.equal(applyFix('No code here'), null);
    });
});

// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {buildFixPrompt, applyFix, generateFix} from '../dist/agentic/fix_loop.js';
import {resolveGenerationProfile} from '../dist/prompts/generation_profile.js';

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

    it('uses profile conventions for generic and Mattermost repairs', () => {
        const context = {specCode: 'test code', failures: [], attempt: 1, maxAttempts: 2};
        const generic = buildFixPrompt(context);
        assert.match(generic, /@playwright\/test/);
        assert.doesNotMatch(generic, /Mattermost|pw\.initSetup|@mattermost/);
        const mattermost = buildFixPrompt({...context, profile: resolveGenerationProfile({profile: 'mattermost'})});
        assert.match(mattermost, /@mattermost\/playwright-lib/);
        assert.match(mattermost, /pw\.initSetup/);
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
        const result = applyFix(llmResponse, resolveGenerationProfile({profile: 'mattermost'}));
        assert.ok(result.includes("test('fixed'"));
        assert.ok(!result.includes('```'));
    });

    it('returns raw response if no fences', () => {
        const llmResponse = "import {test} from '@mattermost/playwright-lib';\ntest('fixed', async ({pw}) => {});";
        const result = applyFix(llmResponse, resolveGenerationProfile({profile: 'mattermost'}));
        assert.ok(result.includes("test('fixed'"));
        assert.doesNotMatch(result, /@playwright\/test/);
    });

    it('returns null for empty/invalid response', () => {
        assert.equal(applyFix(''), null);
        assert.equal(applyFix('No code here'), null);
    });

    it('retains a generic import and supplies the selected framework when missing', () => {
        const code = "import {test, expect} from '@playwright/test';\ntest('fixed', () => { expect(true).toBe(true); });";
        assert.equal(applyFix(code), code);
        const mattermost = applyFix("test('fixed', () => {});", resolveGenerationProfile({profile: 'mattermost'}));
        assert.match(mattermost, /@mattermost\/playwright-lib/);
        assert.doesNotMatch(mattermost, /@playwright\/test/);
    });

    it('passes the selected profile through the repair provider and parser', async () => {
        let prompt;
        const provider = {generateText: async (input) => {prompt = input; return {text: "test('fixed', () => {});"};}};
        const result = await generateFix(provider, {specCode: '', failures: [], attempt: 1, maxAttempts: 2, profile: resolveGenerationProfile({profile: 'mattermost'})});
        assert.match(prompt, /pw\.initSetup/);
        assert.match(result.code, /@mattermost\/playwright-lib/);
        assert.doesNotMatch(result.code, /@playwright\/test/);
    });
});

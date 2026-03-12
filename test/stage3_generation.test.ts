// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {buildGenerationPrompt, parseGenerationResponse, detectHallucinatedMethods} from '../dist/prompts/generation.js';

const MOCK_DECISION = {
    flowId: 'scheduled_post_create',
    flowName: 'Create scheduled message',
    routeFamily: 'scheduled_posts',
    featureId: undefined,
    specificRoute: '/{team}/scheduled_posts',
    changedFiles: ['webapp/channels/src/components/scheduled_message_modal.tsx'],
    evidence: 'Changed scheduled message modal component',
    evidenceSource: 'ai',
    confidence: 75,
    existingSpecs: [],
    action: 'create_spec',
    priority: 'P1',
    userActions: ['schedule a message for tomorrow', 'verify indicator appears'],
    scenariosToAdd: ['schedule message and verify scheduled post indicator', 'delete scheduled message and verify removal'],
};

const MOCK_API_SURFACE = {
    pageObjects: [
        {
            className: 'ChannelsPage',
            file: '/lib/src/ui/pages/channels_page.ts',
            methods: [
                {name: 'goto', kind: 'method'},
                {name: 'toBeVisible', kind: 'method'},
                {name: 'postMessage', kind: 'method'},
                {name: 'scheduleMessage', kind: 'method'},
                {name: 'getLastPost', kind: 'method'},
                {name: 'centerView', kind: 'property'},
                {name: 'sidebarLeft', kind: 'property'},
            ],
        },
        {
            className: 'ScheduledPostsPage',
            file: '/lib/src/ui/pages/scheduled_posts_page.ts',
            methods: [
                {name: 'goto', kind: 'method'},
                {name: 'toBeVisible', kind: 'method'},
                {name: 'getLastPost', kind: 'method'},
                {name: 'getBadgeCountOnTab', kind: 'method'},
                {name: 'badge', kind: 'property'},
                {name: 'noScheduledDrafts', kind: 'property'},
                {name: 'sendMessageNowModal', kind: 'property'},
                {name: 'deleteScheduledPostModal', kind: 'property'},
            ],
        },
    ],
    generatedAt: new Date().toISOString(),
};

describe('generation prompts', () => {
    describe('buildGenerationPrompt', () => {
        it('should include flow name and route family', () => {
            const prompt = buildGenerationPrompt({
                decision: MOCK_DECISION,
                apiSurface: MOCK_API_SURFACE,
                specPath: 'specs/functional/ai-assisted/scheduled_post_create.spec.ts',
                mode: 'create_spec',
            });
            assert.ok(prompt.includes('Create scheduled message'));
            assert.ok(prompt.includes('scheduled_posts'));
            assert.ok(prompt.includes('create_spec') || prompt.includes('NEW spec file'));
        });

        it('should include scenarios in prompt', () => {
            const prompt = buildGenerationPrompt({
                decision: MOCK_DECISION,
                apiSurface: MOCK_API_SURFACE,
                specPath: 'specs/functional/ai-assisted/test.spec.ts',
                mode: 'create_spec',
            });
            assert.ok(prompt.includes('schedule message and verify scheduled post indicator'));
            assert.ok(prompt.includes('delete scheduled message'));
        });

        it('should include available page objects', () => {
            const prompt = buildGenerationPrompt({
                decision: MOCK_DECISION,
                apiSurface: MOCK_API_SURFACE,
                specPath: 'specs/functional/ai-assisted/test.spec.ts',
                mode: 'create_spec',
            });
            assert.ok(prompt.includes('ChannelsPage') || prompt.includes('ScheduledPostsPage'));
        });

        it('should include mandatory rules about @mattermost/playwright-lib', () => {
            const prompt = buildGenerationPrompt({
                decision: MOCK_DECISION,
                apiSurface: MOCK_API_SURFACE,
                specPath: 'specs/functional/ai-assisted/test.spec.ts',
                mode: 'create_spec',
            });
            assert.ok(prompt.includes('@mattermost/playwright-lib'));
            assert.ok(prompt.includes('pw.initSetup'));
            assert.ok(prompt.includes('pw.testBrowser.login'));
        });

        it('should include existing spec content for add_scenarios mode', () => {
            const existingContent = "import {test} from '@mattermost/playwright-lib';\n\ntest('existing test', async ({pw}) => {});";
            const prompt = buildGenerationPrompt({
                decision: {...MOCK_DECISION, action: 'add_scenarios'},
                apiSurface: MOCK_API_SURFACE,
                existingSpecContent: existingContent,
                specPath: 'specs/functional/channels/scheduled.spec.ts',
                mode: 'add_scenarios',
            });
            assert.ok(prompt.includes('EXISTING SPEC'));
            assert.ok(prompt.includes('existing test'));
        });

        it('should fallback to raw Playwright when no page objects available', () => {
            const prompt = buildGenerationPrompt({
                decision: MOCK_DECISION,
                apiSurface: {pageObjects: [], generatedAt: new Date().toISOString()},
                specPath: 'specs/functional/ai-assisted/test.spec.ts',
                mode: 'create_spec',
            });
            assert.ok(prompt.includes('getByRole') || prompt.includes('getByTestId') || prompt.includes('raw Playwright'));
        });
    });

    describe('parseGenerationResponse', () => {
        it('should parse valid TypeScript code', () => {
            const code = `import {expect, test} from '@mattermost/playwright-lib';

test('schedules a message', {tag: '@scheduled_posts'}, async ({pw}) => {
    const {user} = await pw.initSetup();
    const {channelsPage} = await pw.testBrowser.login(user);
    await channelsPage.goto();
});`;
            const result = parseGenerationResponse(code, 'specs/test.spec.ts', 'create_spec', 'flow_1');
            assert.ok(result);
            assert.equal(result.specPath, 'specs/test.spec.ts');
            assert.equal(result.mode, 'create_spec');
            assert.equal(result.flowId, 'flow_1');
            assert.ok(result.code.includes('test('));
        });

        it('should strip markdown fences', () => {
            const code = `\`\`\`typescript
import {test} from '@mattermost/playwright-lib';

test('my test', async ({pw}) => {});
\`\`\``;
            const result = parseGenerationResponse(code, 'specs/test.spec.ts', 'create_spec', 'flow_1');
            assert.ok(result);
            assert.ok(!result.code.includes('```'));
        });

        it('should return null for code without test()', () => {
            const result = parseGenerationResponse('const x = 1;', 'specs/test.spec.ts', 'create_spec', 'flow_1');
            assert.equal(result, null);
        });

        it('should prepend import if missing', () => {
            const codeWithoutImport = "test('my test', {tag: '@channels'}, async ({pw}) => {});";
            const result = parseGenerationResponse(codeWithoutImport, 'specs/test.spec.ts', 'create_spec', 'flow_1');
            assert.ok(result);
            assert.ok(result.code.includes('@mattermost/playwright-lib'));
        });
    });

    describe('detectHallucinatedMethods', () => {
        it('should return empty for code using known methods', () => {
            const code = `
const {channelsPage} = await pw.testBrowser.login(user);
await channelsPage.goto();
await channelsPage.toBeVisible();
await channelsPage.scheduleMessage(msg, 1);
`;
            const suspected = detectHallucinatedMethods(code, MOCK_API_SURFACE);
            assert.equal(suspected.length, 0);
        });

        it('should flag unknown method calls', () => {
            const code = `
const {channelsPage} = await pw.testBrowser.login(user);
await channelsPage.openScheduleDialog();
await channelsPage.pickDateFromCalendar('tomorrow');
`;
            const suspected = detectHallucinatedMethods(code, MOCK_API_SURFACE);
            assert.ok(suspected.includes('openScheduleDialog') || suspected.includes('pickDateFromCalendar'));
        });

        it('should not flag built-in Playwright methods', () => {
            const code = `
await page.getByRole('button').click();
await page.fill('#input', 'value');
await expect(element).toBeVisible();
`;
            const suspected = detectHallucinatedMethods(code, MOCK_API_SURFACE);
            assert.equal(suspected.length, 0);
        });
    });
});

// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {FlowImpact} from './types.js';
import type {ApiSurfaceCatalog, NativeSpecQualityIssue, NativeSpecStrategy} from './pipeline_types.js';
import {collectMatches, escapeRegExp, parseInitSetupBindings} from './api_catalog.js';
import {firstFlowFiles} from './pipeline_utils.js';

export function validateGeneratedSpecContent(content: string, apiSurface?: ApiSurfaceCatalog): NativeSpecQualityIssue[] {
    const issues: NativeSpecQualityIssue[] = [];
    if (/\btest\.describe\s*\(/.test(content)) {
        issues.push({
            code: 'disallowed-describe',
            message: 'Generated tests must not use test.describe.',
        });
    }
    if (/\btest\.only\s*\(/.test(content)) {
        issues.push({
            code: 'disallowed-only',
            message: 'Generated tests must not use test.only.',
        });
    }
    if (!/\btest\s*\(/.test(content)) {
        issues.push({
            code: 'missing-test',
            message: 'Generated file does not include a test() declaration.',
        });
    }
    if (/\btag\s*:\s*\[/.test(content)) {
        issues.push({
            code: 'tag-array-disallowed',
            message: 'Generated tests must use a single tag string, not a tag array.',
        });
    }
    const hasTagOption = /\btag\s*:\s*['"][^'"]+['"]/.test(content);
    const hasTagInTitle = /\btest(?:\.\w+)?\s*\(\s*['"][^'"]*@ai-assisted[^'"]*['"]/.test(content);
    if (!(hasTagOption || hasTagInTitle) || !/@ai-assisted/.test(content)) {
        issues.push({
            code: 'missing-tag',
            message: "Generated tests must include '@ai-assisted' either as tag option or in test title.",
        });
    }
    if (/\bsystemConsolePage\.toBeVisible\s*\(/.test(content)) {
        issues.push({
            code: 'fragile-system-console-visibility',
            message: 'Avoid systemConsolePage.toBeVisible(); it relies on legacy backstage navigation that may be absent.',
        });
    }
    const fragileSelectors = [
        '.backstage-navbar',
        '.admin-console__wrapper',
        '.left-panel',
        '.panel-card',
    ].filter((selector) => content.includes(selector));
    if (fragileSelectors.length > 0) {
        issues.push({
            code: 'fragile-selector',
            message: `Avoid brittle class selectors in generated tests: ${Array.from(new Set(fragileSelectors)).join(', ')}`,
        });
    }

    if (apiSurface) {
        const unknownPwProps = Array.from(collectMatches(content, /\bpw\.([A-Za-z_][A-Za-z0-9_]*)\b/g)).filter(
            (prop) => !apiSurface.pwProps.has(prop),
        );
        const unknownBrowserMethods = Array.from(
            collectMatches(content, /\bpw\.testBrowser\.([A-Za-z_][A-Za-z0-9_]*)\b/g),
        ).filter((method) => !apiSurface.testBrowserMethods.has(method));
        const unknownNestedPwMembers: string[] = [];
        for (const match of content.matchAll(/\bpw\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
            const objectName = match[1];
            const methodName = match[2];
            if (!objectName || !methodName || objectName === 'testBrowser') {
                continue;
            }
            const knownMethods = apiSurface.pwNestedMethods.get(objectName);
            if (!knownMethods || !knownMethods.has(methodName)) {
                unknownNestedPwMembers.push(`pw.${objectName}.${methodName}`);
            }
        }
        const unknownChannelMembers = Array.from(
            collectMatches(content, /\bchannelsPage\.([A-Za-z_][A-Za-z0-9_]*)\b/g),
        ).filter((member) => !apiSurface.channelsPageMembers.has(member));
        const unknownSidebarMembers = Array.from(
            collectMatches(content, /\bchannelsPage\.sidebarRight\.([A-Za-z_][A-Za-z0-9_]*)\b/g),
        ).filter((member) => !apiSurface.sidebarRightMembers.has(member));
        const initSetupBindings = parseInitSetupBindings(content);
        const unknownInitSetupKeys = initSetupBindings
            .map((binding) => binding.key)
            .filter((key) => !apiSurface.initSetupKeys.has(key));
        const unknownInitSetupVariableMethods: string[] = [];
        for (const binding of initSetupBindings) {
            const knownMethods = apiSurface.initSetupVariableMethods.get(binding.variable);
            if (!knownMethods || knownMethods.size === 0) {
                continue;
            }
            const methodPattern = new RegExp(`\\b${escapeRegExp(binding.variable)}\\.([A-Za-z_][A-Za-z0-9_]*)\\b`, 'g');
            for (const method of collectMatches(content, methodPattern)) {
                if (!knownMethods.has(method)) {
                    unknownInitSetupVariableMethods.push(`${binding.variable}.${method}`);
                }
            }
        }
        const unknown = [
            ...unknownPwProps.map((value) => `pw.${value}`),
            ...unknownBrowserMethods.map((value) => `pw.testBrowser.${value}`),
            ...unknownNestedPwMembers,
            ...unknownChannelMembers.map((value) => `channelsPage.${value}`),
            ...unknownSidebarMembers.map((value) => `channelsPage.sidebarRight.${value}`),
            ...unknownInitSetupKeys.map((value) => `pw.initSetup.{${value}}`),
            ...unknownInitSetupVariableMethods,
        ];
        if (unknown.length > 0) {
            issues.push({
                code: 'unknown-api-surface',
                message: `Generated test uses unknown API/page-object members: ${Array.from(new Set(unknown)).join(', ')}`,
            });
        }
    }
    return issues;
}

export function createNativePlaywrightSpec(flow: FlowImpact, slug: string, strategy: NativeSpecStrategy): string {
    const linkedFiles = firstFlowFiles(flow).join(', ') || 'N/A';
    const header = [
        "import {test, expect} from '@mattermost/playwright-lib';",
        '',
        '/**',
        ` * Auto-generated by @yasserkhanorg/impact-gate`,
        ` * Flow: ${flow.id} (${flow.name})`,
        ` * Strategy: ${strategy}`,
        ` * Linked files: ${linkedFiles}`,
        ' */',
    ];

    const start = [
        `test('${flow.priority}: ${flow.name} generated coverage', {tag: '@ai-assisted'}, async ({pw}) => {`,
        '  const {user, team} = await pw.initSetup();',
        '  const {channelsPage} = await pw.testBrowser.login(user);',
        '  await channelsPage.goto(team.name);',
    ];

    const end = [
        '});',
        '',
    ];

    if (strategy === 'thread-reply') {
        return [
            ...header,
            ...start,
            `  const parentMessage = \`ai-${slug}-parent-\${Date.now()}\`;`,
            '  await channelsPage.postMessage(parentMessage);',
            '  const rootPost = await channelsPage.getLastPost();',
            '  await rootPost.openAThread();',
            `  const replyMessage = \`ai-${slug}-reply-\${Date.now()}\`;`,
            '  await channelsPage.sidebarRight.postMessage(replyMessage);',
            '  const lastReply = await channelsPage.sidebarRight.getLastPost();',
            '  await expect(lastReply.container).toContainText(replyMessage);',
            ...end,
        ].join('\n');
    }

    if (strategy === 'lifecycle-channel') {
        return [
            ...header,
            ...start,
            `  const channelName = \`ai-${slug}-\${Date.now().toString().slice(-6)}\`;`,
            "  await channelsPage.newChannel(channelName, 'O');",
            '  await expect(channelsPage.page).toHaveURL(new RegExp(`/channels/${channelName}$`));',
            ...end,
        ].join('\n');
    }

    if (strategy === 'channel-settings') {
        return [
            ...header,
            ...start,
            '  await channelsPage.openChannelSettings();',
            "  await expect(channelsPage.page.getByRole('dialog', {name: 'Channel Settings'})).toBeVisible();",
            "  await channelsPage.page.keyboard.press('Escape');",
            ...end,
        ].join('\n');
    }

    if (strategy === 'channel-switch') {
        return [
            ...header,
            ...start,
            "  await channelsPage.goto(team.name, 'off-topic');",
            "  await expect(channelsPage.page).toHaveURL(/\\/channels\\/off-topic$/);",
            "  await expect(channelsPage.page.locator('#channelHeaderTitle')).toContainText(/off-topic/i);",
            ...end,
        ].join('\n');
    }

    if (strategy === 'markdown-post') {
        return [
            ...header,
            ...start,
            `  const message = '**ai-${slug}-bold** _italic_';`,
            '  await channelsPage.postMessage(message);',
            '  const lastPost = await channelsPage.getLastPost();',
            "  await expect(lastPost.container.locator('strong')).toBeVisible();",
            ...end,
        ].join('\n');
    }

    if (strategy === 'mentions-post') {
        return [
            ...header,
            ...start,
            '  const mention = `@${user.username}`;',
            '  await channelsPage.postMessage(`Ping ${mention}`);',
            '  const lastPost = await channelsPage.getLastPost();',
            '  await expect(lastPost.container).toContainText(mention);',
            ...end,
        ].join('\n');
    }

    if (strategy === 'realtime-post') {
        return [
            ...header,
            ...start,
            `  const message = \`ai-${slug}-realtime-\${Date.now()}\`;`,
            '  await channelsPage.postMessage(message);',
            '  const lastPost = await channelsPage.getLastPost();',
            '  await expect(lastPost.container).toContainText(message);',
            "  await expect(channelsPage.page.locator('#channel_view')).toBeVisible();",
            ...end,
        ].join('\n');
    }

    if (strategy === 'message-post') {
        return [
            ...header,
            ...start,
            `  const message = \`ai-${slug}-message-\${Date.now()}\`;`,
            '  await channelsPage.postMessage(message);',
            '  await expect(channelsPage.getLastPost()).toContainText(message);',
            ...end,
        ].join('\n');
    }

    if (strategy === 'channel-baseline') {
        return [
            ...header,
            ...start,
            "  await expect(channelsPage.page.locator('#channelHeaderTitle')).toBeVisible();",
            "  await expect(channelsPage.page.locator('#SidebarContainer')).toBeVisible();",
            ...end,
        ].join('\n');
    }

    if (strategy === 'search-baseline') {
        return [
            ...header,
            ...start,
            `  const searchTerm = \`ai-${slug}-\${Date.now().toString().slice(-6)}\`;`,
            '  await channelsPage.postMessage(searchTerm);',
            '  await channelsPage.globalHeader.openSearch();',
            '  await channelsPage.searchBox.searchInput.fill(searchTerm);',
            "  await channelsPage.page.keyboard.press('Enter');",
            "  await expect(channelsPage.page.locator('#searchContainer')).toBeVisible();",
            ...end,
        ].join('\n');
    }

    return [
        ...header,
        ...start,
        '  await expect(channelsPage.page).toHaveURL(/\\/channels\\//);',
        "  await expect(channelsPage.page.locator('#channelHeaderTitle')).toBeVisible();",
        ...end,
    ].join('\n');
}

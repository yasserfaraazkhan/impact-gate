// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'fs';
import {basename, dirname, join, relative, resolve} from 'path';
import {spawnSync} from 'child_process';
import type {PipelineConfig} from './config.js';
import type {FlowImpact} from './analysis.js';
import {baseNameWithoutExt, isPathWithinRoot, normalizePath, titleCase, tokenize, uniqueTokens} from './utils.js';

export interface PipelineResult {
    flowId: string;
    flowName: string;
    generatedDir: string;
    generateStatus: 'success' | 'skipped' | 'failed';
    healStatus?: 'success' | 'skipped' | 'failed';
    error?: string;
    failureCategory?: 'config' | 'environment' | 'generation' | 'validation' | 'runtime' | 'quality' | 'path-safety' | 'unknown';
    failureCode?: string;
}

export interface PipelineSummary {
    runner: 'playwright-agents' | 'e2e-test-gen' | 'package-native' | 'unknown';
    results: PipelineResult[];
    warnings: string[];
    mcp?: {
        requested: boolean;
        active: boolean;
        backend: 'playwright-agents' | 'e2e-test-gen' | 'package-native' | 'unknown';
    };
}

export interface SpecHealTarget {
    specPath: string;
    status?: 'failed' | 'flaky';
    reason?: string;
}

type NativeSpecStrategy =
    | 'thread-reply'
    | 'lifecycle-channel'
    | 'channel-settings'
    | 'channel-switch'
    | 'markdown-post'
    | 'mentions-post'
    | 'realtime-post'
    | 'message-post'
    | 'channel-baseline'
    | 'search-baseline'
    | 'generic-baseline';

interface NativeSpecQualityIssue {
    code:
        | 'disallowed-describe'
        | 'disallowed-only'
        | 'missing-test'
        | 'missing-tag'
        | 'tag-array-disallowed'
        | 'unknown-api-surface';
    message: string;
}

interface CommandResult {
    status: number;
    stdout: string;
    stderr: string;
    error?: string;
}

interface ValidationResult {
    status: 'passed' | 'failed' | 'skipped';
    detail?: string;
}

interface ApiSurfaceCatalog {
    pwProps: Set<string>;
    pwNestedMethods: Map<string, Set<string>>;
    initSetupKeys: Set<string>;
    initSetupVariableMethods: Map<string, Set<string>>;
    testBrowserMethods: Set<string>;
    channelsPageMembers: Set<string>;
    sidebarRightMembers: Set<string>;
}

function createMcpStatus(
    backend: 'playwright-agents' | 'e2e-test-gen' | 'package-native' | 'unknown',
    requested: boolean,
): NonNullable<PipelineSummary['mcp']> {
    return {
        requested,
        active: requested && (backend === 'e2e-test-gen' || backend === 'playwright-agents'),
        backend,
    };
}

function classifyPipelineFailure(result: PipelineResult): PipelineResult {
    if (result.failureCategory || result.failureCode) {
        return result;
    }
    if (!result.error) {
        return result;
    }
    const errorText = result.error.toLowerCase();
    if (errorText.includes('outside testsroot')) {
        return {...result, failureCategory: 'path-safety', failureCode: 'path_outside_tests_root'};
    }
    if (errorText.includes('playwright binary') || errorText.includes('not found')) {
        return {...result, failureCategory: 'environment', failureCode: 'dependency_missing'};
    }
    if (errorText.includes('compile validation')) {
        return {...result, failureCategory: 'validation', failureCode: 'compile_validation_failed'};
    }
    if (errorText.includes('runtime validation') || errorText.includes('playwright test failed')) {
        return {...result, failureCategory: 'runtime', failureCode: 'runtime_validation_failed'};
    }
    if (errorText.includes('quality checks failed') || errorText.includes('invalid test content')) {
        return {...result, failureCategory: 'quality', failureCode: 'quality_guard_failed'};
    }
    if (errorText.includes('generate failed') || errorText.includes('did not produce expected test file')) {
        return {...result, failureCategory: 'generation', failureCode: 'generation_failed'};
    }
    return {...result, failureCategory: 'unknown', failureCode: 'unknown'};
}

function finalizePipelineSummary(summary: PipelineSummary): PipelineSummary {
    return {
        ...summary,
        results: summary.results.map(classifyPipelineFailure),
    };
}

function hasE2eTestGenCLI(testsRoot: string): string | null {
    const cliPath = join(testsRoot, 'e2e-test-gen-cli.ts');
    return existsSync(cliPath) ? cliPath : null;
}

function toSafeSlug(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'flow';
}

function stripSpecSuffix(value: string): string {
    return value.replace(/\.(spec|test)\.[^.]+$/i, '').replace(/\.[^.]+$/, '');
}

function buildSyntheticFlowFromSpecTarget(relativeSpecPath: string, target: SpecHealTarget): FlowImpact {
    const normalizedSpecPath = normalizePath(relativeSpecPath);
    const noSuffix = stripSpecSuffix(normalizedSpecPath);
    const flowId = toSafeSlug(noSuffix.replace(/\//g, '.'));
    const base = baseNameWithoutExt(stripSpecSuffix(basename(normalizedSpecPath)));
    const flowName = titleCase(base.replace(/[._-]+/g, ' ')) || 'Recovered Spec';
    const keywords = uniqueTokens(tokenize(noSuffix.replace(/[/.]/g, ' ')));
    const reasons = [
        `Playwright report marked this spec as ${target.status || 'unstable'}.`,
        target.reason || `Auto-heal target: ${normalizedSpecPath}`,
    ];
    return {
        id: flowId,
        name: flowName,
        kind: 'flow',
        score: target.status === 'failed' ? 12 : 9,
        priority: target.status === 'failed' ? 'P0' : 'P1',
        reasons,
        keywords,
        files: [normalizedSpecPath],
    };
}

function firstFlowFiles(flow: FlowImpact): string[] {
    return (flow.files || []).filter(Boolean).slice(0, 5);
}

function buildNativeStrategyOrder(flow: FlowImpact): NativeSpecStrategy[] {
    const flowId = (flow.id || '').toLowerCase();
    const haystack = [
        flow.id,
        flow.name,
        ...(flow.files || []),
        ...(flow.reasons || []),
        ...(flow.keywords || []),
    ].join(' ').toLowerCase();

    const strategies: NativeSpecStrategy[] = [];
    if (flowId.includes('search')) {
        strategies.push('search-baseline');
    }
    if (flowId.includes('threads') || flowId.includes('thread')) {
        strategies.push('thread-reply');
    }
    if (flowId.includes('channels.lifecycle')) {
        strategies.push('lifecycle-channel');
    }
    if (flowId.includes('channels.settings')) {
        strategies.push('channel-settings');
    }
    if (flowId.includes('channels.switch')) {
        strategies.push('channel-switch');
    }
    if (flowId.includes('messaging.markdown')) {
        strategies.push('markdown-post');
    }
    if (flowId.includes('messaging.mentions')) {
        strategies.push('mentions-post');
    }
    if (flowId.includes('messaging.realtime')) {
        strategies.push('realtime-post');
    }
    if (/(thread|reply|rhs|sidebar[_-]?right)/.test(haystack)) {
        strategies.push('thread-reply');
    }
    if (/(create|join|leave|invite)/.test(haystack)) {
        strategies.push('lifecycle-channel');
    }
    if (/(settings|preferences)/.test(haystack)) {
        strategies.push('channel-settings');
    }
    if (/(switch|quick\\s*switch)/.test(haystack)) {
        strategies.push('channel-switch');
    }
    if (/(markdown|format)/.test(haystack)) {
        strategies.push('markdown-post');
    }
    if (/(mention|@)/.test(haystack)) {
        strategies.push('mentions-post');
    }
    if (/(realtime|websocket|presence)/.test(haystack)) {
        strategies.push('realtime-post');
    }
    if (/(search|find|spotlight)/.test(haystack)) {
        strategies.push('search-baseline');
    }
    if (/(message|post|realtime|websocket|chat)/.test(haystack)) {
        strategies.push('message-post');
    }
    if (/(channel|navigation|sidebar|switch)/.test(haystack)) {
        strategies.push('channel-baseline');
    }
    strategies.push('generic-baseline');
    return Array.from(new Set(strategies));
}

function createDefaultApiSurfaceCatalog(): ApiSurfaceCatalog {
    const pwNestedMethods = new Map<string, Set<string>>();
    pwNestedMethods.set('apiClient', new Set([
        'createPost',
        'createDirectChannel',
        'createChannel',
        'getChannels',
        'getChannelByName',
        'getPostsSince',
    ]));
    return {
        pwProps: new Set([
            'initSetup',
            'testBrowser',
            'apiInitSetup',
            'apiAdminSetup',
            'apiCreateChannel',
            'apiCreateUser',
            'apiLogin',
            'apiClient',
        ]),
        pwNestedMethods,
        initSetupKeys: new Set([
            'user',
            'team',
            'adminClient',
            'adminUser',
            'adminConfig',
            'userClient',
            'offTopicUrl',
            'townSquareUrl',
        ]),
        initSetupVariableMethods: new Map<string, Set<string>>(),
        testBrowserMethods: new Set([
            'login',
            'openNewBrowserContext',
            'newContext',
        ]),
        channelsPageMembers: new Set([
            'goto',
            'page',
            'postMessage',
            'getLastPost',
            'sidebarRight',
            'openChannelSettings',
            'newChannel',
            'globalHeader',
            'searchBox',
        ]),
        sidebarRightMembers: new Set([
            'openThreadForPost',
            'postMessage',
            'getLastPost',
        ]),
    };
}

function collectMatches(content: string, pattern: RegExp): Set<string> {
    const out = new Set<string>();
    for (const match of content.matchAll(pattern)) {
        const value = match[1];
        if (value) {
            out.add(value);
        }
    }
    return out;
}

function addNestedMethod(catalog: ApiSurfaceCatalog, objectName: string, methodName: string): void {
    const methods = catalog.pwNestedMethods.get(objectName) || new Set<string>();
    methods.add(methodName);
    catalog.pwNestedMethods.set(objectName, methods);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface InitSetupBinding {
    key: string;
    variable: string;
}

function parseInitSetupBindings(content: string): InitSetupBinding[] {
    const bindings: InitSetupBinding[] = [];
    for (const match of content.matchAll(/(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*await\s+pw\.initSetup\s*\(/g)) {
        const raw = match[1];
        if (!raw) {
            continue;
        }
        for (const part of raw.split(',')) {
            const cleaned = part.trim();
            if (!cleaned) {
                continue;
            }
            const [leftRaw, rightRaw] = cleaned.split(':');
            const key = (leftRaw || '').trim();
            const variableCandidate = (rightRaw || leftRaw || '').trim().split('=')[0]?.trim();
            if (!key || !variableCandidate) {
                continue;
            }
            bindings.push({key, variable: variableCandidate});
        }
    }
    return bindings;
}

function collectDestructuredInitSetupKeys(content: string): Set<string> {
    return new Set(parseInitSetupBindings(content).map((binding) => binding.key));
}

function addInitSetupVariableMethod(
    catalog: ApiSurfaceCatalog,
    variable: string,
    methodName: string,
): void {
    const methods = catalog.initSetupVariableMethods.get(variable) || new Set<string>();
    methods.add(methodName);
    catalog.initSetupVariableMethods.set(variable, methods);
}

function collectApiSurfaceFromContent(content: string, catalog: ApiSurfaceCatalog): void {
    for (const prop of collectMatches(content, /\bpw\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        catalog.pwProps.add(prop);
    }
    for (const match of content.matchAll(/\bpw\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        const objectName = match[1];
        const methodName = match[2];
        if (!objectName || !methodName) {
            continue;
        }
        addNestedMethod(catalog, objectName, methodName);
    }
    for (const method of collectMatches(content, /\bpw\.testBrowser\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        catalog.testBrowserMethods.add(method);
    }
    for (const member of collectMatches(content, /\bchannelsPage\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        catalog.channelsPageMembers.add(member);
    }
    for (const member of collectMatches(content, /\bchannelsPage\.sidebarRight\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        catalog.sidebarRightMembers.add(member);
    }
    for (const binding of parseInitSetupBindings(content)) {
        catalog.initSetupKeys.add(binding.key);
        const methodPattern = new RegExp(`\\b${escapeRegExp(binding.variable)}\\.([A-Za-z_][A-Za-z0-9_]*)\\b`, 'g');
        for (const method of collectMatches(content, methodPattern)) {
            addInitSetupVariableMethod(catalog, binding.variable, method);
        }
    }
}

function buildApiSurfaceCatalog(testsRoot: string, seedFile: string): ApiSurfaceCatalog {
    const catalog = createDefaultApiSurfaceCatalog();
    const candidateRoots = [
        join(testsRoot, 'specs'),
        join(testsRoot, 'tests'),
    ];

    const files: string[] = [];
    for (const root of candidateRoots) {
        if (!existsSync(root)) {
            continue;
        }
        const stack = [root];
        while (stack.length > 0) {
            const current = stack.pop()!;
            let entries: import('fs').Dirent[];
            try {
                entries = readdirSync(current, {withFileTypes: true});
            } catch {
                continue;
            }
            for (const entry of entries) {
                const full = join(current, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
                        continue;
                    }
                    stack.push(full);
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }
                if (!/\.(spec|test)\.[jt]sx?$/.test(entry.name)) {
                    continue;
                }
                files.push(full);
            }
        }
    }

    const uniqueFiles = Array.from(new Set(files)).slice(0, 2500);
    for (const filePath of uniqueFiles) {
        try {
            const content = readFileSync(filePath, 'utf-8');
            collectApiSurfaceFromContent(content, catalog);
        } catch {
            continue;
        }
    }

    const absoluteSeed = join(testsRoot, seedFile);
    if (existsSync(absoluteSeed)) {
        try {
            collectApiSurfaceFromContent(readFileSync(absoluteSeed, 'utf-8'), catalog);
        } catch {
            // ignore seed read failures; defaults + catalog scan still apply
        }
    }
    return catalog;
}

function validateGeneratedSpecContent(content: string, apiSurface?: ApiSurfaceCatalog): NativeSpecQualityIssue[] {
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

function createNativePlaywrightSpec(flow: FlowImpact, slug: string, strategy: NativeSpecStrategy): string {
    const linkedFiles = firstFlowFiles(flow).join(', ') || 'N/A';
    const header = [
        "import {test, expect} from '@mattermost/playwright-lib';",
        '',
        '/**',
        ` * Auto-generated by @yasserkhanorg/e2e-agents`,
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

function resolvePlaywrightBinary(testsRoot: string): string | null {
    const unixPath = join(testsRoot, 'node_modules', '.bin', 'playwright');
    const windowsPath = join(testsRoot, 'node_modules', '.bin', 'playwright.cmd');
    if (existsSync(unixPath)) {
        return unixPath;
    }
    if (existsSync(windowsPath)) {
        return windowsPath;
    }
    return null;
}

function summarizeCommandOutput(stdout: string, stderr: string): string {
    const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
    if (!combined) {
        return '';
    }
    const lines = combined.split('\n').slice(-20);
    return lines.join('\n').slice(0, 2000);
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs = 60 * 60 * 1000): CommandResult {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf-8',
        timeout: timeoutMs,
        stdio: 'pipe',
    });
    return {
        status: result.status ?? 1,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        error: result.error ? result.error.message : undefined,
    };
}

function runPlaywrightRuntimeValidation(
    testsRoot: string,
    testFile: string,
    pipeline: PipelineConfig,
    playwrightBinary: string | null,
): ValidationResult {
    if (!playwrightBinary) {
        return {
            status: 'failed',
            detail: 'Playwright binary not found; cannot execute runtime validation.',
        };
    }
    const relativeSpecPath = normalizePath(relative(testsRoot, testFile));
    if (relativeSpecPath.startsWith('../') || relativeSpecPath.startsWith('..\\')) {
        return {
            status: 'failed',
            detail: 'Generated spec path resolved outside testsRoot during runtime validation.',
        };
    }

    const args = ['test', relativeSpecPath, '--workers', '1', '--retries', '0', '--max-failures', '1', '--reporter', 'line'];
    if (pipeline.headless === false) {
        args.push('--headed');
    }
    if (pipeline.project) {
        args.push('--project', pipeline.project);
    }
    const commandResult = runCommand(playwrightBinary, args, testsRoot, 10 * 60 * 1000);
    if (commandResult.status === 0) {
        return {status: 'passed'};
    }
    const summary = summarizeCommandOutput(commandResult.stdout, commandResult.stderr);
    return {
        status: 'failed',
        detail: summary || commandResult.error || `playwright test failed with status ${commandResult.status}`,
    };
}

function runPlaywrightListValidation(
    testsRoot: string,
    testFile: string,
    pipeline: PipelineConfig,
    playwrightBinary: string | null,
): ValidationResult {
    if (!playwrightBinary) {
        return {
            status: 'skipped',
            detail: 'Playwright binary not found under testsRoot/node_modules/.bin; runtime compile validation skipped.',
        };
    }
    const relativeSpecPath = normalizePath(relative(testsRoot, testFile));
    if (relativeSpecPath.startsWith('../') || relativeSpecPath.startsWith('..\\')) {
        return {
            status: 'failed',
            detail: 'Generated spec path resolved outside testsRoot during validation.',
        };
    }

    const args = ['test', '--list', relativeSpecPath];
    if (pipeline.headless === false) {
        args.push('--headed');
    }
    if (pipeline.project) {
        args.push('--project', pipeline.project);
    }
    const commandResult = runCommand(playwrightBinary, args, testsRoot);
    if (commandResult.error && /ENOENT/.test(commandResult.error)) {
        return {
            status: 'skipped',
            detail: 'Playwright binary was not executable; runtime compile validation skipped.',
        };
    }
    if (commandResult.status === 0) {
        return {status: 'passed'};
    }
    const summary = summarizeCommandOutput(commandResult.stdout, commandResult.stderr);
    return {
        status: 'failed',
        detail: summary || commandResult.error || `playwright --list failed with status ${commandResult.status}`,
    };
}

function runPackageNativeFlow(
    testsRoot: string,
    flow: FlowImpact,
    pipeline: PipelineConfig,
    outputDir: string,
    testFile: string,
    playwrightBinary: string | null,
    apiSurface: ApiSurfaceCatalog,
): PipelineResult {
    const flowId = flow.id;
    const flowName = flow.name;
    const existingFile = existsSync(testFile);
    const originalContent = existingFile ? readFileSync(testFile, 'utf-8') : null;

    if (existingFile && !pipeline.heal) {
        return {
            flowId,
            flowName,
            generatedDir: outputDir,
            generateStatus: 'skipped',
        };
    }

    const slug = toSafeSlug(flow.id);
    const strategies = buildNativeStrategyOrder(flow);
    const attempts: string[] = [];
    const candidates: Array<{label: string; strategy?: NativeSpecStrategy; content: string; write: boolean}> = [];

    if (pipeline.heal && originalContent !== null) {
        candidates.push({
            label: 'existing',
            content: originalContent,
            write: false,
        });
    }
    for (const strategy of strategies) {
        candidates.push({
            label: strategy,
            strategy,
            content: createNativePlaywrightSpec(flow, slug, strategy),
            write: true,
        });
    }

    mkdirSync(outputDir, {recursive: true});
    let wroteNewFile = false;

    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        if (candidate.write) {
            writeFileSync(testFile, candidate.content, 'utf-8');
            wroteNewFile = true;
        }
        const currentContent = candidate.write ? candidate.content : (originalContent || '');
        const qualityIssues = validateGeneratedSpecContent(currentContent, apiSurface);
        if (qualityIssues.length > 0) {
            attempts.push(`${candidate.label}: ${qualityIssues.map((issue) => issue.message).join(' ')}`);
            if (pipeline.heal && i < candidates.length - 1) {
                continue;
            }
            if (originalContent !== null) {
                writeFileSync(testFile, originalContent, 'utf-8');
            } else if (wroteNewFile && existsSync(testFile)) {
                rmSync(testFile, {force: true});
            }
            return {
                flowId,
                flowName,
                generatedDir: outputDir,
                generateStatus: 'failed',
                healStatus: pipeline.heal ? 'failed' : undefined,
                error: `Quality checks failed. Attempts: ${attempts.join(' | ')}`,
            };
        }

        if (pipeline.heal) {
            const validation = runPlaywrightListValidation(testsRoot, testFile, pipeline, playwrightBinary);
            if (validation.status === 'failed') {
                attempts.push(`${candidate.label}: ${validation.detail || 'playwright validation failed'}`);
                if (i < candidates.length - 1) {
                    continue;
                }
                if (originalContent !== null) {
                    writeFileSync(testFile, originalContent, 'utf-8');
                } else if (wroteNewFile && existsSync(testFile)) {
                    rmSync(testFile, {force: true});
                }
                return {
                    flowId,
                    flowName,
                    generatedDir: outputDir,
                    generateStatus: 'failed',
                    healStatus: 'failed',
                    error: `Heal validation failed. Attempts: ${attempts.join(' | ')}`,
                };
            }
        }

        return {
            flowId,
            flowName,
            generatedDir: outputDir,
            generateStatus: candidate.write ? 'success' : 'skipped',
            healStatus: pipeline.heal ? 'success' : undefined,
        };
    }

    if (originalContent !== null) {
        writeFileSync(testFile, originalContent, 'utf-8');
    } else if (wroteNewFile && existsSync(testFile)) {
        rmSync(testFile, {force: true});
    }
    return {
        flowId,
        flowName,
        generatedDir: outputDir,
        generateStatus: 'failed',
        healStatus: pipeline.heal ? 'failed' : undefined,
        error: attempts.length > 0 ? attempts.join(' | ') : 'No generation candidates were available.',
    };
}

function runPackageNativePipeline(
    testsRoot: string,
    flows: FlowImpact[],
    pipeline: PipelineConfig,
    baseWarnings: string[] = [],
): PipelineSummary {
    const warningSet = new Set(baseWarnings);
    const mcp = createMcpStatus('package-native', Boolean(pipeline.mcp));

    const playwrightBinary = pipeline.heal ? resolvePlaywrightBinary(testsRoot) : null;
    const seedFile = resolveAgentSeedSpec(testsRoot) || 'specs/seed.spec.ts';
    const apiSurface = buildApiSurfaceCatalog(testsRoot, seedFile);
    if (pipeline.heal && !playwrightBinary) {
        warningSet.add('Playwright binary was not found. Heal uses static quality checks without runtime compile validation.');
    }

    const results: PipelineResult[] = [];
    const outputBase = resolve(testsRoot, pipeline.outputDir || 'specs/functional/ai-assisted');
    if (!isPathWithinRoot(testsRoot, outputBase)) {
        warningSet.add(`Pipeline outputDir resolves outside testsRoot and was blocked: ${pipeline.outputDir}`);
        return {runner: 'unknown', results, warnings: Array.from(warningSet), mcp: createMcpStatus('unknown', Boolean(pipeline.mcp))};
    }

    for (const flow of flows) {
        if (flow.priority !== 'P0' && flow.priority !== 'P1') {
            continue;
        }

        const slug = toSafeSlug(flow.id);
        const outputDir = normalizePath(join(outputBase, slug));
        if (!isPathWithinRoot(testsRoot, outputDir)) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                error: 'output directory resolves outside testsRoot',
            });
            continue;
        }

        if (pipeline.dryRun) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'skipped',
                healStatus: pipeline.heal ? 'skipped' : undefined,
            });
            continue;
        }

        const testFile = normalizePath(join(outputDir, `${slug}.spec.ts`));
        if (!isPathWithinRoot(testsRoot, testFile)) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                error: 'generated test path resolves outside testsRoot',
            });
            continue;
        }

        results.push(runPackageNativeFlow(testsRoot, flow, pipeline, outputDir, testFile, playwrightBinary, apiSurface));
    }

    return {runner: 'package-native', results, warnings: Array.from(warningSet), mcp};
}

export function runTargetedSpecHeal(
    testsRoot: string,
    targets: SpecHealTarget[],
    pipeline: PipelineConfig,
): PipelineSummary {
    const warnings = new Set<string>();
    const results: PipelineResult[] = [];
    const mcp = createMcpStatus('package-native', Boolean(pipeline.mcp));
    if (targets.length === 0) {
        warnings.add('No targeted specs provided for heal.');
        return finalizePipelineSummary({
            runner: 'package-native',
            results,
            warnings: Array.from(warnings),
            mcp,
        });
    }

    const playwrightBinary = pipeline.heal ? resolvePlaywrightBinary(testsRoot) : null;
    const seedFile = resolveAgentSeedSpec(testsRoot) || 'specs/seed.spec.ts';
    const apiSurface = buildApiSurfaceCatalog(testsRoot, seedFile);
    if (pipeline.heal && !playwrightBinary) {
        warnings.add('Playwright binary was not found. Targeted heal uses static quality checks without runtime compile validation.');
    }

    for (const target of targets) {
        const inputPath = target.specPath || '';
        const absoluteSpecPath = normalizePath(resolve(testsRoot, inputPath));
        if (!isPathWithinRoot(testsRoot, absoluteSpecPath)) {
            results.push({
                flowId: inputPath || 'unknown',
                flowName: inputPath || 'Unknown Spec',
                generatedDir: normalizePath(dirname(absoluteSpecPath)),
                generateStatus: 'failed',
                healStatus: pipeline.heal ? 'failed' : undefined,
                error: `Targeted spec resolves outside testsRoot: ${inputPath}`,
            });
            continue;
        }

        if (!existsSync(absoluteSpecPath)) {
            results.push({
                flowId: inputPath || 'unknown',
                flowName: inputPath || 'Unknown Spec',
                generatedDir: normalizePath(dirname(absoluteSpecPath)),
                generateStatus: 'failed',
                healStatus: pipeline.heal ? 'failed' : undefined,
                error: `Targeted spec does not exist: ${inputPath}`,
            });
            continue;
        }

        const relativeSpecPath = normalizePath(relative(testsRoot, absoluteSpecPath));
        if (!/\.(spec|test)\.[tj]sx?$/.test(relativeSpecPath)) {
            warnings.add(`Skipping non-spec target path: ${relativeSpecPath}`);
            results.push({
                flowId: relativeSpecPath,
                flowName: relativeSpecPath,
                generatedDir: normalizePath(dirname(absoluteSpecPath)),
                generateStatus: 'skipped',
                healStatus: pipeline.heal ? 'skipped' : undefined,
            });
            continue;
        }

        if (pipeline.dryRun) {
            results.push({
                flowId: relativeSpecPath,
                flowName: relativeSpecPath,
                generatedDir: normalizePath(dirname(absoluteSpecPath)),
                generateStatus: 'skipped',
                healStatus: pipeline.heal ? 'skipped' : undefined,
            });
            continue;
        }

        const syntheticFlow = buildSyntheticFlowFromSpecTarget(relativeSpecPath, target);
        results.push(
            runPackageNativeFlow(
                testsRoot,
                syntheticFlow,
                pipeline,
                normalizePath(dirname(absoluteSpecPath)),
                absoluteSpecPath,
                playwrightBinary,
                apiSurface,
            ),
        );
    }

    return finalizePipelineSummary({
        runner: 'package-native',
        results,
        warnings: Array.from(warnings),
        mcp,
    });
}

function findSpecFiles(root: string): string[] {
    if (!existsSync(root)) {
        return [];
    }
    const entries = readdirSync(root, {withFileTypes: true});
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...findSpecFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
            files.push(fullPath);
        }
    }
    return files;
}

function findDisallowedDescribeFiles(root: string): string[] {
    const files = findSpecFiles(root);
    return files.filter((file) => /\btest\.describe\s*\(/.test(readFileSync(file, 'utf-8')));
}

function hasCommand(command: string, cwd: string): boolean {
    const result = runCommand(command, ['--version'], cwd);
    return result.status === 0;
}

function hasPlaywrightAgentDefinitions(testsRoot: string): boolean {
    const required = [
        '.mcp.json',
        '.claude/agents/playwright-test-planner.md',
        '.claude/agents/playwright-test-generator.md',
        '.claude/agents/playwright-test-healer.md',
    ];
    return required.every((path) => existsSync(join(testsRoot, path)));
}

function hasPlaywrightConfig(testsRoot: string): boolean {
    const candidates = [
        'playwright.config.ts',
        'playwright.config.js',
        'playwright.config.mts',
        'playwright.config.mjs',
        'playwright.config.cts',
        'playwright.config.cjs',
    ];
    return candidates.some((candidate) => existsSync(join(testsRoot, candidate)));
}

function bootstrapPlaywrightAgentDefinitions(testsRoot: string, pipeline: PipelineConfig): CommandResult {
    const args = ['playwright', 'init-agents', '--loop=claude', '--prompts'];
    if (pipeline.project) {
        args.push('--project', pipeline.project);
    }
    return runCommand('npx', args, testsRoot);
}

function resolveAgentSeedSpec(testsRoot: string): string | null {
    const preferred = join(testsRoot, 'specs', 'seed.spec.ts');
    const specsRoot = join(testsRoot, 'specs');
    const specFiles = findSpecFiles(specsRoot).filter((file) => !normalizePath(file).includes('/functional/ai-assisted/'));
    const scored = specFiles
        .map((file) => {
            const rel = normalizePath(relative(testsRoot, file));
            const content = readFileSync(file, 'utf-8');
            let score = 0;
            if (rel.endsWith('/seed.spec.ts')) {
                // Generated default seed from init-agents is often a placeholder; prefer real tests.
                if (!/generate code here/i.test(content)) {
                    score += 2;
                }
            }
            if (content.includes('@mattermost/playwright-lib')) {
                score += 8;
            }
            if (content.includes('pw.initSetup(')) {
                score += 6;
            }
            if (content.includes('testBrowser.login(')) {
                score += 4;
            }
            if (content.includes('channelsPage')) {
                score += 2;
            }
            if (rel.includes('/functional/channels/')) {
                score += 1;
            }
            return {rel, score};
        })
        .sort((a, b) => b.score - a.score);

    if (scored.length > 0 && scored[0].score > 0) {
        return scored[0].rel;
    }

    if (existsSync(preferred)) {
        return normalizePath(relative(testsRoot, preferred));
    }

    return null;
}

function buildPlaywrightAgentsPrompt(
    flow: FlowImpact,
    seedFile: string,
    planFile: string,
    testFile: string,
    includeHealer: boolean,
): string {
    const linkedFiles = firstFlowFiles(flow).join(', ') || 'N/A';
    const reasons = (flow.reasons || []).slice(0, 5).join(' | ') || 'N/A';
    return [
        'Use official Playwright Test agents (planner, generator, healer) to implement exactly one high-quality test for this flow.',
        '',
        `Flow ID: ${flow.id}`,
        `Flow Name: ${flow.name}`,
        `Priority: ${flow.priority}`,
        `Linked files: ${linkedFiles}`,
        `Risk reasons: ${reasons}`,
        '',
        'Workflow requirements:',
        '1) Use #playwright-test-planner to explore and save a focused test plan.',
        '2) Use #playwright-test-generator to generate one test from that plan.',
        includeHealer
            ? '3) Use #playwright-test-healer to run and fix that generated test.'
            : '3) Skip runtime healing and focus on producing compile-ready test code.',
        '',
        `Seed file: ${seedFile}`,
        `Plan file to save: ${planFile}`,
        `Generated test file path (must be exact): ${testFile}`,
        '',
        'Quality constraints (must follow):',
        '- The generated file must contain a standalone test() and must not use test.describe or test.only.',
        '- Do not mark the test with test.fixme unless user explicitly requests skipping.',
        "- The generated test must include a single tag string '@ai-assisted'.",
        '- Match fixture/import style from the seed file. Prefer existing page-object APIs over raw brittle selectors.',
        '- Only use `pw` and page-object methods that already exist in the seed/current specs (for example, do not invent APIs like `pw.mainClient.*`).',
        '- Keep the scenario strictly aligned to the flow and linked files, not broad unrelated flows.',
        '',
        'At the end, return a short summary that includes the generated test file path and whether healing succeeded.',
    ].join('\n');
}

function buildPlaywrightHealerPrompt(testFile: string, extra?: string): string {
    const lines = [
        'Heal this specific Playwright test file and keep edits minimal.',
        `Target test file: ${testFile}`,
        'Constraints:',
        '- Do not use test.describe or test.only.',
        "- Keep a single tag string '@ai-assisted'.",
        '- Use only existing Mattermost Playwright fixture/page-object APIs; do not invent new `pw.*` clients or methods.',
        '- Keep the test intent unchanged and focused.',
        '',
        'Run and fix this test until it compiles/passes, or mark test.fixme with a clear comment when behavior is truly broken.',
    ];
    if (extra) {
        lines.push('', `Context: ${extra}`);
    }
    return lines.join('\n');
}

function runPlaywrightAgentsFlow(
    testsRoot: string,
    flow: FlowImpact,
    pipeline: PipelineConfig,
    outputDir: string,
    preferredTestFile: string,
    seedFile: string,
    apiSurface: ApiSurfaceCatalog,
    playwrightBinary: string | null,
): PipelineResult {
    mkdirSync(outputDir, {recursive: true});
    const slug = toSafeSlug(flow.id);
    const planFile = normalizePath(relative(testsRoot, join(outputDir, `${slug}.plan.md`)));
    const targetTestFile = normalizePath(relative(testsRoot, preferredTestFile));

    if (pipeline.dryRun) {
        return {
            flowId: flow.id,
            flowName: flow.name,
            generatedDir: outputDir,
            generateStatus: 'skipped',
            healStatus: pipeline.heal ? 'skipped' : undefined,
        };
    }

    const prompt = buildPlaywrightAgentsPrompt(flow, seedFile, planFile, targetTestFile, Boolean(pipeline.heal));
    const runArgs = [
        '-p',
        '--permission-mode',
        'bypassPermissions',
        '--mcp-config',
        '.mcp.json',
        '--add-dir',
        testsRoot,
        '--',
        prompt,
    ];
    const runResult = runCommand('claude', runArgs, testsRoot);
    if (runResult.status !== 0) {
        return {
            flowId: flow.id,
            flowName: flow.name,
            generatedDir: outputDir,
            generateStatus: 'failed',
            healStatus: pipeline.heal ? 'failed' : undefined,
            error: summarizeCommandOutput(runResult.stdout, runResult.stderr) || runResult.error || 'Playwright agents run failed',
        };
    }

    let actualTestFile = preferredTestFile;
    if (!existsSync(actualTestFile)) {
        const candidates = findSpecFiles(outputDir);
        if (candidates.length === 1) {
            actualTestFile = candidates[0];
        }
    }
    if (!existsSync(actualTestFile)) {
        return {
            flowId: flow.id,
            flowName: flow.name,
            generatedDir: outputDir,
            generateStatus: 'failed',
            healStatus: pipeline.heal ? 'failed' : undefined,
            error: `Playwright agents did not produce expected test file: ${targetTestFile}`,
        };
    }

    const relativeActualTestFile = normalizePath(relative(testsRoot, actualTestFile));
    let qualityIssues = validateGeneratedSpecContent(readFileSync(actualTestFile, 'utf-8'), apiSurface);
    if (qualityIssues.length > 0 && pipeline.heal) {
        const healResult = runCommand(
            'claude',
            [
                '-p',
                '--permission-mode',
                'bypassPermissions',
                '--agent',
                'playwright-test-healer',
                '--mcp-config',
                '.mcp.json',
                '--add-dir',
                testsRoot,
                '--',
                buildPlaywrightHealerPrompt(relativeActualTestFile, qualityIssues.map((issue) => issue.message).join(' | ')),
            ],
            testsRoot,
        );
        if (healResult.status === 0 && existsSync(actualTestFile)) {
            qualityIssues = validateGeneratedSpecContent(readFileSync(actualTestFile, 'utf-8'), apiSurface);
        }
    }
    if (qualityIssues.length > 0) {
        return {
            flowId: flow.id,
            flowName: flow.name,
            generatedDir: outputDir,
            generateStatus: 'failed',
            healStatus: pipeline.heal ? 'failed' : undefined,
            error: `Playwright agents produced invalid test content: ${qualityIssues.map((issue) => issue.message).join(' | ')}`,
        };
    }

    if (pipeline.heal) {
        let compileValidation = runPlaywrightListValidation(testsRoot, actualTestFile, pipeline, playwrightBinary);
        if (compileValidation.status === 'failed') {
            const healResult = runCommand(
                'claude',
                [
                    '-p',
                    '--permission-mode',
                    'bypassPermissions',
                    '--agent',
                    'playwright-test-healer',
                    '--mcp-config',
                    '.mcp.json',
                    '--add-dir',
                    testsRoot,
                    '--',
                    buildPlaywrightHealerPrompt(relativeActualTestFile, compileValidation.detail || 'playwright --list failed'),
                ],
                testsRoot,
            );
            if (healResult.status === 0 && existsSync(actualTestFile)) {
                compileValidation = runPlaywrightListValidation(testsRoot, actualTestFile, pipeline, playwrightBinary);
            }
            if (compileValidation.status === 'failed') {
                return {
                    flowId: flow.id,
                    flowName: flow.name,
                    generatedDir: outputDir,
                    generateStatus: 'failed',
                    healStatus: 'failed',
                    error: `Playwright agents compile validation failed: ${compileValidation.detail || 'playwright --list failed'}`,
                };
            }
        }

        let runtimeValidation = runPlaywrightRuntimeValidation(testsRoot, actualTestFile, pipeline, playwrightBinary);
        if (runtimeValidation.status === 'failed') {
            const healResult = runCommand(
                'claude',
                [
                    '-p',
                    '--permission-mode',
                    'bypassPermissions',
                    '--agent',
                    'playwright-test-healer',
                    '--mcp-config',
                    '.mcp.json',
                    '--add-dir',
                    testsRoot,
                    '--',
                    buildPlaywrightHealerPrompt(relativeActualTestFile, runtimeValidation.detail || 'playwright runtime failed'),
                ],
                testsRoot,
            );
            if (healResult.status === 0 && existsSync(actualTestFile)) {
                runtimeValidation = runPlaywrightRuntimeValidation(testsRoot, actualTestFile, pipeline, playwrightBinary);
            }
            if (runtimeValidation.status === 'failed') {
                return {
                    flowId: flow.id,
                    flowName: flow.name,
                    generatedDir: outputDir,
                    generateStatus: 'failed',
                    healStatus: 'failed',
                    error: `Playwright agents runtime validation failed: ${runtimeValidation.detail || 'playwright test failed'}`,
                };
            }
        }
    }

    return {
        flowId: flow.id,
        flowName: flow.name,
        generatedDir: outputDir,
        generateStatus: 'success',
        healStatus: pipeline.heal ? 'success' : undefined,
    };
}

function runPlaywrightAgentsPipeline(
    testsRoot: string,
    flows: FlowImpact[],
    pipeline: PipelineConfig,
): PipelineSummary {
    const warnings: string[] = [];
    const results: PipelineResult[] = [];

    if (!hasCommand('claude', testsRoot)) {
        warnings.push('Claude CLI is required for official Playwright planner/generator/healer execution but was not found.');
        return {runner: 'unknown', results, warnings, mcp: createMcpStatus('unknown', true)};
    }

    if (!hasPlaywrightConfig(testsRoot)) {
        warnings.push('Playwright config file not found in testsRoot; skipping official Playwright agents backend.');
        return {runner: 'unknown', results, warnings, mcp: createMcpStatus('unknown', true)};
    }

    if (!hasPlaywrightAgentDefinitions(testsRoot)) {
        const bootstrap = bootstrapPlaywrightAgentDefinitions(testsRoot, pipeline);
        if (bootstrap.status !== 0) {
            warnings.push(
                summarizeCommandOutput(bootstrap.stdout, bootstrap.stderr) ||
                bootstrap.error ||
                'Failed to initialize Playwright agents via `npx playwright init-agents`.',
            );
            return {runner: 'unknown', results, warnings, mcp: createMcpStatus('unknown', true)};
        }
    }

    if (!hasPlaywrightAgentDefinitions(testsRoot)) {
        warnings.push('Playwright agent definitions are missing after bootstrap.');
        return {runner: 'unknown', results, warnings, mcp: createMcpStatus('unknown', true)};
    }

    const seedFile = resolveAgentSeedSpec(testsRoot);
    if (!seedFile) {
        warnings.push('No seed spec file found under specs/. Playwright planner cannot be initialized.');
        return {runner: 'unknown', results, warnings, mcp: createMcpStatus('unknown', true)};
    }

    const playwrightBinary = pipeline.heal ? resolvePlaywrightBinary(testsRoot) : null;
    const apiSurface = buildApiSurfaceCatalog(testsRoot, seedFile);
    if (pipeline.heal && !playwrightBinary) {
        warnings.push('Playwright binary was not found. Healer runtime validation may be limited.');
    }

    const outputBase = resolve(testsRoot, pipeline.outputDir || 'specs/functional/ai-assisted');
    if (!isPathWithinRoot(testsRoot, outputBase)) {
        warnings.push(`Pipeline outputDir resolves outside testsRoot and was blocked: ${pipeline.outputDir}`);
        return {runner: 'unknown', results, warnings, mcp: createMcpStatus('unknown', true)};
    }

    for (const flow of flows) {
        if (flow.priority !== 'P0' && flow.priority !== 'P1') {
            continue;
        }

        const slug = toSafeSlug(flow.id);
        const outputDir = normalizePath(join(outputBase, slug));
        if (!isPathWithinRoot(testsRoot, outputDir)) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                error: 'output directory resolves outside testsRoot',
            });
            continue;
        }

        const testFile = normalizePath(join(outputDir, `${slug}.spec.ts`));
        if (!isPathWithinRoot(testsRoot, testFile)) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                error: 'generated test path resolves outside testsRoot',
            });
            continue;
        }

        results.push(
            runPlaywrightAgentsFlow(
                testsRoot,
                flow,
                pipeline,
                outputDir,
                testFile,
                seedFile,
                apiSurface,
                playwrightBinary,
            ),
        );
    }

    return {runner: 'playwright-agents', results, warnings, mcp: createMcpStatus('playwright-agents', true)};
}

export function runPlaywrightPipeline(
    testsRoot: string,
    flows: FlowImpact[],
    pipeline: PipelineConfig,
): PipelineSummary {
    const mcpFallbackWarnings: string[] = [];
    if (pipeline.mcp) {
        const agentsSummary = runPlaywrightAgentsPipeline(testsRoot, flows, pipeline);
        if (agentsSummary.runner !== 'unknown' || agentsSummary.results.length > 0) {
            return finalizePipelineSummary(agentsSummary);
        }
        if (!pipeline.mcpAllowFallback) {
            const warnings = [
                ...agentsSummary.warnings,
                'Official Playwright MCP mode is strict; fallback generation is disabled unless pipeline.mcpAllowFallback=true.',
            ];
            return finalizePipelineSummary({
                runner: 'unknown',
                results: agentsSummary.results,
                warnings,
                mcp: createMcpStatus('unknown', true),
            });
        }
        mcpFallbackWarnings.push(...agentsSummary.warnings);
    }

    const cliPath = hasE2eTestGenCLI(testsRoot);
    if (!cliPath) {
        return finalizePipelineSummary(runPackageNativePipeline(testsRoot, flows, pipeline, mcpFallbackWarnings));
    }

    const warnings: string[] = [...mcpFallbackWarnings];
    const results: PipelineResult[] = [];
    const outputBase = resolve(testsRoot, pipeline.outputDir || 'specs/functional/ai-assisted');
    if (!isPathWithinRoot(testsRoot, outputBase)) {
        warnings.push(`Pipeline outputDir resolves outside testsRoot and was blocked: ${pipeline.outputDir}`);
        return finalizePipelineSummary({
            runner: 'unknown',
            results,
            warnings,
            mcp: createMcpStatus('unknown', Boolean(pipeline.mcp)),
        });
    }

    for (const flow of flows) {
        if (flow.priority !== 'P0' && flow.priority !== 'P1') {
            continue;
        }
        const slug = flow.id.replace(/[^a-zA-Z0-9._-]+/g, '-');
        const outputDir = normalizePath(join(outputBase, slug));
        if (!isPathWithinRoot(testsRoot, outputDir)) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                error: 'output directory resolves outside testsRoot',
            });
            continue;
        }

        if (pipeline.dryRun) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'skipped',
                healStatus: 'skipped',
            });
            continue;
        }

        const generateArgs = ['tsx', cliPath, 'generate', flow.name, '--output', outputDir, '--scenarios', `${pipeline.scenarios}`];
        if (pipeline.baseUrl) {
            generateArgs.push('--base-url', pipeline.baseUrl);
        }
        if (pipeline.headless) {
            generateArgs.push('--headless');
        }
        if (pipeline.browser) {
            generateArgs.push('--browser', pipeline.browser);
        }
        if (pipeline.project) {
            generateArgs.push('--project', pipeline.project);
        }
        if (pipeline.parallel) {
            generateArgs.push('--parallel');
        }
        if (pipeline.mcp) {
            generateArgs.push('--mcp');
        }

        const generateResult = runCommand('npx', generateArgs, testsRoot);
        if (generateResult.status !== 0) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                error: summarizeCommandOutput(generateResult.stdout, generateResult.stderr) || generateResult.error || 'generate failed',
            });
            continue;
        }

        let healStatus: PipelineResult['healStatus'] = 'skipped';
        if (pipeline.heal) {
            const healArgs = ['tsx', cliPath, 'heal', outputDir];
            if (pipeline.browser) {
                healArgs.push('--browser', pipeline.browser);
            }
            if (pipeline.project) {
                healArgs.push('--project', pipeline.project);
            }
            if (pipeline.parallel) {
                healArgs.push('--parallel');
            }
            if (pipeline.mcp) {
                healArgs.push('--mcp');
            }
            const healResult = runCommand('npx', healArgs, testsRoot);
            healStatus = healResult.status === 0 ? 'success' : 'failed';
        }

        const disallowedDescribeFiles = findDisallowedDescribeFiles(outputDir);
        if (disallowedDescribeFiles.length > 0) {
            results.push({
                flowId: flow.id,
                flowName: flow.name,
                generatedDir: outputDir,
                generateStatus: 'failed',
                healStatus,
                error: `Generated tests contain test.describe (disallowed): ${disallowedDescribeFiles.join(', ')}`,
            });
            continue;
        }

        results.push({
            flowId: flow.id,
            flowName: flow.name,
            generatedDir: outputDir,
            generateStatus: 'success',
            healStatus,
        });
    }

    return finalizePipelineSummary({
        runner: 'e2e-test-gen',
        results,
        warnings,
        mcp: createMcpStatus('e2e-test-gen', Boolean(pipeline.mcp)),
    });
}

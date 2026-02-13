// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {join, resolve} from 'path';
import type {FrameworkType} from './config.js';
import type {FlowImpact} from './analysis.js';
import {isPathWithinRoot} from './utils.js';

export interface GeneratedTest {
    path: string;
    flowId: string;
    created: boolean;
    reason?: string;
}

function inferTestDir(patterns: string[]): string {
    if (patterns.length === 0) {
        return 'tests';
    }
    const pattern = patterns[0];
    const wildcardIndex = pattern.search(/[*{]/);
    const base = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex);
    const trimmed = base.replace(/\/+$/, '');
    return trimmed || 'tests';
}

function inferTestExtension(patterns: string[], framework: FrameworkType): string {
    const joined = patterns.join(' ');
    if (joined.includes('.ts') || joined.includes('.tsx')) {
        return 'ts';
    }
    return 'js';
}

function createPlaywrightTest(flow: FlowImpact, testIds: string[]): string {
    const idsComment = testIds.length > 0 ? `// Suggested data-testid: ${testIds.join(', ')}` : '// TODO: add data-testid selectors';
    return [
        "import {test, expect} from '@mattermost/playwright-lib';",
        '',
        '/**',
        ` * @objective Validate ${flow.name} flow`,
        ' */',
        `test('${flow.priority}: ${flow.name} basic flow', {tag: '@ai-assisted'}, async ({pw}) => {`,
        '  const {user, team} = await pw.initSetup();',
        '  const {channelsPage} = await pw.testBrowser.login(user);',
        "  await channelsPage.goto(team.name);",
        `  ${idsComment}`,
        '  // # TODO: implement steps',
        '  // * TODO: implement assertions',
        '  await expect(channelsPage.page).toHaveURL(/.*/);',
        '});',
        '',
    ].join('\n');
}

function createCypressTest(flow: FlowImpact, testIds: string[]): string {
    const idsComment = testIds.length > 0 ? `// Suggested data-testid: ${testIds.join(', ')}` : '// TODO: add data-testid selectors';
    return [
        `describe('Flow: ${flow.name}', () => {`,
        `  it('${flow.priority}: ${flow.name} basic flow', () => {`,
        "    cy.visit('/');",
        `    ${idsComment}`,
        '    // TODO: implement steps',
        '    cy.url().should(\'match\', /.*/);',
        '  });',
        '});',
        '',
    ].join('\n');
}

function createSeleniumTest(flow: FlowImpact, testIds: string[]): string {
    const idsComment = testIds.length > 0 ? `// Suggested data-testid: ${testIds.join(', ')}` : '// TODO: add data-testid selectors';
    return [
        "const {Builder, By, until} = require('selenium-webdriver');",
        '',
        `(async () => {`,
        "  const driver = await new Builder().forBrowser('chrome').build();",
        '  try {',
        "    await driver.get('http://localhost:3000');",
        `    ${idsComment}`,
        '    // TODO: implement steps',
        '    await driver.wait(until.titleIs(\'\'), 5000);',
        '  } finally {',
        '    await driver.quit();',
        '  }',
        '})();',
        '',
    ].join('\n');
}

export function generateTests(
    appRoot: string,
    flows: FlowImpact[],
    framework: FrameworkType,
    testPatterns: string[],
    testIdsByFlow: Map<string, string[]>,
): GeneratedTest[] {
    const inferredTestDir = inferTestDir(testPatterns);
    const safeTestDir = isPathWithinRoot(appRoot, resolve(appRoot, inferredTestDir)) ? inferredTestDir : 'tests';
    const testDir = safeTestDir;
    const extension = inferTestExtension(testPatterns, framework);
    const generated: GeneratedTest[] = [];

    for (const flow of flows) {
        if (flow.priority !== 'P0' && flow.priority !== 'P1') {
            continue;
        }

        const testIds = testIdsByFlow.get(flow.id) || [];
        const fileName = framework === 'cypress' ? `${flow.id}.cy.${extension}` : `${flow.id}.spec.${extension}`;
        const fullPath = resolve(appRoot, testDir, fileName);
        if (!isPathWithinRoot(appRoot, fullPath)) {
            generated.push({path: fullPath, flowId: flow.id, created: false, reason: 'outside-root'});
            continue;
        }

        if (existsSync(fullPath)) {
            generated.push({path: fullPath, flowId: flow.id, created: false, reason: 'exists'});
            continue;
        }

        mkdirSync(join(appRoot, testDir), {recursive: true});

        let content = '';
        if (framework === 'cypress') {
            content = createCypressTest(flow, testIds);
        } else if (framework === 'selenium') {
            content = createSeleniumTest(flow, testIds);
        } else {
            content = createPlaywrightTest(flow, testIds);
        }

        writeFileSync(fullPath, content, 'utf-8');
        generated.push({path: fullPath, flowId: flow.id, created: true});
    }

    return generated;
}

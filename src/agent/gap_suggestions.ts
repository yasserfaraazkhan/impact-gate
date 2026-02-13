// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {join, resolve} from 'path';
import type {FrameworkType} from './config.js';
import type {FlowImpact} from './analysis.js';
import {isPathWithinRoot} from './utils.js';

export interface GapTestSuggestion {
    flowId: string;
    flowName: string;
    priority: string;
    rationale: string;
    sourceFiles: string[];
    suggestedTestPath: string;
    framework: Exclude<FrameworkType, 'auto' | 'unknown'>;
    skeleton: string;
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

function inferExtension(patterns: string[]): string {
    const joined = patterns.join(' ');
    if (joined.includes('.ts') || joined.includes('.tsx')) {
        return 'ts';
    }
    return 'js';
}

function normalizeFramework(framework: FrameworkType): Exclude<FrameworkType, 'auto' | 'unknown'> {
    if (framework === 'cypress' || framework === 'selenium') {
        return framework;
    }
    return 'playwright';
}

function buildSkeleton(flow: FlowImpact, sourceFiles: string[], framework: Exclude<FrameworkType, 'auto' | 'unknown'>): string {
    const linkedFiles = sourceFiles.length > 0 ? sourceFiles.join(', ') : 'N/A';
    if (framework === 'cypress') {
        return [
            `describe('Flow: ${flow.name}', () => {`,
            `  it('${flow.priority}: critical coverage for ${flow.id}', () => {`,
            "    cy.visit('/');",
            `    // Linked code areas: ${linkedFiles}`,
            '    // TODO: implement critical user path assertions',
            '  });',
            '});',
            '',
        ].join('\n');
    }
    if (framework === 'selenium') {
        return [
            "const {Builder} = require('selenium-webdriver');",
            '',
            '(async () => {',
            "  const driver = await new Builder().forBrowser('chrome').build();",
            '  try {',
            "    await driver.get('http://localhost:3000');",
            `    // Linked code areas: ${linkedFiles}`,
            '    // TODO: implement critical user path assertions',
            '  } finally {',
            '    await driver.quit();',
            '  }',
            '})();',
            '',
        ].join('\n');
    }
    return [
        "import {test, expect} from '@mattermost/playwright-lib';",
        '',
        `test('${flow.priority}: ${flow.name} critical path', {tag: '@ai-assisted'}, async ({pw}) => {`,
        '  const {user, team} = await pw.initSetup();',
        '  const {channelsPage} = await pw.testBrowser.login(user);',
        "  await channelsPage.goto(team.name);",
        `  // Linked code areas: ${linkedFiles}`,
        '  // TODO: implement critical user path assertions',
        '  await expect(channelsPage.page).toHaveURL(/.*/);',
        '});',
        '',
    ].join('\n');
}

export function buildGapTestSuggestions(
    testsRoot: string,
    flowsWithGaps: FlowImpact[],
    framework: FrameworkType,
    testPatterns: string[],
): GapTestSuggestion[] {
    const testDir = inferTestDir(testPatterns);
    const ext = inferExtension(testPatterns);
    const resolvedFramework = normalizeFramework(framework);

    return flowsWithGaps
        .filter((flow) => flow.priority === 'P0' || flow.priority === 'P1')
        .map((flow) => {
            const fileName = resolvedFramework === 'cypress' ? `${flow.id}.cy.${ext}` : `${flow.id}.spec.${ext}`;
            const candidatePath = resolve(testsRoot, testDir, fileName);
            const suggestionPath = isPathWithinRoot(testsRoot, candidatePath)
                ? candidatePath
                : resolve(testsRoot, 'tests', fileName);
            const sourceFiles = (flow.files || []).slice(0, 6);
            const rationale = flow.reasons.length > 0 ? flow.reasons.join('; ') : 'High priority flow is currently uncovered';
            return {
                flowId: flow.id,
                flowName: flow.name,
                priority: flow.priority,
                rationale,
                sourceFiles,
                suggestedTestPath: suggestionPath,
                framework: resolvedFramework,
                skeleton: buildSkeleton(flow, sourceFiles, resolvedFramework),
            };
        });
}

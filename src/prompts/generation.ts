// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {FlowDecision} from '../validation/output_schema.js';
import type {ApiSurfaceCatalog} from '../knowledge/api_surface.js';
import {formatApiSurfaceForPrompt} from '../knowledge/api_surface.js';
import {sanitizeForPrompt} from '../crew/sanitize.js';
import type {GenerationProfile} from './generation_profile.js';
import {isMattermostProfile} from './generation_profile.js';

export interface GenerationPromptContext {
    decision: FlowDecision;
    apiSurface: ApiSurfaceCatalog;
    existingSpecContent?: string;
    specPath: string;
    mode: 'create_spec' | 'add_scenarios';
    profile?: GenerationProfile;
}

function resolveRelevantPageObjects(
    apiSurface: ApiSurfaceCatalog,
    decision: FlowDecision,
): string[] {
    const relevant: string[] = [];
    const familyHints = [
        decision.routeFamily,
        decision.featureId,
        ...decision.userActions.join(' ').toLowerCase().split(/\s+/),
    ]
        .filter(Boolean)
        .map((s) => s!.toLowerCase().replace(/[^a-z]/g, ''));

    for (const po of apiSurface.pageObjects) {
        const nameLower = po.className.toLowerCase();
        if (
            nameLower.includes('channels') ||
            nameLower.includes('page') ||
            familyHints.some((hint) => hint.length > 3 && nameLower.includes(hint))
        ) {
            relevant.push(po.className);
        }
    }

    return [...new Set(relevant)].slice(0, 10);
}

export function buildGenerationPrompt(ctx: GenerationPromptContext): string {
    const profile = ctx.profile;
    const isMM = profile ? isMattermostProfile(profile) : true;

    const relevantClasses = resolveRelevantPageObjects(ctx.apiSurface, ctx.decision);
    const apiBlock = relevantClasses.length > 0
        ? formatApiSurfaceForPrompt(ctx.apiSurface, relevantClasses)
        : 'No page objects available. Use raw Playwright selectors via page.getByRole/getByTestId.';

    const scenariosBlock = (ctx.decision.scenariosToAdd || [])
        .map((s, i) => `  ${i + 1}. ${s}`)
        .join('\n');

    const existingBlock = ctx.existingSpecContent
        ? `\nEXISTING SPEC (extend this file):\n\`\`\`typescript\n${ctx.existingSpecContent}\n\`\`\``
        : '';

    const modeInstruction = ctx.mode === 'create_spec'
        ? `Create a NEW spec file at: ${ctx.specPath}`
        : `ADD scenarios to the EXISTING spec at: ${ctx.specPath}`;

    const routeFamilyTag = ctx.decision.routeFamily;

    // Build prompt based on profile
    const projectName = profile?.projectName || 'Mattermost';
    const testFramework = profile?.testFramework || 'Playwright';
    const importStatement = profile?.importStatement || '@mattermost/playwright-lib';

    // API test mode prompt
    if (profile?.testMode === 'api') {
        return buildApiTestPrompt(ctx, profile, scenariosBlock, routeFamilyTag);
    }

    // Build rules from profile conventions or use Mattermost defaults
    const rules = isMM
        ? [
            `1. Import ONLY from "${importStatement}" — no other test framework imports.`,
            '2. Every test must call `await pw.initSetup()` first.',
            '3. Use `await pw.testBrowser.login(user)` to log in — never hardcode credentials.',
            '4. Use ONLY page object methods listed above. Do NOT invent methods that are not listed.',
            '5. If a method is not available, use `page.getByRole()` or `page.getByTestId()`.',
            `6. Tag every test: {tag: '@${routeFamilyTag}'}`,
            '7. Write one test per scenario with a descriptive name of what the user does and what is verified.',
            `8. Use \`expect\` from "${importStatement}" — do NOT import from "@playwright/test".`,
            '9. Include the copyright header for new files.',
            '10. NEVER fabricate test IDs (MM-TXXXX). Use descriptive names only.',
        ]
        : [
            ...(profile?.conventions || []).map((c, i) => `${i + 1}. ${c}`),
            `${(profile?.conventions?.length || 0) + 1}. Use ONLY page object methods listed above. Do NOT invent methods that are not listed.`,
            `${(profile?.conventions?.length || 0) + 2}. If a method is not available, use \`page.getByRole()\` or \`page.getByTestId()\`.`,
            `${(profile?.conventions?.length || 0) + 3}. Tag every test: {tag: '@${routeFamilyTag}'}`,
        ];

    // Build example block
    const exampleBlock = isMM
        ? [
            'EXAMPLE SPEC STRUCTURE:',
            '```typescript',
            '// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.',
            '// See LICENSE.txt for license information.',
            '',
            `import {expect, test} from '${importStatement}';`,
            '',
            'test(',
            "    'descriptive name of what is tested',",
            `    {tag: '@${routeFamilyTag}'},`,
            '    async ({pw}) => {',
            '        const {user} = await pw.initSetup();',
            '        const {channelsPage} = await pw.testBrowser.login(user);',
            '        await channelsPage.goto();',
            '        await channelsPage.toBeVisible();',
            '        // test steps...',
            '    },',
            ');',
            '```',
        ]
        : [
            'EXAMPLE SPEC STRUCTURE:',
            '```typescript',
            ...(profile?.copyrightHeader ? [profile.copyrightHeader, ''] : []),
            `import {test, expect} from '${importStatement}';`,
            '',
            'test(',
            "    'descriptive name of what is tested',",
            `    {tag: '@${routeFamilyTag}'},`,
            '    async ({page}) => {',
            '        // test steps...',
            '    },',
            ');',
            '```',
        ];

    return [
        `You are generating ${projectName} ${testFramework} E2E test code.`,
        '',
        `TASK: ${modeInstruction}`,
        '',
        `FLOW: ${sanitizeForPrompt(ctx.decision.flowName)}`,
        `Route Family: ${ctx.decision.routeFamily}${ctx.decision.featureId ? ` / ${ctx.decision.featureId}` : ''}`,
        `Route: ${ctx.decision.specificRoute || '(not specified)'}`,
        `Priority: ${ctx.decision.priority}`,
        `Evidence: ${sanitizeForPrompt(ctx.decision.evidence)}`,
        '',
        'SCENARIOS TO IMPLEMENT:',
        scenariosBlock || '  (implement core user actions for this flow)',
        '',
        'USER ACTIONS:',
        ctx.decision.userActions.map((a) => `  - ${sanitizeForPrompt(a)}`).join('\n') || '  (none specified)',
        '',
        'AVAILABLE PAGE OBJECTS AND METHODS:',
        apiBlock,
        existingBlock,
        '',
        'MANDATORY RULES:',
        ...rules,
        '',
        ...exampleBlock,
        '',
        'Return ONLY the TypeScript code. No explanations, no markdown fences.',
    ].join('\n');
}

function buildApiTestPrompt(
    ctx: GenerationPromptContext,
    profile: GenerationProfile,
    scenariosBlock: string,
    routeFamilyTag: string,
): string {
    const modeInstruction = ctx.mode === 'create_spec'
        ? `Create a NEW test file at: ${ctx.specPath}`
        : `ADD test cases to the EXISTING file at: ${ctx.specPath}`;

    const existingBlock = ctx.existingSpecContent
        ? `\nEXISTING FILE (extend this):\n\`\`\`typescript\n${ctx.existingSpecContent}\n\`\`\``
        : '';

    return [
        `You are generating ${profile.projectName} API test code using ${profile.testFramework}.`,
        '',
        `TASK: ${modeInstruction}`,
        '',
        `FLOW: ${sanitizeForPrompt(ctx.decision.flowName)}`,
        `Route Family: ${ctx.decision.routeFamily}${ctx.decision.featureId ? ` / ${ctx.decision.featureId}` : ''}`,
        `Endpoint: ${ctx.decision.specificRoute || '(not specified)'}`,
        `Priority: ${ctx.decision.priority}`,
        `Evidence: ${sanitizeForPrompt(ctx.decision.evidence)}`,
        '',
        'SCENARIOS TO IMPLEMENT:',
        scenariosBlock || '  (implement core API endpoint tests)',
        '',
        'USER ACTIONS:',
        ctx.decision.userActions.map((a) => `  - ${sanitizeForPrompt(a)}`).join('\n') || '  (none specified)',
        existingBlock,
        '',
        'MANDATORY RULES:',
        ...profile.conventions.map((c, i) => `${i + 1}. ${c}`),
        `${profile.conventions.length + 1}. Tag every test: {tag: '@${routeFamilyTag}'}`,
        '',
        'EXAMPLE TEST STRUCTURE:',
        ...(profile.testFramework.toLowerCase().includes('pytest')
            ? [
                '```python',
                ...(profile.copyrightHeader ? [profile.copyrightHeader, ''] : []),
                'import pytest',
                'import requests',
                '',
                `BASE_URL = 'http://localhost:3000'`,
                '',
                '',
                `class Test${ctx.decision.routeFamily.replace(/[^a-zA-Z0-9]/g, '')}:`,
                "    def test_should_return_200_for_valid_request(self):",
                `        res = requests.get(f'{BASE_URL}${ctx.decision.specificRoute || '/api/endpoint'}')`,
                '        assert res.status_code == 200',
                '```',
            ]
            : [
                '```typescript',
                ...(profile.copyrightHeader ? [profile.copyrightHeader, ''] : []),
                `import {describe, it, expect} from '${profile.importStatement}';`,
                "import supertest from 'supertest';",
                '',
                "const request = supertest('http://localhost:3000');",
                '',
                `describe('${ctx.decision.routeFamily}', () => {`,
                "    it('should return 200 for valid request', async () => {",
                `        const res = await request.get('${ctx.decision.specificRoute || '/api/endpoint'}');`,
                '        expect(res.status).toBe(200);',
                '    });',
                '});',
                '```',
            ]),
        '',
        ...(profile.testFramework.toLowerCase().includes('pytest')
            ? ['Return ONLY the Python code. No explanations, no markdown fences.']
            : ['Return ONLY the TypeScript code. No explanations, no markdown fences.']),
    ].join('\n');
}

export interface GenerationAgentResponse {
    specPath: string;
    code: string;
    mode: 'create_spec' | 'add_scenarios';
    flowId: string;
}

export function parseGenerationResponse(
    text: string,
    expectedPath: string,
    mode: 'create_spec' | 'add_scenarios',
    flowId: string,
    profile?: GenerationProfile,
): GenerationAgentResponse | null {
    let code = text.trim();
    const fenced = code.match(/^```(?:typescript|ts)?\s*([\s\S]*?)```\s*$/i);
    if (fenced) {
        code = fenced[1].trim();
    }

    if (!code.includes('test(') && !code.includes('it(') && !code.includes('describe(')) {
        return null;
    }

    const importStatement = profile?.importStatement || '@mattermost/playwright-lib';

    // Auto-add import if missing
    if (!code.includes(importStatement)) {
        if (profile?.testMode === 'api') {
            code = `import {describe, it, expect} from '${importStatement}';\n\n${code}`;
        } else {
            code = `import {expect, test} from '${importStatement}';\n\n${code}`;
        }
    }

    return {specPath: expectedPath, code, mode, flowId};
}

const BUILT_IN_METHODS = new Set([
    'click', 'fill', 'focus', 'hover', 'press', 'type', 'check', 'uncheck',
    'selectOption', 'waitFor', 'waitForLoadState', 'evaluate', 'dispatchEvent',
    'getAttribute', 'textContent', 'innerText', 'innerHTML',
    'isVisible', 'isEnabled', 'isChecked', 'isHidden',
    'toBeVisible', 'toBeEnabled', 'toBeChecked', 'toBeHidden',
    'toContainText', 'toHaveText', 'toHaveURL', 'toHaveValue',
    'not', 'nth', 'first', 'last', 'all',
    'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder',
    'getByTestId', 'getByTitle', 'getByAltText',
    'locator', 'frame', 'page', 'expect',
    'goBack', 'goForward', 'reload', 'goto',
    'keyboard', 'mouse', 'touchscreen', 'close', 'bringToFront',
    'initSetup', 'login', 'waitUntil', 'skipIfNoLicense', 'ensureLicense',
    'random', 'duration', 'isOutsideRemoteUserHour', 'setTimeout',
    'skip', 'fixme', 'slow', 'fail',
    // API testing built-ins
    'get', 'post', 'put', 'patch', 'delete', 'send', 'set', 'query',
    'toBe', 'toEqual', 'toBeDefined', 'toContain', 'toHaveProperty',
    'toMatchObject', 'toHaveLength', 'toBeTruthy', 'toBeFalsy',
]);

/**
 * Returns method names that appear in generated code but do not exist in the API surface.
 * Used for logging; does not block generation.
 */
export function detectHallucinatedMethods(code: string, apiSurface: ApiSurfaceCatalog): string[] {
    const allMethods = new Set(apiSurface.pageObjects.flatMap((po) => po.methods.map((m) => m.name)));
    const suspected: string[] = [];

    const callRe = /\bawait\s+\w+\.([a-zA-Z_]\w*)\s*\(/g;
    let match;
    while ((match = callRe.exec(code)) !== null) {
        const methodName = match[1];
        if (!BUILT_IN_METHODS.has(methodName) && !allMethods.has(methodName) && methodName.length > 3) {
            suspected.push(methodName);
        }
    }

    return [...new Set(suspected)];
}

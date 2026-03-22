// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {LLMProvider} from '../provider_interface.js';
import type {TestFailure} from './types.js';
import {sanitizeForPrompt} from '../crew/sanitize.js';

export interface FixPromptContext {
    specCode: string;
    failures: TestFailure[];
    attempt: number;
    maxAttempts: number;
    apiSurfaceHint?: string;
}

export function buildFixPrompt(ctx: FixPromptContext): string {
    const isCompileError = ctx.failures.some((f) => f.testTitle === '(compile)');

    const failuresBlock = ctx.failures.map((f) => {
        const lines = [`  Test: ${sanitizeForPrompt(f.testTitle)}`, `  Error: ${sanitizeForPrompt(f.error)}`];
        if (f.stack) lines.push(`  Stack: ${sanitizeForPrompt(f.stack)}`);
        if (f.line) lines.push(`  Line: ${f.line}`);
        if (f.expected) lines.push(`  Expected: ${sanitizeForPrompt(f.expected)}`);
        if (f.actual) lines.push(`  Actual: ${sanitizeForPrompt(f.actual)}`);
        return lines.join('\n');
    }).join('\n\n');

    const errorType = isCompileError ? 'COMPILE ERROR' : 'TEST FAILURE';
    const apiBlock = ctx.apiSurfaceHint
        ? `\nAVAILABLE PAGE OBJECT API:\n${ctx.apiSurfaceHint}\n`
        : '';

    return [
        `Fix this Playwright E2E test. This is attempt ${ctx.attempt} of ${ctx.maxAttempts}.`,
        '',
        `## ${errorType}`,
        '',
        failuresBlock,
        '',
        '## CURRENT SPEC CODE',
        '',
        '```typescript',
        ctx.specCode,
        '```',
        apiBlock,
        '## RULES',
        '',
        '1. Import ONLY from "@mattermost/playwright-lib" — no "@playwright/test" imports.',
        '2. Every test must call `await pw.initSetup()` first.',
        '3. Use `await pw.testBrowser.login(user)` to log in.',
        '4. Use ONLY page object methods listed in the API above. Do NOT invent methods.',
        '5. If a method is not available, use `page.getByRole()` or `page.getByTestId()`.',
        '6. For flaky/timing issues: add `await expect(locator).toBeVisible()` waits before interactions.',
        '7. Keep the same test scenarios — fix the implementation, not the intent.',
        '8. Return the COMPLETE fixed spec file — not a diff or partial code.',
        '',
        isCompileError
            ? 'The file does not compile. Fix syntax errors, missing imports, or invalid method calls.'
            : 'The test compiles but fails at runtime. Fix selectors, waits, or assertion logic.',
        '',
        'Return ONLY the complete TypeScript code. No explanations, no markdown fences (except wrapping the code).',
    ].join('\n');
}

/**
 * Extract fixed spec code from an LLM response.
 * Returns null if the response doesn't contain valid test code.
 */
export function applyFix(llmResponse: string): string | null {
    let code = llmResponse.trim();
    if (!code) return null;

    // Strip markdown fences
    const fenced = code.match(/```(?:typescript|ts)?\s*([\s\S]*?)```/i);
    if (fenced) {
        code = fenced[1].trim();
    }

    // Must contain test( to be valid
    if (!code.includes('test(')) return null;

    // Ensure it has the right import
    if (!code.includes('@mattermost/playwright-lib')) {
        code = `import {expect, test} from '@mattermost/playwright-lib';\n\n${code}`;
    }

    return code;
}

/**
 * Run one fix attempt: call LLM with failure context, return fixed code.
 */
export async function generateFix(
    provider: LLMProvider,
    ctx: FixPromptContext,
): Promise<{code: string | null; tokensUsed: {input: number; output: number}}> {
    const prompt = buildFixPrompt(ctx);

    const response = await provider.generateText(prompt, {
        maxTokens: 8000,
        temperature: 0.1,
        timeout: 60000,
        systemPrompt: 'You are an expert Playwright test fixer for Mattermost. Return only TypeScript code.',
    });

    const code = applyFix(response.text);
    return {
        code,
        tokensUsed: {input: response.usage?.inputTokens || 0, output: response.usage?.outputTokens || 0},
    };
}

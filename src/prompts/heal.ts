// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {FlowDecision} from '../validation/output_schema.js';

export interface HealPromptContext {
    specPath: string;
    status: 'failed' | 'flaky';
    decision?: FlowDecision;
    failureDetail?: string;
    /** Last 3 console errors from the test run */
    consoleErrors?: string[];
}

/**
 * Builds a route-family-aware heal prompt for the playwright-test-healer agent.
 * Enriches the base healer constraints with flow context so the agent understands
 * what the test is supposed to verify, reducing hallucination during selector repair.
 */
export function buildHealPrompt(ctx: HealPromptContext): string {
    const flowBlock = ctx.decision
        ? [
              '',
              'FLOW CONTEXT (use to understand test intent — do not change test objectives):',
              `  Flow: ${ctx.decision.flowName}`,
              `  Route Family: ${ctx.decision.routeFamily}${ctx.decision.featureId ? ` / ${ctx.decision.featureId}` : ''}`,
              `  Route: ${ctx.decision.specificRoute || '(family-level)'}`,
              `  User Actions: ${ctx.decision.userActions.join('; ') || 'not specified'}`,
              `  Evidence: ${ctx.decision.evidence}`,
          ].join('\n')
        : '';

    const statusNote = ctx.status === 'flaky'
        ? 'This test is FLAKY (passes sometimes, fails other times). Look for race conditions, missing waits, or order-dependent state.'
        : 'This test is FAILING consistently. The selector, URL, or API call is likely broken.';

    const failureBlock = ctx.failureDetail
        ? `\nFailure detail:\n${ctx.failureDetail}`
        : '';

    const consoleBlock = ctx.consoleErrors && ctx.consoleErrors.length > 0
        ? `\nRecent console errors from test run:\n${ctx.consoleErrors.slice(-3).map((e) => `  - ${e}`).join('\n')}`
        : '';

    return [
        'Heal this specific Playwright test file and keep edits minimal.',
        '',
        `Target test file: ${ctx.specPath}`,
        `Status: ${ctx.status.toUpperCase()} — ${statusNote}`,
        failureBlock,
        consoleBlock,
        flowBlock,
        '',
        'Healing constraints (must follow):',
        '- Import ONLY from "@mattermost/playwright-lib". Do not use "@playwright/test" directly.',
        '- Do not use test.describe or test.only.',
        '- Keep a single tag string matching the route family (e.g. "@channels", "@scheduled_posts").',
        '- Use only existing Mattermost Playwright fixture and page-object APIs.',
        '- Do NOT invent new pw.* clients or page object methods that do not exist.',
        '- Avoid brittle class selectors (.backstage-navbar, .admin-console__wrapper, .left-panel, .panel-card).',
        '- Prefer stable assertions using URL patterns, data-testid attributes, ARIA roles, and page-object methods.',
        '- For flaky tests: add explicit waits (waitFor, expect().toBeVisible()) before interactions.',
        '- Keep the test intent and scenario unchanged — only fix what is broken.',
        '- If behavior is genuinely broken server-side, mark test.fixme with a clear comment explaining why.',
        '',
        'Run and fix this test until it compiles and passes, or mark test.fixme when the behavior is truly broken.',
    ].filter((line) => line !== null).join('\n');
}

/**
 * Builds a minimal quality-fix prompt for spec files that fail content validation
 * (e.g. contain test.describe, test.only, wrong imports).
 */
export function buildQualityFixPrompt(specPath: string, qualityIssues: string[]): string {
    return [
        'Fix quality issues in this Playwright spec file. Make minimal edits only.',
        '',
        `Target file: ${specPath}`,
        '',
        'Issues to fix:',
        ...qualityIssues.map((issue) => `  - ${issue}`),
        '',
        'Rules:',
        '- Import only from "@mattermost/playwright-lib".',
        '- Remove test.describe wrappers (flatten to top-level test() calls).',
        '- Remove test.only calls.',
        '- Ensure each test has exactly one tag string.',
        '- Do not change test logic — only fix structural quality issues.',
    ].join('\n');
}

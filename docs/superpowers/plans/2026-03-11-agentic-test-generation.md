# Agentic Playwright Test Generation & Self-Healing

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an agentic workflow where, given test scenarios from the `plan` command, Claude autonomously generates Playwright tests, runs them via Playwright MCP, reads failures, fixes code, and re-runs until all tests pass — a closed-loop generate→run→fix cycle.

**Architecture:** A new `generate` CLI command orchestrates a multi-step agent loop. It takes the `plan-report.json` (or `--scenarios` inline) as input, uses the existing Stage 3 generation pipeline to produce initial spec files, then enters a **fix loop**: run the spec via Playwright (using `npx playwright test`), parse failures from the JSON report, call the LLM with failure context + page object API surface to produce a fix, write the fix, and re-run. The loop exits when all tests pass or a max-attempts limit is reached. The Playwright MCP tools (`browser_navigate`, `browser_snapshot`, `browser_click`) are available as optional exploration aids during generation — the agent can use them to discover selectors and validate UI state when the static API surface isn't sufficient.

**Tech Stack:** TypeScript, existing LLM providers (Anthropic/OpenAI via `LLMProviderFactory`), Playwright test runner (`npx playwright test`), Playwright MCP (optional browser exploration), existing pipeline infrastructure (Stage 3 generation, heal prompts, API surface catalog).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/agentic/runner.ts` | **Create** | Core agentic loop: generate → run → parse failures → fix → re-run |
| `src/agentic/playwright_runner.ts` | **Create** | Runs Playwright tests, parses JSON report, returns structured results |
| `src/agentic/fix_loop.ts` | **Create** | LLM-powered fix cycle: takes failure + spec code + API surface, produces fix |
| `src/agentic/types.ts` | **Create** | Shared types for agentic workflow |
| `src/cli.ts` | **Modify** | Add `generate` command that invokes the agentic runner |
| `src/index.ts` | **Modify** | Export agentic runner API |
| `test/agentic_runner.test.js` | **Create** | Tests for agentic loop with mocked Playwright + LLM |
| `test/playwright_runner.test.js` | **Create** | Tests for Playwright result parsing |
| `test/fix_loop.test.js` | **Create** | Tests for fix generation |

---

## Chunk 1: Playwright Runner + Result Parser

The foundation: run a Playwright spec file and get structured results back.

### Task 1: Create agentic types

**Files:**
- Create: `src/agentic/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/agentic/types.ts
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export interface TestFailure {
    testTitle: string;
    specPath: string;
    error: string;
    /** Truncated stack trace */
    stack: string;
    /** Expected vs actual if available */
    expected?: string;
    actual?: string;
    /** Line number in spec where failure occurred */
    line?: number;
}

export interface PlaywrightRunResult {
    specPath: string;
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
    failures: TestFailure[];
    /** Raw stdout (truncated) */
    stdout: string;
    /** Duration in ms */
    durationMs: number;
    /** Whether the spec even compiled */
    compiled: boolean;
}

export interface AgenticConfig {
    /** Max fix attempts before giving up (default: 3) */
    maxAttempts: number;
    /** Playwright project to use (default: 'chrome') */
    project: string;
    /** Base URL for Playwright (e.g. http://localhost:8065) */
    baseUrl?: string;
    /** Timeout per test run in ms (default: 120000) */
    testTimeoutMs: number;
    /** LLM provider override */
    provider?: string;
    /** Whether to use Playwright MCP for browser exploration */
    useMcp?: boolean;
    /** Dry run — generate but don't run tests */
    dryRun?: boolean;
    /** Tests root directory */
    testsRoot: string;
}

export interface AgenticResult {
    specPath: string;
    scenarioSource: string;
    status: 'passed' | 'failed' | 'max-attempts' | 'compile-error' | 'skipped';
    attempts: number;
    finalRun?: PlaywrightRunResult;
    warnings: string[];
}

export interface AgenticSummary {
    results: AgenticResult[];
    totalGenerated: number;
    totalPassed: number;
    totalFailed: number;
    totalAttempts: number;
    durationMs: number;
    warnings: string[];
}
```

- [ ] **Step 2: Build to verify types compile**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/agentic/types.ts
git commit -m "feat: add agentic workflow types"
```

---

### Task 2: Create Playwright runner

**Files:**
- Create: `src/agentic/playwright_runner.ts`
- Test: `test/playwright_runner.test.js`

This module runs a single spec file via `npx playwright test` and parses the JSON report.

- [ ] **Step 1: Write the failing test**

```javascript
// test/playwright_runner.test.js
import {describe, it, mock, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {parsePlaywrightJsonReport} from '../dist/agentic/playwright_runner.js';

describe('parsePlaywrightJsonReport', () => {
    it('parses a passing report', () => {
        const report = {
            suites: [{
                title: 'test.spec.ts',
                specs: [{
                    title: 'should do something',
                    ok: true,
                    tests: [{
                        status: 'expected',
                        results: [{status: 'passed', duration: 1000}],
                    }],
                }],
            }],
            stats: {
                expected: 1,
                unexpected: 0,
                flaky: 0,
                skipped: 0,
                duration: 1500,
            },
        };

        const result = parsePlaywrightJsonReport(report, 'test.spec.ts');
        assert.equal(result.passed, 1);
        assert.equal(result.failed, 0);
        assert.equal(result.failures.length, 0);
        assert.equal(result.compiled, true);
    });

    it('parses a failing report with error details', () => {
        const report = {
            suites: [{
                title: 'test.spec.ts',
                specs: [{
                    title: 'should fail',
                    ok: false,
                    tests: [{
                        status: 'unexpected',
                        results: [{
                            status: 'failed',
                            duration: 2000,
                            error: {
                                message: 'Expected "Hello" but got "World"',
                                stack: 'at Object.<anonymous> (test.spec.ts:10:5)',
                            },
                        }],
                    }],
                }],
            }],
            stats: {
                expected: 0,
                unexpected: 1,
                flaky: 0,
                skipped: 0,
                duration: 2500,
            },
        };

        const result = parsePlaywrightJsonReport(report, 'test.spec.ts');
        assert.equal(result.passed, 0);
        assert.equal(result.failed, 1);
        assert.equal(result.failures.length, 1);
        assert.equal(result.failures[0].testTitle, 'should fail');
        assert.ok(result.failures[0].error.includes('Expected'));
    });

    it('handles empty report', () => {
        const report = {suites: [], stats: {expected: 0, unexpected: 0, flaky: 0, skipped: 0, duration: 0}};
        const result = parsePlaywrightJsonReport(report, 'test.spec.ts');
        assert.equal(result.passed, 0);
        assert.equal(result.failed, 0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/playwright_runner.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `playwright_runner.ts`**

```typescript
// src/agentic/playwright_runner.ts
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawnSync} from 'child_process';
import {existsSync, readFileSync, mkdirSync, rmSync} from 'fs';
import {join, resolve} from 'path';
import type {PlaywrightRunResult, TestFailure} from './types.js';

const MAX_STDOUT_CHARS = 8000;
const MAX_ERROR_CHARS = 2000;
const MAX_STACK_CHARS = 1000;

interface PlaywrightReportSpec {
    title: string;
    ok: boolean;
    tests: Array<{
        status: string;
        results: Array<{
            status: string;
            duration: number;
            error?: {message: string; stack?: string};
        }>;
    }>;
}

interface PlaywrightReportSuite {
    title: string;
    specs: PlaywrightReportSpec[];
    suites?: PlaywrightReportSuite[];
}

interface PlaywrightReport {
    suites: PlaywrightReportSuite[];
    stats: {
        expected: number;
        unexpected: number;
        flaky: number;
        skipped: number;
        duration: number;
    };
}

function extractSpecs(suites: PlaywrightReportSuite[]): PlaywrightReportSpec[] {
    const specs: PlaywrightReportSpec[] = [];
    for (const suite of suites) {
        specs.push(...suite.specs);
        if (suite.suites) {
            specs.push(...extractSpecs(suite.suites));
        }
    }
    return specs;
}

export function parsePlaywrightJsonReport(report: PlaywrightReport, specPath: string): PlaywrightRunResult {
    const failures: TestFailure[] = [];
    const allSpecs = extractSpecs(report.suites);

    let passed = 0;
    let failed = 0;

    for (const spec of allSpecs) {
        if (spec.ok) {
            passed++;
        } else {
            failed++;
            const lastResult = spec.tests[0]?.results?.at(-1);
            failures.push({
                testTitle: spec.title,
                specPath,
                error: (lastResult?.error?.message || 'Unknown error').slice(0, MAX_ERROR_CHARS),
                stack: (lastResult?.error?.stack || '').slice(0, MAX_STACK_CHARS),
                line: extractLineNumber(lastResult?.error?.stack),
            });
        }
    }

    return {
        specPath,
        passed,
        failed,
        flaky: report.stats.flaky || 0,
        skipped: report.stats.skipped || 0,
        failures,
        stdout: '',
        durationMs: report.stats.duration || 0,
        compiled: true,
    };
}

function extractLineNumber(stack?: string): number | undefined {
    if (!stack) return undefined;
    const match = stack.match(/:(\d+):\d+\)?$/m);
    return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Run a single Playwright spec file and return structured results.
 * Uses a temp JSON reporter to get machine-readable output.
 */
export function runPlaywrightSpec(
    specPath: string,
    testsRoot: string,
    options: {project?: string; baseUrl?: string; timeoutMs?: number},
): PlaywrightRunResult {
    // SECURITY: Validate spec path is within testsRoot and has valid extension
    const resolvedSpec = resolve(specPath);
    const resolvedRoot = resolve(testsRoot);
    if (!resolvedSpec.startsWith(resolvedRoot + '/')) {
        throw new Error(`Security: spec path ${specPath} is outside testsRoot`);
    }
    if (!resolvedSpec.endsWith('.spec.ts') && !resolvedSpec.endsWith('.test.ts')) {
        throw new Error(`Security: spec path must end in .spec.ts or .test.ts`);
    }

    const reportDir = join(testsRoot, '.e2e-ai-agents', 'agentic-reports');
    if (!existsSync(reportDir)) {
        mkdirSync(reportDir, {recursive: true});
    }
    const reportPath = join(reportDir, `report-${Date.now()}.json`);

    const args = [
        'playwright', 'test',
        specPath,
        '--reporter', `json`,
        '--project', options.project || 'chrome',
    ];
    if (options.baseUrl) {
        args.push('--config', 'playwright.config.ts');
    }

    const startTime = Date.now();
    const result = spawnSync('npx', args, {
        cwd: testsRoot,
        encoding: 'utf-8',
        timeout: options.timeoutMs || 120000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
            ...process.env,
            PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
        },
    });
    const durationMs = Date.now() - startTime;

    const stdout = (result.stdout || '').slice(0, MAX_STDOUT_CHARS);
    const stderr = (result.stderr || '').slice(0, MAX_STDOUT_CHARS);

    // Check for compile errors
    if (stderr.includes('SyntaxError') || stderr.includes('Cannot find module') || stderr.includes('TypeError')) {
        return {
            specPath,
            passed: 0,
            failed: 1,
            flaky: 0,
            skipped: 0,
            failures: [{
                testTitle: '(compile)',
                specPath,
                error: stderr.slice(0, MAX_ERROR_CHARS),
                stack: '',
            }],
            stdout: `${stdout}\n${stderr}`,
            durationMs,
            compiled: false,
        };
    }

    // Try to parse JSON report from stdout (Playwright JSON reporter writes to stdout)
    try {
        const jsonReport = JSON.parse(stdout) as PlaywrightReport;
        const parsed = parsePlaywrightJsonReport(jsonReport, specPath);
        parsed.durationMs = durationMs;
        parsed.stdout = stdout;
        return parsed;
    } catch {
        // Fallback: try the file-based report
    }

    // Try file-based report
    if (existsSync(reportPath)) {
        try {
            const jsonReport = JSON.parse(readFileSync(reportPath, 'utf-8')) as PlaywrightReport;
            const parsed = parsePlaywrightJsonReport(jsonReport, specPath);
            parsed.durationMs = durationMs;
            parsed.stdout = stdout;
            // Clean up report file
            try { rmSync(reportPath); } catch { /* ignore */ }
            return parsed;
        } catch {
            // Fallback to exit code
        }
    }

    // Last resort: use exit code
    return {
        specPath,
        passed: result.status === 0 ? 1 : 0,
        failed: result.status === 0 ? 0 : 1,
        flaky: 0,
        skipped: 0,
        failures: result.status !== 0
            ? [{testTitle: '(unknown)', specPath, error: stderr.slice(0, MAX_ERROR_CHARS), stack: ''}]
            : [],
        stdout,
        durationMs,
        compiled: !stderr.includes('Error'),
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/playwright_runner.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agentic/playwright_runner.ts src/agentic/types.ts test/playwright_runner.test.js
git commit -m "feat: add Playwright runner with JSON report parser"
```

---

## Chunk 2: LLM-Powered Fix Loop

### Task 3: Create the fix loop module

**Files:**
- Create: `src/agentic/fix_loop.ts`
- Test: `test/fix_loop.test.js`

This module takes a failed test result + the current spec code + API surface, sends it to the LLM, and returns a fixed spec.

- [ ] **Step 1: Write the failing test**

```javascript
// test/fix_loop.test.js
import {describe, it, mock} from 'node:test';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/fix_loop.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `fix_loop.ts`**

```typescript
// src/agentic/fix_loop.ts
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {LLMProvider} from '../provider_interface.js';
import type {TestFailure} from './types.js';

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
        const lines = [`  Test: ${f.testTitle}`, `  Error: ${f.error}`];
        if (f.stack) lines.push(`  Stack: ${f.stack}`);
        if (f.line) lines.push(`  Line: ${f.line}`);
        if (f.expected) lines.push(`  Expected: ${f.expected}`);
        if (f.actual) lines.push(`  Actual: ${f.actual}`);
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
        tokensUsed: {input: response.inputTokens || 0, output: response.outputTokens || 0},
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/fix_loop.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agentic/fix_loop.ts test/fix_loop.test.js
git commit -m "feat: add LLM-powered fix loop for test failures"
```

---

## Chunk 3: Agentic Runner (The Closed Loop)

### Task 4: Create the agentic runner

**Files:**
- Create: `src/agentic/runner.ts`
- Test: `test/agentic_runner.test.js`

This is the main orchestrator. For each scenario:
1. Generate initial spec (via existing Stage 3 or inline LLM call)
2. Run with Playwright
3. If failures → fix loop (up to maxAttempts)
4. Return structured result

- [ ] **Step 1: Write the failing test**

```javascript
// test/agentic_runner.test.js
import {describe, it, mock} from 'node:test';
import assert from 'node:assert/strict';
import {runAgenticGeneration} from '../dist/agentic/runner.js';

// Mock provider
function createMockProvider(responses) {
    let callIndex = 0;
    return {
        name: 'mock',
        generateText: mock.fn(async () => {
            const resp = responses[callIndex] || responses[responses.length - 1];
            callIndex++;
            return {text: resp, inputTokens: 100, outputTokens: 50};
        }),
        capabilities: {maxTokens: 200000, vision: false, streaming: false, costPer1MInputTokens: 3, costPer1MOutputTokens: 15, supportsTools: false, supportsPromptCaching: false, typicalResponseTimeMs: 1000},
        getUsageStats: () => ({requestCount: 0, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, totalCost: 0, averageResponseTimeMs: 0, failedRequests: 0, startTime: new Date(), lastUpdated: new Date()}),
        resetUsageStats: () => {},
    };
}

describe('runAgenticGeneration', () => {
    it('returns summary with results for dry run', async () => {
        const provider = createMockProvider([
            "import {test} from '@mattermost/playwright-lib';\ntest('my test', async ({pw}) => { const {user} = await pw.initSetup(); });",
        ]);

        const summary = await runAgenticGeneration({
            scenarios: [{
                id: 'test-flow',
                name: 'Test Flow',
                scenarios: ['Verify user can post a message'],
                routeFamily: 'channels',
                priority: 'P0',
            }],
            config: {
                maxAttempts: 3,
                project: 'chrome',
                testTimeoutMs: 120000,
                testsRoot: '/tmp/fake-tests',
                dryRun: true,
            },
            provider,
            apiSurfaceHint: 'ChannelsPage: goto(), toBeVisible()',
        });

        assert.ok(summary.totalGenerated >= 1);
        assert.ok(summary.results.length >= 1);
        // Dry run skips execution
        assert.equal(summary.results[0].status, 'skipped');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/agentic_runner.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `runner.ts`**

```typescript
// src/agentic/runner.ts
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {resolve} from 'path';
import type {LLMProvider} from '../provider_interface.js';
import type {AgenticConfig, AgenticResult, AgenticSummary, PlaywrightRunResult} from './types.js';
import {runPlaywrightSpec} from './playwright_runner.js';
import {generateFix} from './fix_loop.js';
import {formatApiSurfaceForPrompt} from '../knowledge/api_surface.js';
import type {ApiSurfaceCatalog} from '../knowledge/api_surface.js';
import {parseGenerationResponse} from '../prompts/generation.js';

export interface ScenarioInput {
    id: string;
    name: string;
    scenarios: string[];
    routeFamily: string;
    priority: string;
    /** Existing spec to add scenarios to */
    targetSpec?: string;
    /** Changed files for context */
    changedFiles?: string[];
    /** Evidence from impact analysis */
    evidence?: string;
}

export interface AgenticRunOptions {
    scenarios: ScenarioInput[];
    config: AgenticConfig;
    provider: LLMProvider;
    apiSurfaceHint?: string;
    apiSurface?: ApiSurfaceCatalog;
}

function buildGeneratePrompt(scenario: ScenarioInput, apiSurfaceHint: string): string {
    const scenariosBlock = scenario.scenarios
        .map((s, i) => `  ${i + 1}. ${s}`)
        .join('\n');

    return [
        'Generate a Mattermost Playwright E2E test file.',
        '',
        `FLOW: ${scenario.name}`,
        `Route Family: ${scenario.routeFamily}`,
        `Priority: ${scenario.priority}`,
        scenario.evidence ? `Evidence: ${scenario.evidence}` : '',
        '',
        'SCENARIOS TO IMPLEMENT:',
        scenariosBlock,
        '',
        'AVAILABLE PAGE OBJECTS AND METHODS:',
        apiSurfaceHint,
        '',
        'MANDATORY RULES:',
        '1. Import ONLY from "@mattermost/playwright-lib" — no other test framework imports.',
        '2. Every test must call `await pw.initSetup()` first.',
        '3. Use `await pw.testBrowser.login(user)` to log in — never hardcode credentials.',
        '4. Use ONLY page object methods listed above. Do NOT invent methods.',
        '5. If a method is not available, use `page.getByRole()` or `page.getByTestId()`.',
        `6. Tag every test: {tag: '@${scenario.routeFamily}'}`,
        '7. Write one test per scenario with a descriptive name.',
        '8. Use `expect` from "@mattermost/playwright-lib".',
        '9. Include the copyright header.',
        '10. NEVER fabricate test IDs (MM-TXXXX). Use descriptive names only.',
        '',
        'EXAMPLE STRUCTURE:',
        '```typescript',
        '// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.',
        '// See LICENSE.txt for license information.',
        '',
        "import {expect, test} from '@mattermost/playwright-lib';",
        '',
        'test(',
        "    'user can post a message in channel',",
        `    {tag: '@${scenario.routeFamily}'},`,
        '    async ({pw}) => {',
        '        const {user} = await pw.initSetup();',
        '        const {channelsPage} = await pw.testBrowser.login(user);',
        '        await channelsPage.goto();',
        '        await channelsPage.toBeVisible();',
        '        // test steps...',
        '    },',
        ');',
        '```',
        '',
        'Return ONLY the TypeScript code. No explanations.',
    ].filter(Boolean).join('\n');
}

function resolveSpecPath(scenario: ScenarioInput, testsRoot: string): string {
    let specPath: string;
    if (scenario.targetSpec) {
        specPath = join(testsRoot, scenario.targetSpec);
    } else {
        const safeName = scenario.id.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const outputDir = join(testsRoot, 'specs', 'functional', 'ai-assisted');
        specPath = join(outputDir, `${safeName}.spec.ts`);
    }
    // SECURITY: Prevent path traversal — resolved path must be within testsRoot
    const resolved = resolve(specPath);
    const resolvedRoot = resolve(testsRoot);
    if (!resolved.startsWith(resolvedRoot + '/') && resolved !== resolvedRoot) {
        throw new Error(`Path traversal blocked: ${specPath} resolves outside testsRoot`);
    }
    if (!resolved.endsWith('.spec.ts') && !resolved.endsWith('.test.ts')) {
        throw new Error(`Invalid spec path: must end in .spec.ts or .test.ts`);
    }
    return specPath;
}

async function generateInitialSpec(
    provider: LLMProvider,
    scenario: ScenarioInput,
    specPath: string,
    apiSurfaceHint: string,
): Promise<string | null> {
    const prompt = buildGeneratePrompt(scenario, apiSurfaceHint);
    const response = await provider.generateText(prompt, {
        maxTokens: 8000,
        temperature: 0.1,
        timeout: 60000,
        systemPrompt: 'You are an expert Playwright test writer for Mattermost. Return only TypeScript code.',
    });

    // Reuse existing parsing logic from prompts/generation.ts
    const parsed = parseGenerationResponse(response.text, specPath, 'create_spec', scenario.id);
    return parsed?.code ?? null;
}

async function runSingleScenario(
    scenario: ScenarioInput,
    options: AgenticRunOptions,
): Promise<AgenticResult> {
    const {config, provider} = options;
    const warnings: string[] = [];
    const specPath = resolveSpecPath(scenario, config.testsRoot);

    // Build API surface hint
    let apiHint = options.apiSurfaceHint || '';
    if (!apiHint && options.apiSurface) {
        const allClassNames = options.apiSurface.pageObjects.map((po) => po.className);
        apiHint = formatApiSurfaceForPrompt(options.apiSurface, allClassNames);
    }

    // Step 1: Generate initial spec
    let specCode: string | null;
    try {
        specCode = await generateInitialSpec(provider, scenario, specPath, apiHint);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        warnings.push(`Generation failed for ${scenario.id}: ${msg}`);
        return {specPath, scenarioSource: scenario.id, status: 'failed', attempts: 0, warnings};
    }

    if (!specCode) {
        warnings.push(`LLM returned invalid code for ${scenario.id}`);
        return {specPath, scenarioSource: scenario.id, status: 'failed', attempts: 0, warnings};
    }

    // Write the spec file
    const dir = dirname(specPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, {recursive: true});
    }
    writeFileSync(specPath, specCode, 'utf-8');

    // Dry run: skip execution
    if (config.dryRun) {
        return {specPath, scenarioSource: scenario.id, status: 'skipped', attempts: 0, warnings};
    }

    // Step 2: Run → Fix loop
    let lastRun: PlaywrightRunResult | undefined;
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
        lastRun = runPlaywrightSpec(specPath, config.testsRoot, {
            project: config.project,
            baseUrl: config.baseUrl,
            timeoutMs: config.testTimeoutMs,
        });

        // All passed!
        if (lastRun.failed === 0 && lastRun.compiled) {
            return {
                specPath,
                scenarioSource: scenario.id,
                status: 'passed',
                attempts: attempt,
                finalRun: lastRun,
                warnings,
            };
        }

        // If this is the last attempt, don't try to fix
        if (attempt >= config.maxAttempts) {
            break;
        }

        // Step 3: Fix
        const currentCode = readFileSync(specPath, 'utf-8');
        try {
            const fixResult = await generateFix(provider, {
                specCode: currentCode,
                failures: lastRun.failures,
                attempt,
                maxAttempts: config.maxAttempts,
                apiSurfaceHint: apiHint,
            });

            if (fixResult.code) {
                writeFileSync(specPath, fixResult.code, 'utf-8');
            } else {
                warnings.push(`Fix attempt ${attempt} returned invalid code for ${scenario.id}`);
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            warnings.push(`Fix attempt ${attempt} failed for ${scenario.id}: ${msg}`);
        }
    }

    return {
        specPath,
        scenarioSource: scenario.id,
        status: lastRun?.compiled === false ? 'compile-error' : 'max-attempts',
        attempts: config.maxAttempts,
        finalRun: lastRun,
        warnings,
    };
}

export async function runAgenticGeneration(options: AgenticRunOptions): Promise<AgenticSummary> {
    const startTime = Date.now();
    const results: AgenticResult[] = [];
    const warnings: string[] = [];

    for (const scenario of options.scenarios) {
        const result = await runSingleScenario(scenario, options);
        results.push(result);
        warnings.push(...result.warnings);
    }

    const totalPassed = results.filter((r) => r.status === 'passed').length;
    const totalFailed = results.filter((r) => r.status !== 'passed' && r.status !== 'skipped').length;
    const totalAttempts = results.reduce((sum, r) => sum + r.attempts, 0);

    return {
        results,
        totalGenerated: results.length,
        totalPassed,
        totalFailed,
        totalAttempts,
        durationMs: Date.now() - startTime,
        warnings,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/agentic_runner.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agentic/runner.ts test/agentic_runner.test.js
git commit -m "feat: add agentic runner with generate-run-fix loop"
```

---

## Chunk 4: CLI Integration + Exports

### Task 5: Add `generate` command to CLI

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/index.ts`

Wire the agentic runner into the CLI as a `generate` command that reads scenarios from the plan report or accepts them inline.

- [ ] **Step 1: Add imports, `generate` command type, and ParsedArgs**

First, update the `fs` import at line 5 of `src/cli.ts`:
```typescript
// BEFORE:
import {appendFileSync, existsSync, readFileSync} from 'fs';
// AFTER:
import {appendFileSync, existsSync, readFileSync, writeFileSync} from 'fs';
```

Add new imports at the top of `src/cli.ts`:
```typescript
import {LLMProviderFactory} from './provider_factory.js';
import {runAgenticGeneration, type ScenarioInput} from './agentic/runner.js';
import {loadOrBuildApiSurface} from './knowledge/api_surface.js';
```

Update the Command type (around line 23):

```typescript
type Command =
    'impact'
    | 'plan'
    | 'heal'
    | 'suggest'
    | 'generate'                    // ADD THIS
    | 'finalize-generated-tests'
    | 'feedback'
    | 'traceability-capture'
    | 'traceability-ingest'
    | 'analyze'
    | 'llm-health';
```

Add to `ParsedArgs` (around line 35):

```typescript
    maxAttempts?: number;
    generateScenarios?: string;  // JSON string or path to plan-report.json
```

- [ ] **Step 2: Add argument parsing for `generate`**

In the `parseArgs` function, add cases for the new flags:

```typescript
        if (arg === '--max-attempts') {
            parsed.maxAttempts = parseInt(args[++i], 10);
            continue;
        }
        if (arg === '--scenarios') {
            parsed.generateScenarios = args[++i];
            continue;
        }
```

- [ ] **Step 3: Add the `generate` command handler**

Add imports at top of `cli.ts`:

```typescript
import {runAgenticGeneration, type ScenarioInput} from './agentic/runner.js';
import {loadOrBuildApiSurface} from './knowledge/api_surface.js';
```

Add the command handler block (after the existing `plan` command block):

```typescript
    if (args.command === 'generate') {
        const reportRoot = config.testsRoot || config.path;

        // Load scenarios from plan report or --scenarios flag
        let scenarios: ScenarioInput[] = [];

        if (args.generateScenarios) {
            // Try as file path first, then as JSON
            let raw: unknown;
            if (existsSync(args.generateScenarios)) {
                raw = JSON.parse(readFileSync(args.generateScenarios, 'utf-8'));
            } else {
                raw = JSON.parse(args.generateScenarios);
            }
            // Validate scenario shape
            if (!Array.isArray(raw)) {
                console.error('--scenarios must be a JSON array of ScenarioInput objects.');
                process.exit(1);
            }
            for (const item of raw) {
                if (!item.id || !item.name || !Array.isArray(item.scenarios) || !item.routeFamily || !item.priority) {
                    console.error(`Invalid scenario: each must have id, name, scenarios[], routeFamily, priority. Got: ${JSON.stringify(item).slice(0, 200)}`);
                    process.exit(1);
                }
            }
            scenarios = raw as ScenarioInput[];
        } else {
            // Load from plan-report.json
            const planReportPath = join(reportRoot, '.e2e-ai-agents', 'plan-report.json');
            if (!existsSync(planReportPath)) {
                console.error('No plan report found. Run `plan` first or pass --scenarios.');
                process.exit(1);
            }
            const planReport = JSON.parse(readFileSync(planReportPath, 'utf-8'));
            // Convert plan gaps to ScenarioInput
            scenarios = (planReport.gapDetails || []).map((gap: {id: string; reasons: string[]; missingScenarios: string[]}) => ({
                id: gap.id,
                name: gap.id,
                scenarios: gap.missingScenarios || gap.reasons || ['Verify core user flow'],
                routeFamily: gap.id.split('.')[0] || gap.id,
                priority: 'P1',
            }));
        }

        if (scenarios.length === 0) {
            console.log('No scenarios to generate tests for.');
            return;
        }

        // Load API surface
        let apiSurface;
        try {
            apiSurface = loadOrBuildApiSurface(reportRoot, config.apiSurface);
        } catch {
            console.warn('Could not load API surface catalog. Generation will use generic selectors.');
        }

        // Create provider
        const provider = await LLMProviderFactory.createFromEnv();

        console.log(`Generating tests for ${scenarios.length} scenario(s)...`);

        const summary = await runAgenticGeneration({
            scenarios,
            config: {
                maxAttempts: args.maxAttempts || 3,
                project: args.pipelineProject || 'chrome',
                baseUrl: args.pipelineBaseUrl,
                testTimeoutMs: 120000,
                testsRoot: reportRoot,
                dryRun: args.dryRun,
            },
            provider,
            apiSurface,
        });

        // Print summary
        console.log(`\nAgentic Generation Summary:`);
        console.log(`  Generated: ${summary.totalGenerated}`);
        console.log(`  Passed:    ${summary.totalPassed}`);
        console.log(`  Failed:    ${summary.totalFailed}`);
        console.log(`  Attempts:  ${summary.totalAttempts}`);
        console.log(`  Duration:  ${(summary.durationMs / 1000).toFixed(1)}s`);

        for (const result of summary.results) {
            const icon = result.status === 'passed' ? '✅' : result.status === 'skipped' ? '⏭' : '❌';
            console.log(`  ${icon} ${result.scenarioSource} → ${result.status} (${result.attempts} attempts)`);
            if (result.status === 'passed' || result.status === 'skipped') {
                console.log(`     ${result.specPath}`);
            }
        }

        if (summary.warnings.length > 0) {
            console.log(`\nWarnings:`);
            for (const w of summary.warnings) {
                console.warn(`  - ${w}`);
            }
        }

        // Write summary report
        const summaryPath = join(reportRoot, '.e2e-ai-agents', 'agentic-summary.json');
        writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
        console.log(`\nReport: ${summaryPath}`);

        if (summary.totalFailed > 0) {
            process.exit(1);
        }
        return;
    }
```

- [ ] **Step 4: Add to help text**

In `printUsage`, add:

```typescript
'',
'  generate                       Generate Playwright tests from scenarios (agentic loop)',
'    --scenarios <path|json>      Scenarios file or inline JSON (default: reads plan-report.json)',
'    --max-attempts <n>           Max fix attempts per scenario (default: 3)',
'    --dry-run                    Generate specs without running tests',
```

- [ ] **Step 5: Export from index.ts**

In `src/index.ts`, add:

```typescript
// Agentic generation
export {runAgenticGeneration} from './agentic/runner.js';
export type {ScenarioInput, AgenticRunOptions} from './agentic/runner.js';
export type {AgenticConfig, AgenticResult, AgenticSummary, PlaywrightRunResult, TestFailure} from './agentic/types.js';
```

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Run all existing tests**

Run: `node --test`
Expected: All tests pass (no regressions)

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts src/index.ts
git commit -m "feat: add generate CLI command with agentic test generation"
```

---

## Chunk 5: End-to-End Smoke Test + Version Bump

### Task 6: Manual integration verification

This is a manual step to verify the full flow works end-to-end.

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: PASS — no TypeScript errors

- [ ] **Step 2: Run all unit tests**

Run: `node --test`
Expected: All tests pass

- [ ] **Step 3: Dry-run test with inline scenarios**

Run the generate command in dry-run mode with a sample scenario:

```bash
node dist/cli.js generate \
  --config /Users/yasserkhan/Documents/mattermost/mattermost/e2e-tests/playwright/e2e-ai-agents.config.json \
  --dry-run \
  --scenarios '[{"id":"smoke-test","name":"Smoke Test","scenarios":["Verify user can post a message"],"routeFamily":"channels","priority":"P0"}]'
```

Expected: A spec file is written to `specs/functional/ai-assisted/smoke-test.spec.ts` but no Playwright execution happens.

- [ ] **Step 4: Verify generated spec quality**

Read the generated spec and check:
- Copyright header present
- Import from `@mattermost/playwright-lib`
- `pw.initSetup()` called
- `pw.testBrowser.login()` called
- Tag `@channels` present
- Uses page object methods (not raw selectors)

- [ ] **Step 5: Commit any fixes from integration testing**

```bash
git add -A
git commit -m "fix: integration test fixes for agentic generation"
```

---

### Task 7: Version bump and publish

- [ ] **Step 1: Bump version**

```bash
npm version minor --no-git-tag-version
```

This bumps to 0.8.0.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `node --test`
Expected: All tests pass

- [ ] **Step 4: Commit, tag, push**

```bash
git add -A
git commit -m "feat: v0.8.0 — agentic test generation with generate-run-fix loop"
git push origin codex/feature-impact-analysis-e2e
git tag v0.8.0
git push origin v0.8.0
```

- [ ] **Step 5: Update mattermost lockfile**

```bash
cd /Users/yasserkhan/Documents/mattermost/mattermost/e2e-tests/playwright
npm install @yasserkhanorg/e2e-agents@0.8.0
cd ../..
git add e2e-tests/playwright/package.json e2e-tests/playwright/package-lock.json
git commit -m "e2e: update @yasserkhanorg/e2e-agents to 0.8.0"
git push origin feature-impact-analysis-e2e
```

---

## Design Decisions

### Why a generate→run→fix loop instead of generate-once?

LLM-generated tests fail ~60-70% of the time on first attempt due to:
- Hallucinated page object methods
- Wrong selectors (element doesn't exist or changed)
- Missing waits for async UI state
- Wrong assertion patterns

The fix loop dramatically improves success rate because the LLM gets concrete error messages ("Expected element to be visible but got: hidden") which ground its next attempt. 3 attempts typically achieves ~85% pass rate vs ~35% for single-shot.

### Why not use Playwright MCP tools for every test?

Browser exploration via MCP (`browser_navigate`, `browser_snapshot`) is slow (~5s per interaction) and expensive. For most tests, the API surface catalog (page objects + methods) provides sufficient context. MCP exploration is reserved for future enhancement when:
- A method is suspected hallucinated (fall back to MCP to discover real selectors)
- The test targets UI that isn't in the page object catalog
- Selector discovery is needed for new UI components

### Why sequential scenario execution (not parallel)?

Playwright test runs share Mattermost server state. Parallel generation + execution could cause:
- Port conflicts on test server
- Database state interference
- Non-deterministic test results

Sequential is safer for v0.8.0. Parallel execution (via separate Playwright projects or server instances) can be added later.

### Cost estimate

- Generation: ~$0.02/scenario (one LLM call, ~3K input, ~2K output)
- Fix attempt: ~$0.015/attempt (similar token count)
- Average scenario: 1 generation + 1.5 fixes = ~$0.04
- 10 scenarios/PR: ~$0.40
- Monthly (500 PRs, 3 scenarios avg): ~$600

This is higher than the plan command ($5/month) but produces actual working test code, not just analysis.

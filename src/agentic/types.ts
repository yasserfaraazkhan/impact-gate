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

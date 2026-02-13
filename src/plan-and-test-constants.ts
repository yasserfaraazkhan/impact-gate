// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Centralized constants for plan-and-test command
 * Eliminates magic strings and hardcoded values
 * Makes configuration easy to modify and maintain
 */

export const PLANNING_CONFIG = {
    // Number of test scenarios per priority level
    SCENARIO_COUNTS: {
        P0: 3,
        P1: 2,
        P2: 1,
    } as const,

    // Default parameter values
    DEFAULTS: {
        MAX_TESTS: 10,
        COVERAGE_THRESHOLD: 50,
        PRIORITY_FILTER: ['P0', 'P1'],
    } as const,

    // Limit constraints
    LIMITS: {
        MIN_MAX_TESTS: 1,
        MAX_MAX_TESTS: 100,
        MIN_COVERAGE_THRESHOLD: 0,
        MAX_COVERAGE_THRESHOLD: 100,
    } as const,
} as const;

/**
 * Display messages for plan-and-test command
 */
export const PLAN_AND_TEST_MESSAGES = {
    HEADER: {
        MAIN: '🚀 Planning and Generating Tests',
        STEP_1_ANALYSIS: '📊 Step 1: Analyzing Code Changes...',
        STEP_2_PLANNING: '💡 Step 2: Planning Test Generation...',
        STEP_3_GENERATION: '⚡ Step 3: Generating Tests...',
        STEP_4_SUMMARY: '📈 Generation Summary',
        FOUND_FLOW_GROUPS: (count: number) => `📦 Found ${count} flow groups (end-to-end journeys):`,
    },

    ANALYSIS: {
        FOUND_FLOWS: (count: number) => `✓ Found ${count} affected flows`,
        MORE_FLOWS: (count: number) => `  ... and ${count} more`,
        FOUND_FLOW_GROUPS: (count: number) => `📦 Found ${count} flow groups (end-to-end journeys)`,
    },

    PLANNING: {
        PLAN_CREATED: (count: number) => `✓ Plan created: ${count} flows to test`,
        SKIPPING_COUNT: (count: number) => `⊘ Skipping ${count} flows:`,
    },

    SKIP_REASONS: {
        MAX_LIMIT_REACHED: (limit: number) => `Max tests limit reached (${limit})`,
        ALREADY_COVERED: (count: number) => `Already covered (${count} existing tests)`,
    },

    COVERAGE_REASONS: {
        NO_COVERAGE: (priority: string) => `${priority} - no coverage`,
        PARTIAL_COVERAGE: (priority: string, gaps: number) => `${priority} - partial coverage (${gaps} gaps)`,
    },

    EXECUTION: {
        TEST_COUNT: (index: number, total: number) => `[${index}/${total}]`,
        GENERATION_FAILED: (error: string) => `  ⚠️ Generation failed: ${error}`,
        DRY_RUN_MODE: '📋 DRY RUN: Not executing. Run without --dry-run to generate tests.',
    },

    SUMMARY: {
        SEPARATOR: '═'.repeat(50),
        TOTAL_GENERATED: (count: number) => `Total Tests Generated: ${count}`,
        SUCCESSFUL: (successful: number, total: number) => `Successful: ${successful}/${total}`,
        TOTAL_SCENARIOS: (count: number) => `Total Scenarios: ${count}`,
        COMPLETION: '✅ Execution complete!',
    },

    NEXT_STEPS: [
        '  • Run tests: npx playwright test --grep @smoke',
        '  • Re-run impact: npx e2e-ai-agents impact --path <app-root> --tests-root <tests-root>',
        '  • Check coverage: npm run test:impact',
    ],

    ERRORS: {
        INVALID_PRIORITY: (priorities: string[]) => `Invalid priority levels: ${priorities.join(', ')}`,
        INVALID_MAX_TESTS: (min: number, max: number) => `maxTests must be between ${min} and ${max}`,
        INVALID_COVERAGE_THRESHOLD: (min: number, max: number) => `coverageThreshold must be between ${min} and ${max}`,
        NO_CHANGES_DETECTED: '✓ No significant changes detected',
    },
} as const;

/**
 * Priority levels in the system
 */
export const PRIORITY_LEVELS = {
    CRITICAL: 'P0',
    HIGH: 'P1',
    MEDIUM: 'P2',
} as const;

/**
 * Test strategy types for flow groups
 */
export const TEST_STRATEGIES = {
    SEQUENTIAL: 'sequential',
    PARALLEL: 'parallel',
    MIXED: 'mixed',
} as const;

/**
 * Flow group types
 */
export const FLOW_GROUP_TYPES = {
    MESSAGING_LIFECYCLE: 'messaging-lifecycle',
    CHANNEL_MANAGEMENT: 'channel-management',
    MESSAGING_INTERACTIONS: 'messaging-interactions',
} as const;

/**
 * Utility function to get scenario count for a priority
 * Provides type-safe access to scenario counts
 */
export function getScenarioCount(priority: string): number {
    const normalizedPriority = priority.toUpperCase();
    return (
        PLANNING_CONFIG.SCENARIO_COUNTS[
            normalizedPriority as keyof typeof PLANNING_CONFIG.SCENARIO_COUNTS
        ] || PLANNING_CONFIG.SCENARIO_COUNTS.P1
    );
}

/**
 * Utility function to validate priority level
 */
export function isValidPriority(priority: string): boolean {
    const validPriorities = Object.values(PRIORITY_LEVELS);
    return validPriorities.includes(priority.toUpperCase() as any);
}

/**
 * Utility function to get all valid priority levels
 */
export function getValidPriorities(): string[] {
    return Object.values(PRIORITY_LEVELS);
}

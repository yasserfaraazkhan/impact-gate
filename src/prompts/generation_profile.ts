// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Dynamic generation profile — replaces hardcoded Mattermost references with
 * project-specific configuration. Enables impact-gate to generate tests for any project.
 */

import type {KnowledgeGraph} from '../knowledge/kg_types.js';
import type {TestType} from '../knowledge/route_families.js';
import {UI_FRAMEWORKS, API_FRAMEWORKS} from '../adapters/framework_adapter.js';

export interface GenerationProfile {
    projectName: string;
    testFramework: string;
    importStatement: string;
    conventions: string[];
    copyrightHeader?: string;
    testMode: TestType;
}

const MATTERMOST_PROFILE: GenerationProfile = {
    projectName: 'Mattermost',
    testFramework: 'Playwright',
    importStatement: '@mattermost/playwright-lib',
    conventions: [
        'Import ONLY from "@mattermost/playwright-lib" — no other test framework imports.',
        'Every test must call `await pw.initSetup()` first.',
        'Use `await pw.testBrowser.login(user)` to log in — never hardcode credentials.',
        'Use `expect` from "@mattermost/playwright-lib" — do NOT import from "@playwright/test".',
        'Include the copyright header for new files.',
    ],
    copyrightHeader: [
        '// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.',
        '// See LICENSE.txt for license information.',
    ].join('\n'),
    testMode: 'ui',
};

const DEFAULT_PLAYWRIGHT_PROFILE: GenerationProfile = {
    projectName: 'Project',
    testFramework: 'Playwright',
    importStatement: '@playwright/test',
    conventions: [
        'Import from "@playwright/test" for test and expect.',
        'Use page fixtures provided by Playwright.',
        'Prefer ARIA roles and data-testid attributes for selectors.',
        'Write one test per scenario with a descriptive name.',
    ],
    testMode: 'ui',
};

const DEFAULT_API_PROFILE: GenerationProfile = {
    projectName: 'Project',
    testFramework: 'vitest + supertest',
    importStatement: 'vitest',
    conventions: [
        'Import from "vitest" for test and expect.',
        'Use supertest for HTTP request assertions.',
        'Validate response status codes, headers, and body structure.',
        'Test both success and error paths for each endpoint.',
    ],
    testMode: 'api',
};

/**
 * Resolves the generation profile from config and optional KG metadata.
 * - If profile='mattermost' or Mattermost is detected, returns Mattermost profile.
 * - If KG is present, derives project-specific profile from it.
 * - Otherwise, returns generic Playwright profile.
 */
export function resolveGenerationProfile(
    config?: {profile?: string; testMode?: TestType},
    kg?: KnowledgeGraph | null,
): GenerationProfile {
    // Explicit Mattermost profile
    if (config?.profile === 'mattermost') {
        return {...MATTERMOST_PROFILE};
    }

    // KG-based profile derivation
    if (kg) {
        const frameworks = kg.project.frameworks.map((f) => f.toLowerCase());
        const isMattermost = kg.project.name.toLowerCase().includes('mattermost') ||
            frameworks.includes('@mattermost/playwright-lib');

        if (isMattermost) {
            return {...MATTERMOST_PROFILE};
        }

        const testMode = config?.testMode || deriveTestMode(frameworks);
        const testFramework = deriveTestFramework(frameworks, testMode);
        const importStatement = deriveImportStatement(frameworks, testMode);

        return {
            projectName: kg.project.name || 'Project',
            testFramework,
            importStatement,
            conventions: buildConventions(testFramework, importStatement, testMode),
            testMode,
        };
    }

    // Default profiles based on test mode
    if (config?.testMode === 'api') {
        return {...DEFAULT_API_PROFILE};
    }

    return {...DEFAULT_PLAYWRIGHT_PROFILE};
}

/**
 * Checks if a profile is the Mattermost profile (for backward compatibility checks).
 */
export function isMattermostProfile(profile: GenerationProfile): boolean {
    return profile.importStatement === '@mattermost/playwright-lib';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function deriveTestMode(frameworks: string[]): TestType {
    const uiSet = new Set<string>(UI_FRAMEWORKS);
    const apiSet = new Set<string>(API_FRAMEWORKS);
    const hasUiFramework = frameworks.some((f) => uiSet.has(f));
    const hasApiFramework = frameworks.some((f) => apiSet.has(f));

    if (hasUiFramework && hasApiFramework) return 'both';
    if (hasApiFramework && !hasUiFramework) return 'api';
    return 'ui';
}

function deriveTestFramework(frameworks: string[], testMode: TestType): string {
    if (testMode === 'api') {
        if (frameworks.includes('pytest')) return 'pytest';
        if (frameworks.includes('jest')) return 'jest + supertest';
        return 'vitest + supertest';
    }
    if (frameworks.includes('cypress')) return 'Cypress';
    if (frameworks.includes('selenium')) return 'Selenium';
    return 'Playwright';
}

function deriveImportStatement(frameworks: string[], testMode: TestType): string {
    if (testMode === 'api') {
        if (frameworks.includes('pytest')) return 'pytest';
        if (frameworks.includes('jest')) return 'jest';
        return 'vitest';
    }
    if (frameworks.includes('cypress')) return 'cypress';
    return '@playwright/test';
}

function buildConventions(testFramework: string, importStatement: string, testMode: TestType): string[] {
    const conventions: string[] = [];

    if (testMode === 'api' || testMode === 'both') {
        conventions.push(`Import from "${importStatement}" for test and expect.`);
        conventions.push('Validate response status codes, headers, and body structure.');
        conventions.push('Test both success and error paths for each endpoint.');
    }

    if (testMode === 'ui' || testMode === 'both') {
        if (testFramework.includes('Playwright')) {
            conventions.push('Import from "@playwright/test" for test and expect.');
            conventions.push('Use page fixtures provided by Playwright.');
        } else if (testFramework.includes('Cypress')) {
            conventions.push('Use cy.* commands for browser interaction.');
        }
        conventions.push('Prefer ARIA roles and data-testid attributes for selectors.');
    }

    conventions.push('Write one test per scenario with a descriptive name of what the user does and what is verified.');
    conventions.push('NEVER fabricate test IDs. Use descriptive names only.');

    return conventions;
}

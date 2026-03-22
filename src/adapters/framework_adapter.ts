// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Framework Adapter Interface — abstracts test-framework-specific logic
 * behind a uniform contract so the rest of the pipeline is framework-agnostic.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {PlaywrightAdapter} from './playwright.js';
import {CypressAdapter} from './cypress.js';
import {SupertestAdapter} from './supertest.js';
import {PytestAdapter} from './pytest.js';
import type {KnowledgeGraph} from '../knowledge/kg_types.js';
import type {TestType} from '../knowledge/route_families.js';

/** Shared framework name lists used for test-mode detection across the codebase. */
export const UI_FRAMEWORKS = ['playwright', '@playwright/test', 'cypress', 'selenium'] as const;
export const API_FRAMEWORKS = ['supertest', 'pytest', 'requests', 'vitest', 'jest'] as const;

export interface RunOptions {
    headed?: boolean;
    browser?: string;
    project?: string;
    timeout?: number;
}

export interface RunCommand {
    executable: string;
    args: string[];
}

export interface FrameworkAdapter {
    /** Human-readable framework identifier (e.g. 'playwright', 'cypress'). */
    name: string;

    /** Return true when `projectRoot` appears to use this framework. */
    detect(projectRoot: string): boolean;

    /** Glob that matches spec files for this framework. */
    specGlob: string;

    /** Regex that extracts test blocks from source text. */
    extractTestPattern: RegExp;

    /** Possible config file names to look for at the project root. */
    configFileNames: string[];

    /** Build a structured command to execute a single spec file. */
    buildRunCommand(specPath: string, options?: RunOptions): RunCommand;
}

/**
 * Auto-detect which test framework a project uses by inspecting its
 * package.json dependencies.  Falls back to Playwright when detection
 * is inconclusive.
 */
export function detectFramework(projectRoot: string): FrameworkAdapter {
    const pkgPath = path.join(projectRoot, 'package.json');

    if (fs.existsSync(pkgPath)) {
        try {
            const raw = fs.readFileSync(pkgPath, 'utf-8');
            const pkg = JSON.parse(raw) as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            };

            const allDeps = {
                ...pkg.dependencies,
                ...pkg.devDependencies,
            };

            if ('@playwright/test' in allDeps) {
                return new PlaywrightAdapter();
            }

            if ('cypress' in allDeps) {
                return new CypressAdapter();
            }

            // Backend API test frameworks
            if ('supertest' in allDeps) {
                const runner = 'vitest' in allDeps ? 'vitest' : 'jest';
                return new SupertestAdapter(runner);
            }
        } catch {
            // Malformed package.json — fall through to default.
        }
    }

    // Check for Python project
    const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
        try {
            const content = fs.readFileSync(pyprojectPath, 'utf-8');
            if (content.includes('pytest')) {
                return new PytestAdapter();
            }
        } catch {
            // fall through
        }
    }

    // Default to Playwright when we cannot determine the framework.
    return new PlaywrightAdapter();
}

/**
 * Detect the test mode for a project: UI testing, API testing, or both.
 * Uses package.json / pyproject.toml dependencies and optional KG metadata.
 */
export function detectTestMode(projectRoot: string, kg?: KnowledgeGraph | null): TestType {
    // If KG provides framework hints, use them
    if (kg) {
        const frameworks = kg.project.frameworks.map((f) => f.toLowerCase());
        const uiSet = new Set<string>(UI_FRAMEWORKS);
        const apiSet = new Set<string>(API_FRAMEWORKS);
        const hasUi = frameworks.some((f) => uiSet.has(f));
        const hasApi = frameworks.some((f) => apiSet.has(f));
        if (hasUi && hasApi) return 'both';
        if (hasApi) return 'api';
        if (hasUi) return 'ui';
    }

    // Fall back to package.json inspection
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const raw = fs.readFileSync(pkgPath, 'utf-8');
            const pkg = JSON.parse(raw) as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            };
            const allDeps = {...pkg.dependencies, ...pkg.devDependencies};

            const hasUi = '@playwright/test' in allDeps || 'cypress' in allDeps;
            const hasApi = 'supertest' in allDeps;

            if (hasUi && hasApi) return 'both';
            if (hasApi) return 'api'; // supertest alone means API-only when no UI framework is present
        } catch {
            // fall through
        }
    }

    // Check for Python API testing
    const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
        try {
            const content = fs.readFileSync(pyprojectPath, 'utf-8');
            if (content.includes('pytest') && !fs.existsSync(path.join(projectRoot, 'package.json'))) {
                return 'api';
            }
        } catch {
            // fall through
        }
    }

    return 'ui';
}

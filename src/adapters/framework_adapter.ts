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

export interface RunOptions {
    headed?: boolean;
    browser?: string;
    project?: string;
    timeout?: number;
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

    /** Build a CLI command string to execute a single spec file. */
    buildRunCommand(specPath: string, options?: RunOptions): string;
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
        } catch {
            // Malformed package.json — fall through to default.
        }
    }

    // Default to Playwright when we cannot determine the framework.
    return new PlaywrightAdapter();
}

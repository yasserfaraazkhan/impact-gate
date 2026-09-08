// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Playwright Adapter — FrameworkAdapter implementation for @playwright/test.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {FrameworkAdapter, RunCommand, RunOptions} from './framework_adapter.js';

export class PlaywrightAdapter implements FrameworkAdapter {
    readonly name = 'playwright';

    readonly specGlob = '**/*.{spec,test}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}';

    readonly extractTestPattern = /\btest(?:\.describe)?\s*\(/g;

    readonly configFileNames = ['playwright.config.ts', 'playwright.config.js'];

    detect(projectRoot: string): boolean {
        const pkgPath = path.join(projectRoot, 'package.json');
        if (!fs.existsSync(pkgPath)) {
            return false;
        }

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

            return '@playwright/test' in allDeps;
        } catch {
            return false;
        }
    }

    buildRunCommand(specPath: string, options?: RunOptions): RunCommand {
        const args = ['playwright', 'test', specPath];

        if (options?.headed) {
            args.push('--headed');
        }

        if (options?.browser) {
            args.push('--browser', options.browser);
        }

        if (options?.project) {
            args.push('--project', options.project);
        }

        if (options?.timeout != null) {
            args.push('--timeout', String(options.timeout));
        }

        return {executable: 'npx', args};
    }
}

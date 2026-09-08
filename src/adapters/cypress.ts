// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Cypress Adapter — FrameworkAdapter implementation for Cypress.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {FrameworkAdapter, RunCommand, RunOptions} from './framework_adapter.js';

export class CypressAdapter implements FrameworkAdapter {
    readonly name = 'cypress';

    readonly specGlob = '**/*{.cy,_spec}.{ts,js,tsx,jsx}';

    readonly extractTestPattern = /\b(?:it|describe|context)\s*\(/g;

    readonly configFileNames = ['cypress.config.ts', 'cypress.config.js'];

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

            return 'cypress' in allDeps;
        } catch {
            return false;
        }
    }

    buildRunCommand(specPath: string, options?: RunOptions): RunCommand {
        const args = ['cypress', 'run', '--spec', specPath];

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
            args.push('--config', `defaultCommandTimeout=${options.timeout}`);
        }

        return {executable: 'npx', args};
    }
}

// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Supertest + Vitest/Jest adapter for Node.js API testing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {FrameworkAdapter, RunCommand, RunOptions} from './framework_adapter.js';

export class SupertestAdapter implements FrameworkAdapter {
    name = 'supertest';
    specGlob = '**/*.{test,spec}.{ts,js}';
    extractTestPattern = /(?:it|test)\s*\(\s*(['"`])(.*?)\1/g;
    configFileNames = ['vitest.config.ts', 'vitest.config.js', 'jest.config.ts', 'jest.config.js'];

    private runner: 'vitest' | 'jest';

    constructor(runner: 'vitest' | 'jest' = 'vitest') {
        this.runner = runner;
    }

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

            return 'supertest' in allDeps;
        } catch {
            return false;
        }
    }

    buildRunCommand(specPath: string, options?: RunOptions): RunCommand {
        if (this.runner === 'jest') {
            const args = ['jest', specPath];
            if (options?.timeout) {
                args.push(`--testTimeout=${options.timeout}`);
            }
            return {executable: 'npx', args};
        }

        const args = ['vitest', 'run', specPath];
        if (options?.timeout) {
            args.push(`--testTimeout=${options.timeout}`);
        }
        return {executable: 'npx', args};
    }
}

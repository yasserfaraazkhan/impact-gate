// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Pytest adapter for Python API testing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {FrameworkAdapter, RunCommand, RunOptions} from './framework_adapter.js';

export class PytestAdapter implements FrameworkAdapter {
    name = 'pytest';
    specGlob = '**/test_*.py';
    extractTestPattern = /def\s+(test_\w+)/g;
    configFileNames = ['pytest.ini', 'pyproject.toml', 'setup.cfg', 'conftest.py'];

    detect(projectRoot: string): boolean {
        // Check for common pytest indicator files
        const indicators = ['pyproject.toml', 'pytest.ini', 'conftest.py', 'setup.cfg'];
        for (const file of indicators) {
            const filePath = path.join(projectRoot, file);
            if (!fs.existsSync(filePath)) continue;

            // For setup.cfg, only match if it contains a [tool:pytest] or [pytest] section
            if (file === 'setup.cfg') {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    if (content.includes('[tool:pytest]') || content.includes('[pytest]')) {
                        return true;
                    }
                } catch {
                    continue;
                }
            } else if (file === 'pyproject.toml') {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    if (content.includes('pytest')) {
                        return true;
                    }
                } catch {
                    continue;
                }
            } else {
                // pytest.ini or conftest.py existence is sufficient
                return true;
            }
        }
        return false;
    }

    buildRunCommand(specPath: string, options?: RunOptions): RunCommand {
        const args = ['-m', 'pytest', specPath, '-v'];
        if (options?.timeout) {
            args.push(`--timeout=${Math.ceil(options.timeout / 1000)}`);
        }
        return {executable: 'python', args};
    }
}

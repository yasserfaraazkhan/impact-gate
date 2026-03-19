// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import {execFileSync} from 'child_process';
import {join, resolve} from 'path';

import type {FrameworkType} from '../agent/config.js';

export interface ResolvedDefaults {
    path: string;
    testsRoot: string;
    framework: FrameworkType;
    since: string;
}

/**
 * Detect the test framework from package.json dependencies.
 */
export function detectFramework(appPath: string): FrameworkType {
    const resolvedPath = resolve(appPath);
    const pkgPath = join(resolvedPath, 'package.json');
    if (!existsSync(pkgPath)) {
        return 'auto';
    }
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const allDeps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {})};
        if (allDeps['@playwright/test'] || allDeps.playwright) {
            return 'playwright';
        }
        if (allDeps.cypress) {
            return 'cypress';
        }
        if (allDeps['selenium-webdriver'] || allDeps.webdriverio) {
            return 'selenium';
        }
    } catch {
        // ignore malformed package.json
    }
    return 'auto';
}

/**
 * Detect the tests root directory by scanning common conventions.
 */
export function detectTestsRoot(appPath: string): string | undefined {
    const resolvedPath = resolve(appPath);
    const candidates = [
        'e2e-tests/playwright',
        'e2e-tests',
        'e2e',
        'tests/e2e',
        'test/e2e',
        'tests',
        'test',
        'specs',
        'playwright',
        'cypress',
    ];
    for (const candidate of candidates) {
        if (existsSync(join(resolvedPath, candidate))) {
            return candidate;
        }
    }
    return undefined;
}

/**
 * Detect the git default branch for diffing.
 * Returns origin/<branch> format.
 */
export function detectGitDefaultBranch(appPath: string): string {
    try {
        // Try to find the remote HEAD branch first
        const remoteInfo = execFileSync('git', ['remote', 'show', 'origin'], {
            cwd: resolve(appPath),
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5000,
        });
        const headMatch = remoteInfo.match(/HEAD branch:\s*(.+)/);
        if (headMatch) {
            return `origin/${headMatch[1].trim()}`;
        }
    } catch {
        // fallback to current branch
    }

    try {
        const result = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: resolve(appPath),
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5000,
        }).trim();
        return `origin/${result}`;
    } catch {
        return 'origin/main';
    }
}

/**
 * Detect the project root by walking up to find package.json or .git.
 */
export function detectProjectRoot(startDir: string): string {
    let current = resolve(startDir);
    while (true) {
        if (existsSync(join(current, 'package.json')) || existsSync(join(current, '.git'))) {
            return current;
        }
        const parent = resolve(current, '..');
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return startDir;
}

/**
 * Resolve defaults for CLI commands that need path/testsRoot/framework/since.
 * Explicit values from CLI flags take precedence over detected values.
 */
export function resolveDefaults(explicit: {
    path?: string;
    testsRoot?: string;
    framework?: FrameworkType;
    gitSince?: string;
}): ResolvedDefaults {
    const path = explicit.path || detectProjectRoot(process.cwd());
    const testsRoot = explicit.testsRoot || detectTestsRoot(path) || '.';
    const framework = explicit.framework || detectFramework(path);
    const since = explicit.gitSince || detectGitDefaultBranch(path);

    return {path, testsRoot, framework, since};
}

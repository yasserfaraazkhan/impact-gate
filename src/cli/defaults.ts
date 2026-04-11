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

function detectPytestFramework(appPath: string): FrameworkType | undefined {
    const resolvedPath = resolve(appPath);
    const pytestIni = join(resolvedPath, 'pytest.ini');
    if (existsSync(pytestIni)) {
        return 'pytest';
    }

    const conftest = join(resolvedPath, 'conftest.py');
    if (existsSync(conftest)) {
        return 'pytest';
    }

    const pyproject = join(resolvedPath, 'pyproject.toml');
    if (existsSync(pyproject)) {
        try {
            const content = readFileSync(pyproject, 'utf-8');
            if (content.includes('pytest')) {
                return 'pytest';
            }
        } catch {
            // ignore malformed or unreadable file
        }
    }

    const setupCfg = join(resolvedPath, 'setup.cfg');
    if (existsSync(setupCfg)) {
        try {
            const content = readFileSync(setupCfg, 'utf-8');
            if (content.includes('[tool:pytest]') || content.includes('[pytest]')) {
                return 'pytest';
            }
        } catch {
            // ignore malformed or unreadable file
        }
    }

    return undefined;
}

/**
 * Detect the test framework from package.json dependencies.
 */
export function detectFramework(appPath: string): FrameworkType {
    const resolvedPath = resolve(appPath);
    const pkgPath = join(resolvedPath, 'package.json');
    if (!existsSync(pkgPath)) {
        const pytestFramework = detectPytestFramework(resolvedPath);
        if (pytestFramework) {
            return pytestFramework;
        }
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
        if (allDeps.supertest) {
            return 'supertest';
        }
        if (allDeps['selenium-webdriver'] || allDeps.webdriverio) {
            return 'selenium';
        }
    } catch {
        // ignore malformed package.json
    }

    const pytestFramework = detectPytestFramework(resolvedPath);
    if (pytestFramework) {
        return pytestFramework;
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
        // Only use current branch if it's a well-known default; local-only branches
        // may not have a remote tracking ref
        if (result === 'main' || result === 'master') {
            return `origin/${result}`;
        }
    } catch {
        // fall through to default
    }
    return 'origin/main';
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

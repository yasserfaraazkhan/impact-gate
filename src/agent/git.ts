// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawnSync} from 'child_process';
import {normalizePath} from './utils.js';

// Directories that contain CI/tooling/docs/tests — never relevant to impact analysis.
const IGNORED_DIR_SEGMENTS = [
    '.github',
    '.claude',
    '.vscode',
    '.idea',
    'node_modules',
    'e2e-tests',
    '__tests__',
    '__mocks__',
    'testlib',
];

// Exact filenames (basename) that are never relevant.
const IGNORED_BASENAMES = new Set([
    'package.json',
    'package-lock.json',
    '.gitignore',
    '.prettierignore',
    '.prettierrc',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.json',
    '.editorconfig',
    '.npmrc',
    '.mcp.json',
    'CHANGELOG.md',
    'README.md',
    'LICENSE',
    'LICENSE.txt',
    'tsconfig.json',
    'jest.config.js',
    'jest.config.ts',
    'babel.config.js',
]);

// Extensions that are never source code.
const IGNORED_EXTENSIONS = new Set([
    '.md',
    '.txt',
    '.lock',
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.eot',
]);

// File patterns that indicate test/spec files (not production code).
const TEST_FILE_PATTERNS = [
    /\.spec\.[tj]sx?$/,
    /\.test\.[tj]sx?$/,
    /_test\.go$/,
    /\.stories\.[tj]sx?$/,
];

// Config file patterns that are not production source code.
const CONFIG_FILE_PATTERNS = [
    /\.config\.[tj]sx?$/,
    /\.config\.json$/,
    /\.config\.js$/,
];

function isRelevantFile(file: string): boolean {
    const segments = file.split('/');
    const basename = segments[segments.length - 1] || file;

    if (IGNORED_BASENAMES.has(basename)) {
        return false;
    }

    for (const seg of segments) {
        if (IGNORED_DIR_SEGMENTS.includes(seg)) {
            return false;
        }
    }

    const dotIdx = basename.lastIndexOf('.');
    if (dotIdx > 0) {
        const ext = basename.slice(dotIdx).toLowerCase();
        if (IGNORED_EXTENSIONS.has(ext)) {
            return false;
        }
    }

    // Filter test/spec files — they don't impact production features
    for (const pattern of TEST_FILE_PATTERNS) {
        if (pattern.test(basename)) {
            return false;
        }
    }

    // Filter config files
    for (const pattern of CONFIG_FILE_PATTERNS) {
        if (pattern.test(basename)) {
            return false;
        }
    }

    return true;
}

export interface GitChangeResult {
    files: string[];
    error?: string;
    baseRef?: string;
    baseStrategy?: 'merge-base' | 'direct';
}

export interface GitChangeOptions {
    includeUncommitted?: boolean;
}

function runGitRaw(args: string[], cwd: string): string | null {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf-8',
        timeout: 30000,
    });
    if (result.error || result.status !== 0) {
        return null;
    }
    return result.stdout;
}

function runGit(args: string[], cwd: string): string[] | null {
    const output = runGitRaw(args, cwd);
    if (output === null) {
        return null;
    }
    return output
        .split('\n')
        .map((file) => file.trim())
        .filter(Boolean)
        .map((file) => normalizePath(file));
}

function parseStatusLines(lines: string[]): string[] {
    const files: string[] = [];
    for (const line of lines) {
        if (!line) continue;
        if (line.length < 4) continue;
        const pathPart = line.slice(3).trim();
        if (!pathPart) continue;
        if (pathPart.includes('->')) {
            const parts = pathPart.split('->').map((part) => part.trim());
            const target = parts[parts.length - 1];
            if (target) {
                files.push(normalizePath(target));
            }
        } else {
            files.push(normalizePath(pathPart));
        }
    }
    return files;
}

export function getChangedFiles(appRoot: string, since: string, options?: GitChangeOptions): GitChangeResult {
    try {
        const files = new Set<string>();
        let baseRef = since;
        let baseStrategy: GitChangeResult['baseStrategy'] = 'direct';
        const mergeBase = runGitRaw(['merge-base', since, 'HEAD'], appRoot);
        if (mergeBase) {
            const candidate = mergeBase
                .split('\n')
                .map((line) => line.trim())
                .find(Boolean);
            if (candidate) {
                baseRef = candidate;
                baseStrategy = 'merge-base';
            }
        }

        // Get repo root so we capture ALL changed files (including server/, webapp/, etc.)
        // not just files under the appRoot subdirectory.
        const repoRoot = runGitRaw(['rev-parse', '--show-toplevel'], appRoot)?.trim() || appRoot;

        const diffFiles = runGit(['diff', '--name-only', `${baseRef}..HEAD`], repoRoot);
        if (!diffFiles) {
            return {files: [], error: 'git diff failed'};
        }
        diffFiles.forEach((file) => files.add(file));

        if (options?.includeUncommitted) {
            const staged = runGit(['diff', '--name-only', '--cached'], repoRoot) || [];
            staged.forEach((file) => files.add(file));
            const unstaged = runGit(['diff', '--name-only'], repoRoot) || [];
            unstaged.forEach((file) => files.add(file));
            const statusOutput = runGitRaw(['status', '--porcelain'], repoRoot);
            if (statusOutput) {
                const statusLines = statusOutput.split('\n').filter(Boolean);
                parseStatusLines(statusLines).forEach((file) => files.add(file));
            }
        }

        return {files: Array.from(files).filter(isRelevantFile), baseRef, baseStrategy};
    } catch {
        return {files: [], error: 'git diff failed'};
    }
}

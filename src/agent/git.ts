// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawnSync} from 'child_process';

// Legacy product-mapping classification. These changes stay in the complete diff.
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
    'scripts',
];

// Exact filenames excluded from product-family inference, retained for conservative selection.
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
    'webpack.config.js',
    'Makefile',
    'config.mk',
    'go.mod',
    'go.sum',
]);

// Extensions that are never source code.
const IGNORED_EXTENSIONS = new Set([
    '.md',
    '.txt',
    '.lock',
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.eot',
    '.yml', '.yaml',
    '.sh',
]);

// File patterns that indicate test/spec files (not production code).
const TEST_FILE_PATTERNS = [
    /\.spec\.[tj]sx?$/,
    /\.test\.[tj]sx?$/,
    /_test\.go$/,
    /\.stories\.[tj]sx?$/,
    /\.d\.ts$/,
];

// Config file patterns that are not production source code.
const CONFIG_FILE_PATTERNS = [
    /\.config\.[tj]sx?$/,
    /\.config\.json$/,
    /\.config\.js$/,
];

export function isRelevantFile(file: string): boolean {
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
    /** Complete repository-relative changed-file set. Never filtered. */
    files: string[];
    relevantFiles?: string[];
    repositoryRoot?: string;
    requestedBaseSha?: string;
    headSha?: string;
    /** Compatibility field for callers detecting PR-included tests; also present in files. */
    filteredTestFiles: string[];
    error?: string;
    baseRef?: string;
    baseStrategy?: 'merge-base' | 'direct';
}

export interface GitChangeOptions {
    includeUncommitted?: boolean;
}

export function runGitRaw(args: string[], cwd: string): string | null {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
        return null;
    }
    return result.stdout;
}

/**
 * Check if a file path is a test file (spec, test, or in test directories).
 * Shared across pipeline and crew orchestrators.
 */
export function isTestFile(file: string): boolean {
    const normalized = file.replace(/\\/g, '/');
    return /_spec\.[jt]s$/.test(normalized) ||
           normalized.startsWith('e2e-tests/') ||
           /\.(spec|test)\.(ts|tsx|js|jsx)$/.test(normalized) ||
           /\.snap$/.test(normalized) ||
           /_test\.go$/.test(normalized) ||
           normalized.includes('__tests__/') ||
           normalized.includes('__snapshots__/') ||
           normalized.includes('/tests/') ||
           normalized.includes('/test/');
}

/** A failed Git command is never represented as a successful empty diff. */
export function getChangedFiles(appRoot: string, since: string, options?: GitChangeOptions): GitChangeResult {
    const git = (args: string[], cwd = appRoot): string => {
        const result = spawnSync('git', args, {cwd, encoding: 'utf-8', timeout: 30000, maxBuffer: 64 * 1024 * 1024});
        if (result.error || result.status !== 0) {
            throw new Error(`git ${args[0]} failed: ${result.error?.message || result.stderr.trim() || `exit ${result.status}`}`);
        }
        return result.stdout;
    };
    try {
        const repositoryRoot = git(['rev-parse', '--show-toplevel']).trim();
        const requestedBaseSha = git(['rev-parse', '--verify', '--end-of-options', `${since}^{commit}`], repositoryRoot).trim();
        const headSha = git(['rev-parse', '--verify', 'HEAD^{commit}'], repositoryRoot).trim();
        const mergeBases = git(['merge-base', '--all', requestedBaseSha, headSha], repositoryRoot).trim().split('\n');
        if (mergeBases.length !== 1 || !mergeBases[0]) throw new Error('Ambiguous Git merge base; a single comparison base is required.');
        const baseRef = mergeBases[0];
        // NUL-delimited output preserves spaces, newlines and non-ASCII names.
        // Disabling rename detection retains both the removed and added paths.
        const files = new Set(git(['diff', '--name-only', '--no-renames', '--ignore-submodules=none', '-z', baseRef, headSha, '--'], repositoryRoot).split('\0').filter(Boolean));
        if (options?.includeUncommitted) {
            for (const args of [['diff', '--name-only', '--no-renames', '--ignore-submodules=none', '-z', '--cached'], ['diff', '--name-only', '--no-renames', '--ignore-submodules=none', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']]) {
                git(args, repositoryRoot).split('\0').filter(Boolean).forEach((file) => files.add(file));
            }
        }
        const allFiles = [...files].sort();
        return {
            files: allFiles,
            relevantFiles: allFiles.filter(isRelevantFile),
            filteredTestFiles: allFiles.filter(isTestFile),
            repositoryRoot, requestedBaseSha, headSha, baseRef, baseStrategy: 'merge-base',
        };
    } catch (error) {
        return {files: [], filteredTestFiles: [], error: error instanceof Error ? error.message : String(error)};
    }
}

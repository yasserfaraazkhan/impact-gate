// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawnSync} from 'child_process';
import {normalizePath} from './utils.js';

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

        return {files: Array.from(files), baseRef, baseStrategy};
    } catch {
        return {files: [], error: 'git diff failed'};
    }
}

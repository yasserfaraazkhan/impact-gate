// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawnSync} from 'child_process';
import {normalizePath} from './utils.js';

export interface GitChangeResult {
    files: string[];
    error?: string;
}

export interface GitChangeOptions {
    includeUncommitted?: boolean;
}

function runGit(args: string[], cwd: string): string[] | null {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf-8',
        timeout: 30000,
    });
    if (result.error) {
        return null;
    }
    return result.stdout
        .split('\n')
        .map((file) => file.trim())
        .filter(Boolean)
        .map((file) => normalizePath(file));
}

function parseStatusLines(lines: string[]): string[] {
    const files: string[] = [];
    for (const line of lines) {
        if (!line) continue;
        const trimmed = line.trim();
        if (trimmed.length < 3) continue;
        const pathPart = trimmed.slice(3);
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
        const diffFiles = runGit(['diff', '--name-only', `${since}..HEAD`, '--', '.'], appRoot);
        if (!diffFiles) {
            return {files: [], error: 'git diff failed'};
        }
        diffFiles.forEach((file) => files.add(file));

        if (options?.includeUncommitted) {
            const staged = runGit(['diff', '--name-only', '--cached', '--', '.'], appRoot) || [];
            staged.forEach((file) => files.add(file));
            const unstaged = runGit(['diff', '--name-only', '--', '.'], appRoot) || [];
            unstaged.forEach((file) => files.add(file));
            const status = runGit(['status', '--porcelain', '--', '.'], appRoot) || [];
            parseStatusLines(status).forEach((file) => files.add(file));
        }

        return {files: Array.from(files)};
    } catch {
        return {files: [], error: 'git diff failed'};
    }
}

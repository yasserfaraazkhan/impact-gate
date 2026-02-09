// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {readFileSync, statSync} from 'fs';
import {basename, extname, posix} from 'path';

const MAX_READ_BYTES = 1024 * 1024; // 1MB

const STOP_WORDS = new Set([
    'index',
    'component',
    'components',
    'page',
    'pages',
    'screen',
    'screens',
    'view',
    'views',
    'route',
    'routes',
    'feature',
    'features',
    'module',
    'modules',
    'flow',
    'flows',
    'test',
    'tests',
    'spec',
    'specs',
    'hooks',
    'hook',
    'context',
    'state',
    'store',
]);

const GLOB_CHARS = /[*?[\]{}()!]/;

export function hasGlobChars(value: string): boolean {
    return GLOB_CHARS.test(value);
}

export function globToRegExp(pattern: string): RegExp {
    const normalized = normalizePath(pattern);
    let regex = '^';
    let i = 0;
    while (i < normalized.length) {
        const char = normalized[i];
        if (char === '*') {
            const next = normalized[i + 1];
            if (next === '*') {
                regex += '.*';
                i += 2;
                continue;
            }
            regex += '[^/]*';
            i += 1;
            continue;
        }
        if (char === '?') {
            regex += '[^/]';
            i += 1;
            continue;
        }
        if ('\\.[]{}()+-^$|'.includes(char)) {
            regex += `\\${char}`;
        } else {
            regex += char;
        }
        i += 1;
    }
    regex += '$';
    return new RegExp(regex);
}

export function matchGlob(pathValue: string, pattern: string): boolean {
    const normalizedPath = normalizePath(pathValue);
    const normalizedPattern = normalizePath(pattern);
    if (!hasGlobChars(normalizedPattern)) {
        if (normalizedPattern.endsWith('/')) {
            return normalizedPath.startsWith(normalizedPattern);
        }
        return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
    }
    const regex = globToRegExp(normalizedPattern);
    return regex.test(normalizedPath);
}

export function safeReadTextFile(path: string): string | null {
    try {
        const stats = statSync(path);
        if (stats.size > MAX_READ_BYTES) {
            return null;
        }
        return readFileSync(path, 'utf-8');
    } catch {
        return null;
    }
}

export function normalizePath(pathValue: string): string {
    return pathValue.split('\\').join('/');
}

export function toRelativePosix(root: string, filePath: string): string {
    const relative = posix.relative(normalizePath(root), normalizePath(filePath));
    return relative.startsWith('../') ? normalizePath(filePath) : relative;
}

export function fileExtension(pathValue: string): string {
    return extname(pathValue).replace('.', '').toLowerCase();
}

export function baseNameWithoutExt(pathValue: string): string {
    const base = basename(pathValue);
    const ext = extname(base);
    return ext ? base.slice(0, -ext.length) : base;
}

function splitCamelCase(value: string): string {
    return value.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function tokenize(value: string): string[] {
    const normalized = splitCamelCase(value)
        .replace(/[_\-.]/g, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .toLowerCase();

    return normalized
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

export function uniqueTokens(tokens: string[]): string[] {
    return Array.from(new Set(tokens.filter(Boolean)));
}

export function titleCase(value: string): string {
    return value
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

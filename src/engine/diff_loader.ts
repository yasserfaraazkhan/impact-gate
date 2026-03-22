// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {runGitRaw} from '../agent/git.js';

const MAX_DIFF_CHARS = 8000;
const MAX_TOTAL_CHARS = 60000;
const TRUNCATION_NOTICE = '\n... (diff truncated)';

/**
 * Loads git diffs for the given changed files relative to the given since ref.
 * Uses `git merge-base` to find the accurate base ref first.
 * Individual diffs are truncated at 8000 chars and total output is capped at 60000 chars.
 */
export function loadDiffs(appRoot: string, since: string, changedFiles: string[]): Map<string, string> {
    const result = new Map<string, string>();

    if (changedFiles.length === 0) {
        return result;
    }

    // Try to get accurate merge base
    let baseRef = since;
    const mergeBaseOutput = runGitRaw(['merge-base', since, 'HEAD'], appRoot);
    if (mergeBaseOutput) {
        const candidate = mergeBaseOutput
            .split('\n')
            .map((line) => line.trim())
            .find(Boolean);
        if (candidate) {
            baseRef = candidate;
        }
    }

    let totalChars = 0;

    for (const file of changedFiles) {
        if (totalChars >= MAX_TOTAL_CHARS) {
            break;
        }

        const diffOutput = runGitRaw(['diff', `${baseRef}..HEAD`, '--', file], appRoot);
        if (diffOutput === null) {
            continue;
        }

        let diff = diffOutput;
        if (diff.length > MAX_DIFF_CHARS) {
            diff = diff.slice(0, MAX_DIFF_CHARS) + TRUNCATION_NOTICE;
        }

        result.set(file, diff);
        totalChars += diff.length;
    }

    return result;
}

/**
 * Formats a diffs map into a human-readable string suitable for an AI prompt.
 */
export function formatDiffsForPrompt(diffs: Map<string, string>): string {
    if (diffs.size === 0) {
        return 'No diffs available.';
    }

    const sections: string[] = [];
    for (const [file, diff] of diffs) {
        sections.push(`--- ${file} ---\n${diff}`);
    }
    return sections.join('\n\n');
}

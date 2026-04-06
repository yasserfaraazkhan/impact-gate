// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Change Metrics Extractor
 *
 * Extracts the 14 Kamei change-level metrics from a git diff.
 * These metrics are the foundation of just-in-time defect prediction.
 *
 * References:
 * - Kamei et al. 2013 "A Large-Scale Empirical Study of Just-in-Time Quality Assurance"
 * - Hassan 2009 "Predicting Faults Using the Complexity of Code Changes"
 *
 * All functions are deterministic — no LLM calls, no network, no cost.
 */

import {spawnSync} from 'child_process';

import type {ChangeMetrics} from './types.js';

/** Run a git command and return stdout, or null on failure */
function git(args: string[], cwd: string): string | null {
    const result = spawnSync('git', args, {cwd, encoding: 'utf-8', timeout: 30000});
    if (result.error || result.status !== 0) {
        return null;
    }
    return result.stdout;
}

/** Extract all 14 Kamei metrics from a git diff between two refs */
export function extractChangeMetrics(
    repoRoot: string,
    baseRef: string,
    headRef: string = 'HEAD',
): ChangeMetrics {
    // Get the diff stat for size metrics
    const diffStat = git(['diff', '--numstat', `${baseRef}...${headRef}`], repoRoot);
    const files = parseDiffStat(diffStat || '');

    // Size metrics
    const la = files.reduce((sum, f) => sum + f.added, 0);
    const ld = files.reduce((sum, f) => sum + f.deleted, 0);
    const nf = files.length;

    // Lines in files before change (approximate from git show)
    const lt = countTotalLines(repoRoot, baseRef, files.map((f) => f.path));

    // Diffusion metrics
    const directories = new Set(files.map((f) => {
        const parts = f.path.split('/');
        return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    }));
    const nd = directories.size;

    const subsystems = new Set(files.map((f) => {
        const parts = f.path.split('/');
        return parts[0] || '.';
    }));
    const ns = subsystems.size;

    // Entropy: distribution of changes across files
    const entropy = calculateEntropy(files.map((f) => f.added + f.deleted));

    // Purpose: is this a fix commit?
    const fix = isFixCommit(repoRoot, baseRef, headRef) ? 1 : 0;

    // History metrics
    const filePaths = files.map((f) => f.path);
    const ndev = countUniqueDevs(repoRoot, filePaths);
    const age = calculateAvgAge(repoRoot, filePaths);
    const nuc = countUniqueChanges(repoRoot, filePaths);

    // Experience metrics
    const author = getCurrentAuthor(repoRoot, headRef);
    const exp = countAuthorCommits(repoRoot, author);
    const rexp = countAuthorRecentCommits(repoRoot, author, 30);
    const sexp = countAuthorSubsystemCommits(repoRoot, author, Array.from(subsystems));

    return {la, ld, lt, nf, nd, ns, entropy, fix, ndev, age, nuc, exp, rexp, sexp};
}

// --- Helper functions ---

interface FileStat {
    path: string;
    added: number;
    deleted: number;
}

function parseDiffStat(output: string): FileStat[] {
    const files: FileStat[] = [];
    for (const line of output.split('\n')) {
        const parts = line.trim().split('\t');
        if (parts.length >= 3) {
            const added = parseInt(parts[0], 10) || 0;
            const deleted = parseInt(parts[1], 10) || 0;
            const path = parts[2];
            if (path) {
                files.push({path, added, deleted});
            }
        }
    }
    return files;
}

function countTotalLines(repoRoot: string, ref: string, paths: string[]): number {
    if (paths.length === 0) return 0;
    let total = 0;
    // Sample up to 20 files for performance
    const sample = paths.slice(0, 20);
    for (const path of sample) {
        const content = git(['show', `${ref}:${path}`], repoRoot);
        if (content) {
            total += content.split('\n').length;
        }
    }
    // Extrapolate if we sampled
    if (paths.length > sample.length) {
        total = Math.round(total * (paths.length / sample.length));
    }
    return total;
}

/** Shannon entropy of change distribution. 0 = all in one file, 1 = evenly spread */
function calculateEntropy(changeSizes: number[]): number {
    const total = changeSizes.reduce((a, b) => a + b, 0);
    if (total === 0 || changeSizes.length <= 1) return 0;

    let entropy = 0;
    for (const size of changeSizes) {
        if (size > 0) {
            const p = size / total;
            entropy -= p * Math.log2(p);
        }
    }
    // Normalize to 0-1 range
    const maxEntropy = Math.log2(changeSizes.length);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

/** Check if any commit message between base and head indicates a bug fix */
function isFixCommit(repoRoot: string, baseRef: string, headRef: string): boolean {
    const log = git(['log', '--format=%s', `${baseRef}...${headRef}`], repoRoot);
    if (!log) return false;
    const fixPatterns = /\b(fix|bug|patch|resolve|hotfix|defect|issue|repair|correct)\b/i;
    return log.split('\n').some((msg) => fixPatterns.test(msg));
}

/** Count unique developers who have modified these files */
function countUniqueDevs(repoRoot: string, paths: string[]): number {
    if (paths.length === 0) return 0;
    const devs = new Set<string>();
    // Sample for performance
    for (const path of paths.slice(0, 15)) {
        const log = git(['log', '--format=%ae', '--follow', '-20', '--', path], repoRoot);
        if (log) {
            for (const email of log.split('\n')) {
                if (email.trim()) devs.add(email.trim().toLowerCase());
            }
        }
    }
    return devs.size;
}

/** Average age of files in days since last modification */
function calculateAvgAge(repoRoot: string, paths: string[]): number {
    if (paths.length === 0) return 0;
    const now = Date.now();
    let totalAge = 0;
    let count = 0;
    for (const path of paths.slice(0, 15)) {
        const log = git(['log', '-1', '--format=%at', '--', path], repoRoot);
        if (log) {
            const timestamp = parseInt(log.trim(), 10);
            if (!isNaN(timestamp)) {
                totalAge += (now - timestamp * 1000) / (1000 * 60 * 60 * 24);
                count++;
            }
        }
    }
    return count > 0 ? Math.round(totalAge / count) : 0;
}

/** Count unique prior changes to these files */
function countUniqueChanges(repoRoot: string, paths: string[]): number {
    if (paths.length === 0) return 0;
    const commits = new Set<string>();
    for (const path of paths.slice(0, 15)) {
        const log = git(['log', '--format=%H', '-50', '--', path], repoRoot);
        if (log) {
            for (const hash of log.split('\n')) {
                if (hash.trim()) commits.add(hash.trim());
            }
        }
    }
    return commits.size;
}

/** Get the author of the head commit */
function getCurrentAuthor(repoRoot: string, headRef: string): string {
    const log = git(['log', '-1', '--format=%ae', headRef], repoRoot);
    return log?.trim() || 'unknown';
}

/** Count total commits by this author in the repo */
function countAuthorCommits(repoRoot: string, author: string): number {
    const log = git(['rev-list', '--count', '--author', author, 'HEAD'], repoRoot);
    return parseInt(log?.trim() || '0', 10);
}

/** Count author's commits in the last N days */
function countAuthorRecentCommits(repoRoot: string, author: string, days: number): number {
    const log = git(['rev-list', '--count', '--author', author, `--since=${days} days ago`, 'HEAD'], repoRoot);
    return parseInt(log?.trim() || '0', 10);
}

/** Count author's commits to specific subsystems (top-level directories) */
function countAuthorSubsystemCommits(repoRoot: string, author: string, subsystems: string[]): number {
    if (subsystems.length === 0) return 0;
    let total = 0;
    for (const sub of subsystems.slice(0, 5)) {
        const log = git(['rev-list', '--count', '--author', author, 'HEAD', '--', `${sub}/`], repoRoot);
        total += parseInt(log?.trim() || '0', 10);
    }
    return total;
}

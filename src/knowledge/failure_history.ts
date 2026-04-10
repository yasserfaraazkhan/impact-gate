// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Tracks historical test failure correlations: which tests fail when certain files change.
 * Used to boost confidence in impact analysis — if a file change historically breaks a test,
 * future changes to that file should prioritize that test.
 *
 * Data is stored as a JSON file at .e2e-ai-agents/failure-history.json.
 */

import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'fs';
import {join, dirname} from 'path';

export interface FailureCorrelation {
    /** Source file that was changed */
    changedFile: string;
    /** Spec file that failed */
    specFile: string;
    /** Number of times this correlation has been observed */
    count: number;
    /** ISO timestamp of last observation */
    lastSeen: string;
}

export interface FailureHistory {
    correlations: FailureCorrelation[];
    /** Total runs recorded */
    totalRuns: number;
    /** ISO timestamp of last update */
    updatedAt: string;
}

function createDefaultHistory(): FailureHistory {
    return {
        correlations: [],
        totalRuns: 0,
        updatedAt: new Date().toISOString(),
    };
}

export function loadFailureHistory(testsRoot: string): FailureHistory {
    const historyPath = join(testsRoot, '.e2e-ai-agents', 'failure-history.json');
    if (!existsSync(historyPath)) {
        return createDefaultHistory();
    }
    try {
        const raw = JSON.parse(readFileSync(historyPath, 'utf-8')) as FailureHistory;
        if (!Array.isArray(raw.correlations)) {
            return createDefaultHistory();
        }
        return raw;
    } catch {
        return createDefaultHistory();
    }
}

export function saveFailureHistory(testsRoot: string, history: FailureHistory): void {
    const historyPath = join(testsRoot, '.e2e-ai-agents', 'failure-history.json');
    try {
        const dir = dirname(historyPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, {recursive: true});
        }
        history.updatedAt = new Date().toISOString();
        writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
    } catch {
        // Non-fatal — history is advisory, not required
    }
}

/**
 * Record that a set of changed files caused a set of spec failures.
 * Call this after a test run where failures were observed.
 */
export function recordFailures(
    history: FailureHistory,
    changedFiles: string[],
    failedSpecs: string[],
): FailureHistory {
    const now = new Date().toISOString();
    const updated = {...history, totalRuns: history.totalRuns + 1, correlations: [...history.correlations]};

    for (const changedFile of changedFiles) {
        for (const specFile of failedSpecs) {
            const existing = updated.correlations.find(
                (c) => c.changedFile === changedFile && c.specFile === specFile,
            );
            if (existing) {
                existing.count++;
                existing.lastSeen = now;
            } else {
                updated.correlations.push({
                    changedFile,
                    specFile,
                    count: 1,
                    lastSeen: now,
                });
            }
        }
    }

    // Prune stale correlations (not seen in 90 days)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString();
    updated.correlations = updated.correlations.filter((c) => c.lastSeen >= cutoffStr);

    return updated;
}

/**
 * Get a confidence boost (0-20) for a file based on historical failure patterns.
 * A file that historically causes test failures gets a higher confidence boost
 * when detected as impacted, meaning the system is more confident it needs testing.
 */
export function getConfidenceBoost(history: FailureHistory, changedFile: string): number {
    const correlations = history.correlations.filter((c) => c.changedFile === changedFile);
    if (correlations.length === 0) {
        return 0;
    }

    // More correlations and higher counts = more confidence
    const totalCount = correlations.reduce((sum, c) => sum + c.count, 0);
    const uniqueSpecs = correlations.length;

    // Scale: 1 correlation = +5, 3+ = +10, 5+ with high counts = +15, max +20
    if (totalCount >= 10 && uniqueSpecs >= 5) return 20;
    if (totalCount >= 5 && uniqueSpecs >= 3) return 15;
    if (totalCount >= 3) return 10;
    return 5;
}

/**
 * Get the most likely failing specs for a set of changed files, based on history.
 * Returns specs sorted by correlation strength (count * recency).
 */
export function getPredictedFailures(
    history: FailureHistory,
    changedFiles: string[],
    limit = 10,
): Array<{specFile: string; score: number}> {
    const specScores = new Map<string, number>();

    for (const changedFile of changedFiles) {
        for (const c of history.correlations) {
            if (c.changedFile !== changedFile) continue;

            // Score: count weighted by recency (days since last seen)
            const daysSince = (Date.now() - new Date(c.lastSeen).getTime()) / (1000 * 60 * 60 * 24);
            const recencyWeight = Math.max(0.1, 1 - daysSince / 90);
            const score = c.count * recencyWeight;

            specScores.set(c.specFile, (specScores.get(c.specFile) || 0) + score);
        }
    }

    return Array.from(specScores.entries())
        .map(([specFile, score]) => ({specFile, score}))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

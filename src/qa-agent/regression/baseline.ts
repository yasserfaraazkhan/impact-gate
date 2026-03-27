// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {readFileSync, writeFileSync, existsSync} from 'fs';
import {execFileSync} from 'child_process';
import {resolve} from 'path';

import type {Finding, HealthScore, RegressionBaseline, RegressionComparison, HealthScoreCategory} from '../types.js';
import {logger} from '../../logger.js';

const BASELINE_FILENAME = 'qa-baseline.json';

/**
 * Save a regression baseline after a QA run.
 */
export function saveBaseline(
    outputDir: string,
    healthScore: HealthScore,
    findings: Finding[],
    url: string,
): void {
    let commitHash: string | undefined;
    try {
        commitHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {encoding: 'utf-8'}).trim();
    } catch {
        // Not in a git repo
    }

    const baseline: RegressionBaseline = {
        date: new Date().toISOString(),
        url,
        healthScore,
        issues: findings
            .filter((f) => f.type !== 'verified-ok')
            .map((f) => ({
                id: f.id,
                type: f.type,
                severity: f.severity,
                summary: f.summary,
                flow: f.flow,
            })),
        commitHash,
    };

    const filePath = resolve(outputDir, BASELINE_FILENAME);
    writeFileSync(filePath, JSON.stringify(baseline, null, 2), 'utf-8');
    logger.info(`Baseline saved: ${filePath}`);
}

/**
 * Load a previously saved baseline. Returns null if no baseline exists.
 */
export function loadBaseline(outputDir: string): RegressionBaseline | null {
    const filePath = resolve(outputDir, BASELINE_FILENAME);
    if (!existsSync(filePath)) {
        return null;
    }

    try {
        const raw = readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as RegressionBaseline;
    } catch (err) {
        logger.warn('Failed to load baseline', {error: String(err)});
        return null;
    }
}

/**
 * Compare current findings against a saved baseline.
 */
/**
 * Build a fingerprint for a finding that includes flow, type, and summary
 * to avoid collapsing distinct issues with the same generic summary.
 */
function issueFingerprint(issue: {type: string; summary: string; flow: string}): string {
    return `${issue.flow}|${issue.type}|${issue.summary}`.toLowerCase();
}

export function compareBaselines(
    currentScore: HealthScore,
    currentFindings: Finding[],
    baseline: RegressionBaseline,
): RegressionComparison {
    const baselineFingerprints = new Set(baseline.issues.map((i) => issueFingerprint(i)));
    const currentFingerprints = new Set(
        currentFindings
            .filter((f) => f.type !== 'verified-ok')
            .map((f) => issueFingerprint(f)),
    );

    // Issues in baseline but not in current = fixed
    const fixedIssues = baseline.issues
        .filter((i) => !currentFingerprints.has(issueFingerprint(i)))
        .map((i) => `${i.id}: ${i.summary}`);

    // Issues in current but not in baseline = new
    const newIssues = currentFindings
        .filter((f) => f.type !== 'verified-ok' && !baselineFingerprints.has(issueFingerprint(f)))
        .map((f) => `${f.id}: ${f.summary}`);

    // Category deltas
    const categoryDeltas: Partial<Record<HealthScoreCategory, number>> = {};
    for (const currentCat of currentScore.categories) {
        const baselineCat = baseline.healthScore.categories.find((c) => c.category === currentCat.category);
        if (baselineCat) {
            const delta = currentCat.score - baselineCat.score;
            if (delta !== 0) {
                categoryDeltas[currentCat.category] = delta;
            }
        }
    }

    return {
        baselineDate: baseline.date,
        scoreDelta: currentScore.overall - baseline.healthScore.overall,
        categoryDeltas,
        fixedIssues,
        newIssues,
    };
}

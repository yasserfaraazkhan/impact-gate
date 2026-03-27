// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Finding, HealthScore, HealthScoreCategory, CategoryScore} from './types.js';
import {normalizeFindingCategory} from './finding_taxonomy.js';

// ---------------------------------------------------------------------------
// Category weights (must sum to 1.0)
// ---------------------------------------------------------------------------

const CATEGORY_WEIGHTS: Record<HealthScoreCategory, number> = {
    console: 0.15,
    links: 0.10,
    visual: 0.10,
    functional: 0.20,
    ux: 0.15,
    performance: 0.10,
    content: 0.05,
    accessibility: 0.15,
};

// ---------------------------------------------------------------------------
// Severity deductions
// ---------------------------------------------------------------------------

const SEVERITY_DEDUCTIONS: Record<string, number> = {
    critical: 25,
    high: 15,
    medium: 8,
    low: 3,
    info: 0,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a finding to its health-score category.
 * Handles both canonical categories and legacy finding types.
 */
export function mapFindingToCategory(finding: Finding): HealthScoreCategory {
    return normalizeFindingCategory(finding.type);
}

/**
 * Compute a weighted health score (0-100) from a set of findings.
 *
 * Each of 8 categories starts at 100. Per finding, deduct based on severity
 * (critical -25, high -15, medium -8, low -3). Clamp each category at 0.
 * Overall = sum(category_score * weight).
 */
export function computeHealthScore(findings: Finding[]): HealthScore {
    // Initialize per-category state
    const categoryState: Record<HealthScoreCategory, {score: number; findings: string[]}> = {
        console: {score: 100, findings: []},
        links: {score: 100, findings: []},
        visual: {score: 100, findings: []},
        functional: {score: 100, findings: []},
        ux: {score: 100, findings: []},
        performance: {score: 100, findings: []},
        content: {score: 100, findings: []},
        accessibility: {score: 100, findings: []},
    };

    // Apply deductions
    for (const finding of findings) {
        if (finding.type === 'verified-ok') {
            continue;
        }
        const category = mapFindingToCategory(finding);
        const deduction = SEVERITY_DEDUCTIONS[finding.severity] ?? 0;
        categoryState[category].score = Math.max(0, categoryState[category].score - deduction);
        categoryState[category].findings.push(finding.id);
    }

    // Build category scores
    const categories: CategoryScore[] = (Object.keys(CATEGORY_WEIGHTS) as HealthScoreCategory[]).map((cat) => ({
        category: cat,
        score: categoryState[cat].score,
        weight: CATEGORY_WEIGHTS[cat],
        findings: categoryState[cat].findings,
    }));

    // Compute weighted overall
    const overall = Math.round(
        categories.reduce((sum, c) => sum + c.score * c.weight, 0),
    );

    return {
        overall,
        categories,
        computedAt: new Date().toISOString(),
    };
}

/**
 * Render a health score as a markdown table.
 */
export function formatHealthScoreMarkdown(score: HealthScore): string {
    const lines: string[] = [
        `## Health Score: ${score.overall}/100`,
        '',
        '| Category | Score | Weight | Issues |',
        '|----------|-------|--------|--------|',
    ];

    for (const cat of score.categories) {
        const pct = `${Math.round(cat.weight * 100)}%`;
        lines.push(`| ${capitalize(cat.category)} | ${cat.score} | ${pct} | ${cat.findings.length} |`);
    }

    return lines.join('\n');
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

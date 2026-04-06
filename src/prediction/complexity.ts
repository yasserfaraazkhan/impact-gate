// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Code Complexity Analyzer
 *
 * Extracts complexity metrics from a git diff without full AST parsing.
 * Uses heuristic pattern matching on diff hunks to estimate:
 * - Cognitive complexity delta (nesting, branching)
 * - Coupling delta (new imports/dependencies)
 * - Test ratio (test lines vs source lines)
 *
 * Reference: Hassan 2009 "Predicting Faults Using the Complexity of Code Changes"
 */

import {spawnSync} from 'child_process';

import type {ComplexityMetrics} from './types.js';

/** Extract complexity metrics from the diff between two refs */
export function extractComplexityMetrics(
    repoRoot: string,
    baseRef: string,
    headRef: string = 'HEAD',
): ComplexityMetrics {
    const diff = getDiff(repoRoot, baseRef, headRef);
    if (!diff) {
        return {cognitive_delta: 0, coupling_delta: 0, test_ratio: 0, lines_changed: 0};
    }

    const hunks = parseDiffHunks(diff);

    let testLinesChanged = 0;
    let sourceLinesChanged = 0;
    let totalCognitiveDelta = 0;
    let totalCouplingDelta = 0;

    for (const hunk of hunks) {
        const isTest = isTestFile(hunk.file);
        const linesChanged = hunk.addedLines.length + hunk.removedLines.length;

        if (isTest) {
            testLinesChanged += linesChanged;
        } else {
            sourceLinesChanged += linesChanged;
            totalCognitiveDelta += measureCognitiveDelta(hunk.addedLines, hunk.removedLines);
            totalCouplingDelta += measureCouplingDelta(hunk.addedLines, hunk.removedLines);
        }
    }

    const totalLines = testLinesChanged + sourceLinesChanged;
    const testRatio = totalLines > 0 ? testLinesChanged / totalLines : 0;

    return {
        cognitive_delta: totalCognitiveDelta,
        coupling_delta: totalCouplingDelta,
        test_ratio: Math.round(testRatio * 100) / 100,
        lines_changed: totalLines,
    };
}

// --- Internal helpers ---

interface DiffHunk {
    file: string;
    addedLines: string[];
    removedLines: string[];
}

function getDiff(repoRoot: string, baseRef: string, headRef: string): string | null {
    const result = spawnSync('git', ['diff', '-U0', `${baseRef}...${headRef}`], {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,  // 10MB
    });
    if (result.error || result.status !== 0) return null;
    return result.stdout;
}

function parseDiffHunks(diff: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    let currentFile = '';
    let currentAdded: string[] = [];
    let currentRemoved: string[] = [];

    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git')) {
            // Flush previous hunk
            if (currentFile && (currentAdded.length > 0 || currentRemoved.length > 0)) {
                hunks.push({file: currentFile, addedLines: currentAdded, removedLines: currentRemoved});
            }
            // Extract file path: "diff --git a/foo b/foo" → "foo"
            const match = line.match(/b\/(.+)$/);
            currentFile = match?.[1] || '';
            currentAdded = [];
            currentRemoved = [];
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            currentAdded.push(line.slice(1));
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            currentRemoved.push(line.slice(1));
        }
    }
    // Flush last hunk
    if (currentFile && (currentAdded.length > 0 || currentRemoved.length > 0)) {
        hunks.push({file: currentFile, addedLines: currentAdded, removedLines: currentRemoved});
    }

    return hunks;
}

function isTestFile(path: string): boolean {
    const lower = path.toLowerCase();
    return (
        lower.includes('.test.') ||
        lower.includes('.spec.') ||
        lower.includes('__tests__') ||
        lower.includes('__test__') ||
        lower.includes('/test/') ||
        lower.includes('/tests/') ||
        lower.includes('e2e/') ||
        lower.includes('.cy.') ||
        lower.endsWith('_test.go') ||
        lower.endsWith('_test.py')
    );
}

// Patterns that increase cognitive complexity
const BRANCHING_PATTERNS = [
    /\bif\s*\(/,
    /\belse\s*(if\s*\(|\{)/,
    /\bswitch\s*\(/,
    /\bcase\s+/,
    /\bfor\s*\(/,
    /\bwhile\s*\(/,
    /\bdo\s*\{/,
    /\bcatch\s*\(/,
    /\?\s*.*\s*:/,             // ternary
    /&&\s*$/,                  // logical AND continuation
    /\|\|\s*$/,                // logical OR continuation
];

// Patterns that indicate nesting depth increase
const NESTING_PATTERNS = [
    /^\s{8,}/,                 // 8+ spaces indent = deep nesting
    /^\t{3,}/,                 // 3+ tabs = deep nesting
];

/**
 * Estimate cognitive complexity change from added vs removed lines.
 * Positive = more complex. Negative = simplified.
 */
function measureCognitiveDelta(added: string[], removed: string[]): number {
    const addedComplexity = countComplexityPatterns(added);
    const removedComplexity = countComplexityPatterns(removed);
    return addedComplexity - removedComplexity;
}

function countComplexityPatterns(lines: string[]): number {
    let score = 0;
    for (const line of lines) {
        for (const pattern of BRANCHING_PATTERNS) {
            if (pattern.test(line)) {
                score += 1;
                break;
            }
        }
        for (const pattern of NESTING_PATTERNS) {
            if (pattern.test(line)) {
                score += 2;  // Deep nesting is a stronger signal
                break;
            }
        }
    }
    return score;
}

// Patterns that indicate new coupling/dependencies
const IMPORT_PATTERNS = [
    /^\s*import\s+/,
    /^\s*from\s+['"].*['"]\s+import/,
    /^\s*require\s*\(/,
    /^\s*import\s*\(/,           // dynamic import
    /^\s*use\s+/,                // Go imports
    /^\s*#include\s+/,           // C/C++
];

/**
 * Count net new imports/dependencies.
 * Positive = more coupling. Negative = decoupled.
 */
function measureCouplingDelta(added: string[], removed: string[]): number {
    const addedImports = added.filter((line) => IMPORT_PATTERNS.some((p) => p.test(line))).length;
    const removedImports = removed.filter((line) => IMPORT_PATTERNS.some((p) => p.test(line))).length;
    return addedImports - removedImports;
}

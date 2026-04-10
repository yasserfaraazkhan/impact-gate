// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Review Report Formatter
 *
 * Formats the ReviewReport into human-readable text, markdown for PR comments,
 * or machine-readable JSON.
 */

import type {ReviewReport, ReviewedFlow} from './review_types.js';

// ─── Text Output (CLI default) ───

/**
 * Format the review report as plain text for terminal output.
 */
export function formatReviewText(report: ReviewReport): string {
    const lines: string[] = [];

    lines.push('PR Impact Review');
    lines.push('================');
    lines.push('');

    // Section 1: Impacted User Flows
    lines.push('Impacted User Flows:');
    if (report.impactedFlows.length === 0) {
        lines.push('  (no impacted flows detected)');
    }
    for (const flow of report.impactedFlows) {
        lines.push(formatFlowLine(flow));
        lines.push(`     Changed: ${summarizeFiles(flow.changedFiles)}`);
        if (flow.userFlows.length > 0) {
            const flowPreview = flow.userFlows.slice(0, 4).join(', ');
            const more = flow.userFlows.length > 4 ? `, +${flow.userFlows.length - 4} more` : '';
            lines.push(`     Flows: ${flowPreview}${more}`);
        }
        if (flow.existingTests.length > 0) {
            lines.push(`     Tests: ${summarizeFiles(flow.existingTests)}`);
        }
        if (flow.gaps.length > 0) {
            for (const gap of flow.gaps) {
                lines.push(`     Gap: ${gap}`);
            }
        }
        if (flow.riskNote) {
            lines.push(`     Risk: ${flow.riskNote}`);
        }
        lines.push('');
    }

    // Section 2: Coverage Gaps
    if (report.coverageGaps.length > 0) {
        lines.push('Coverage Gaps (must add tests):');
        for (let i = 0; i < report.coverageGaps.length; i++) {
            const gap = report.coverageGaps[i];
            lines.push(`  ${i + 1}. [${gap.priority}] ${gap.name} -- ${gap.reason}`);
        }
        lines.push('');
    }

    // Section 2.5: Affected Functions (when KG available)
    if (report.affectedFunctions && report.affectedFunctions.length > 0) {
        const untested = report.affectedFunctions.filter((f) => f.testedBy.length === 0);
        const tested = report.affectedFunctions.filter((f) => f.testedBy.length > 0);

        if (untested.length > 0) {
            lines.push('Untested Functions (need coverage):');
            for (const af of untested.slice(0, 10)) {
                const loc = af.node.filePath ? ` (${shortPath(af.node.filePath)})` : '';
                const callers = af.calledBy.length > 0
                    ? ` -- called by: ${af.calledBy.slice(0, 2).map((c) => c.name).join(', ')}`
                    : '';
                lines.push(`  ❌ ${af.node.name}${loc}${callers}`);
            }
            if (untested.length > 10) {
                lines.push(`  ... and ${untested.length - 10} more untested functions`);
            }
            lines.push('');
        }

        if (tested.length > 0) {
            lines.push('Tested Functions:');
            for (const af of tested.slice(0, 5)) {
                const tests = af.testedBy.slice(0, 2).map((t) => t.name).join(', ');
                lines.push(`  ✅ ${af.node.name} -- tested by: ${tests}`);
            }
            if (tested.length > 5) {
                lines.push(`  ... and ${tested.length - 5} more tested functions`);
            }
            lines.push('');
        }
    }

    // Section 3: Defect Risk
    const risk = report.riskAssessment;
    const levelEmoji = {low: '🟢', medium: '🟡', high: '🟠', critical: '🔴'};
    lines.push(`Defect Risk: ${risk.score.toFixed(2)} ${risk.level.toUpperCase()} ${levelEmoji[risk.level]}`);
    if (risk.topFactors.length > 0) {
        lines.push(`  Top factors: ${risk.topFactors.slice(0, 3).join(', ')}`);
    }
    lines.push('');

    // Section 4: Decision
    const d = report.decision;
    const actionEmoji = {
        'safe-to-merge': '✅',
        'review-recommended': '⚠️',
        'must-add-tests': '❌',
        'block': '🛑',
    };
    lines.push(`Decision: ${actionEmoji[d.action]} ${d.action.toUpperCase().replace(/-/g, ' ')}`);
    lines.push(`  ${d.summary}`);
    for (const detail of d.details) {
        lines.push(`  - ${detail}`);
    }

    return lines.join('\n');
}

function formatFlowLine(flow: ReviewedFlow): string {
    const statusIcon = {
        covered: '✅',
        partial: '⚠️',
        uncovered: '❌',
    };
    const icon = statusIcon[flow.status];
    const statusLabel = flow.status === 'covered'
        ? `covered by ${flow.existingTests.length} test${flow.existingTests.length !== 1 ? 's' : ''}`
        : flow.status === 'partial'
            ? 'partially covered'
            : 'no existing tests';

    return `  ${icon} [${flow.priority}] ${flow.name} (${statusLabel})`;
}

function summarizeFiles(files: string[]): string {
    if (files.length <= 2) {
        return files.map(shortPath).join(', ');
    }
    return `${shortPath(files[0])}, ${shortPath(files[1])}, +${files.length - 2} more`;
}

function shortPath(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 3) return path;
    return `.../${parts.slice(-2).join('/')}`;
}

/** Escape pipe characters for markdown table cells */
function escapeTableCell(text: string): string {
    return text.replace(/\|/g, '\\|');
}

// ─── Markdown Output (for PR comments) ───

/**
 * Format the review report as markdown for GitHub PR comments.
 */
export function formatReviewMarkdown(report: ReviewReport): string {
    const lines: string[] = [];

    const levelEmoji = {low: '🟢', medium: '🟡', high: '🟠', critical: '🔴'};
    const actionLabel = {
        'safe-to-merge': '✅ Safe to Merge',
        'review-recommended': '⚠️ Review Recommended',
        'must-add-tests': '❌ Must Add Tests',
        'block': '🛑 Block',
    };

    const d = report.decision;
    lines.push(`## ${actionLabel[d.action]}`);
    lines.push('');
    lines.push(d.summary);
    lines.push('');

    // Flows table
    if (report.impactedFlows.length > 0) {
        lines.push('### Impacted User Flows');
        lines.push('');
        lines.push('| Status | Priority | Flow | Tests | Gaps |');
        lines.push('|--------|----------|------|-------|------|');
        for (const flow of report.impactedFlows) {
            const statusIcon = flow.status === 'covered' ? '✅' : flow.status === 'partial' ? '⚠️' : '❌';
            const testCount = flow.existingTests.length > 0 ? `${flow.existingTests.length} test${flow.existingTests.length !== 1 ? 's' : ''}` : 'none';
            const gapText = flow.gaps.length > 0 ? flow.gaps[0] : '-';
            lines.push(`| ${statusIcon} ${flow.status} | ${flow.priority} | ${escapeTableCell(flow.name)} | ${testCount} | ${escapeTableCell(gapText)} |`);
        }
        lines.push('');
    }

    // Coverage Gaps
    if (report.coverageGaps.length > 0) {
        lines.push('### Coverage Gaps');
        lines.push('');
        for (const gap of report.coverageGaps) {
            lines.push(`- **[${gap.priority}] ${gap.name}** -- ${gap.reason}`);
        }
        lines.push('');
    }

    // Risk
    lines.push(`### Defect Risk: ${levelEmoji[report.riskAssessment.level]} ${report.riskAssessment.score.toFixed(2)} (${report.riskAssessment.level.toUpperCase()})`);
    lines.push('');
    if (report.riskAssessment.topFactors.length > 0) {
        for (const factor of report.riskAssessment.topFactors.slice(0, 3)) {
            lines.push(`- ${factor}`);
        }
    }
    lines.push('');

    // Metrics
    const m = report.metrics;
    lines.push(`<details><summary>Metrics</summary>`);
    lines.push('');
    lines.push(`- Changed files: ${m.changedFiles}`);
    lines.push(`- Impacted flows: ${m.impactedFlows} (${m.coveredFlows} covered, ${m.partialFlows} partial, ${m.uncoveredFlows} uncovered)`);
    lines.push(`- Coverage gaps: ${m.coverageGaps}`);
    lines.push(`- Confidence: ${m.confidence}%`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
    lines.push('---');
    lines.push('*Generated by [impact-gate](https://yasserfaraazkhan.github.io/impact-gate/) defect prediction engine*');

    return lines.join('\n');
}

// ─── JSON Output ───

/**
 * Format the review report as a JSON-serializable object.
 */
export function formatReviewJSON(report: ReviewReport): Record<string, unknown> {
    return {
        decision: report.decision,
        impactedFlows: report.impactedFlows,
        coverageGaps: report.coverageGaps,
        riskAssessment: report.riskAssessment,
        metrics: report.metrics,
    };
}

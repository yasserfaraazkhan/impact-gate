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
    if (report.evidence) lines.push('Measured coverage unavailable; candidate mappings are unverified.', '');
    for (const mapping of report.mappingProvenance || []) {
        lines.push(`- ${mapping.file}: ${mapping.kind} (unverified; ${mapping.origins.join(', ') || 'no origin'}) → ${mapping.tests.join(', ') || 'no candidates'}`);
    }
    if (report.mappingProvenance?.length) lines.push('');

    lines.push('PR Impact Review');
    lines.push('================');
    lines.push(`Confidence: ${formatConfidence(report)}`);
    lines.push('');

    // Section 0: What this PR changes (behavior-aware)
    if (report.behaviorSummary && report.behaviorSummary.length > 0) {
        lines.push('What this PR changes (user-visible):');
        for (const behavior of report.behaviorSummary) {
            lines.push(`  - ${behavior}`);
        }
        lines.push('');
    }

    // Section 0.5: Existing test coverage
    if (report.relevantExistingTests && report.relevantExistingTests.length > 0) {
        lines.push('Associated existing specs:');
        for (const test of report.relevantExistingTests.slice(0, 5)) {
            lines.push(`  - ${shortPath(test.file)} (${test.matchReason}; unverified association)`);
        }
        if (report.relevantExistingTests.length > 5) {
            lines.push(`  ... and ${report.relevantExistingTests.length - 5} more`);
        }
        lines.push('');
    }

    // Section 0.7: Tests included in this PR
    if (report.prIncludedTestSummary) {
        lines.push('Tests included in this PR (not executed):');
        for (const file of report.prIncludedTestSummary.files) {
            const test = report.prIncludedTestSummary.tests?.find((entry) => entry.file === file);
            lines.push(`  - ${shortPath(file)}${test?.type === 'go' ? ' [Go]' : ''} — not executed`);
            for (const scenario of test?.scenarios || []) lines.push(`      - ${scenario}`);
        }
        if (report.prIncludedTestSummary.scenarioCount > 0) {
            lines.push(`  (${report.prIncludedTestSummary.scenarioCount} declared test names/scenarios; no execution results)`);
        }
        lines.push('');
    }

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
            lines.push('Functions without test associations:');
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
            lines.push('Functions with test associations (not execution evidence):');
            for (const af of tested.slice(0, 5)) {
                const tests = af.testedBy.slice(0, 2).map((t) => t.name).join(', ');
                lines.push(`  - ${af.node.name} -- associated tests: ${tests}`);
            }
            if (tested.length > 5) {
                lines.push(`  ... and ${tested.length - 5} more functions with test associations`);
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

    // Section 3.5: Recommended tests
    if (report.recommendations && report.recommendations.length > 0) {
        const uncovered = report.recommendations.filter((r) => !r.alreadyCoveredBy);
        const covered = report.recommendations.filter((r) => r.alreadyCoveredBy);

        if (uncovered.length > 0) {
            lines.push('Recommended tests to add:');
            for (let i = 0; i < uncovered.length && i < 5; i++) {
                const r = uncovered[i];
                const dim = r.dimension ? ` (${r.dimension})` : '';
                lines.push(`  ${i + 1}. [${r.priority}] ${r.scenario}${dim}`);
            }
            lines.push('');
        }

        if (covered.length > 0) {
            lines.push('Associated PR tests:');
            for (const r of covered.slice(0, 3)) {
                lines.push(`  - ${r.scenario} -- ${shortPath(r.alreadyCoveredBy!)} (not executed)`);
            }
            lines.push('');
        }
    }

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
        associated: '🔎',
        partial: '⚠️',
        uncovered: '❌',
    };
    const icon = statusIcon[flow.status];
    const statusLabel = flow.status === 'associated'
        ? `${flow.existingTests.length} associated test${flow.existingTests.length !== 1 ? 's' : ''}; coverage unverified`
        : flow.status === 'covered'
            ? `covered by ${flow.existingTests.length} test${flow.existingTests.length !== 1 ? 's' : ''}`
        : flow.status === 'partial'
            ? 'Cypress specs associated'
            : 'no existing tests';

    return `  ${icon} [${flow.priority}] ${flow.name} (${statusLabel})`;
}

function formatConfidence(report: ReviewReport): string {
    const {confidence, confidenceKind} = report.metrics;
    return confidence == null ? 'unavailable (kind: unavailable)' : `${confidence}% (kind: ${confidenceKind || 'heuristic'})`;
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
    if (report.evidence) lines.push('Measured coverage unavailable; candidate mappings are unverified.', '');
    for (const mapping of report.mappingProvenance || []) {
        lines.push(`- ${mapping.file}: ${mapping.kind} (unverified; ${mapping.origins.join(', ') || 'no origin'}) → ${mapping.tests.join(', ') || 'no candidates'}`);
    }
    if (report.mappingProvenance?.length) lines.push('');

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

    if (report.behaviorSummary?.length) {
        lines.push('### Behavior changes', '', ...report.behaviorSummary.map((b) => `- ${b}`), '');
    }
    if (report.recommendations?.length) {
        lines.push('### Recommended tests', '');
        for (const r of report.recommendations) {
            lines.push(`- **[${r.priority}] ${r.scenario}**${r.dimension ? ` (${r.dimension})` : ''}`);
            lines.push(`  - Rationale: ${r.rationale}`);
            if (r.alreadyCoveredBy) lines.push(`  - Associated test: ${r.alreadyCoveredBy}`);
        }
        lines.push('');
    }
    if (report.relevantExistingTests?.length) {
        lines.push('### Relevant existing tests', '');
        for (const test of report.relevantExistingTests) lines.push(`- ${test.file} (${test.matchReason})`);
        lines.push('');
    }
    if (report.prIncludedTestSummary) {
        lines.push(`### Tests included in this PR (${report.prIncludedTestSummary.scenarioCount} declared test names/scenarios; not executed)`, '');
        for (const file of report.prIncludedTestSummary.files) {
            const test = report.prIncludedTestSummary.tests?.find((entry) => entry.file === file);
            lines.push(`- ${file}${test?.type === 'go' ? ' [Go]' : ''} — not executed`);
            for (const scenario of test?.scenarios || []) lines.push(`  - ${scenario}`);
        }
        lines.push('');
    }
    if (report.affectedFunctions?.length) {
        lines.push('### Affected functions', '');
        for (const f of report.affectedFunctions) {
            lines.push(`- ${f.node.name} (${f.node.id}, ${f.node.kind}${f.node.filePath ? `, ${f.node.filePath}` : ''}) — ${f.impact}, depth ${f.depth}`);
            for (const caller of f.calledBy) lines.push(`  - Called by: ${caller.name}${caller.filePath ? ` (${caller.filePath})` : ''}`);
            for (const test of f.testedBy) lines.push(`  - Associated test: ${test.name}${test.filePath ? ` (${test.filePath})` : ''} (not execution evidence)`);
        }
        lines.push('');
    }

    // Flows table
    if (report.impactedFlows.length > 0) {
        lines.push('### Impacted User Flows');
        lines.push('');
        lines.push('| Status | Priority | Flow | Tests | Gaps |');
        lines.push('|--------|----------|------|-------|------|');
        for (const flow of report.impactedFlows) {
            const statusIcon = flow.status === 'associated' ? '🔎' : flow.status === 'covered' ? '✅' : flow.status === 'partial' ? '⚠️' : '❌';
            const testCount = flow.existingTests.length > 0 ? `${flow.existingTests.length} test${flow.existingTests.length !== 1 ? 's' : ''}` : 'none';
            const gapText = flow.gaps.length > 0 ? flow.gaps.join('; ') : '-';
            const status = flow.status === 'associated' ? 'associated (unverified)' : flow.status === 'covered' ? 'covered' : flow.status === 'partial' ? 'partial' : 'no associated specs';
            lines.push(`| ${statusIcon} ${status} | ${flow.priority} | ${escapeTableCell(flow.name)} | ${testCount} | ${escapeTableCell(gapText)} |`);
        }
        lines.push('');
        for (const flow of report.impactedFlows) {
            lines.push(`**${flow.name}**`);
            for (const file of flow.existingTests) lines.push(`- Existing test: ${file}`);
            for (const file of flow.changedFiles) lines.push(`- Changed: ${file}`);
            for (const userFlow of flow.userFlows) lines.push(`- User flow: ${userFlow}`);
            if (flow.riskNote) lines.push(`- Risk: ${flow.riskNote}`);
            lines.push('');
        }
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
    lines.push(`- Impacted flows: ${m.impactedFlows} (${m.associatedFlows || 0} associated, ${m.coveredFlows} covered, ${m.partialFlows} partial, ${m.uncoveredFlows} without associated specs)`);
    lines.push(`- Coverage gaps: ${m.coverageGaps}`);
    lines.push(`- Confidence: ${formatConfidence(report)}`);
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
    return {...report};
}

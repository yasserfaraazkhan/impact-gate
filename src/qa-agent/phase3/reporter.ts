// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';

import type {HealthScore, Phase1Result, Phase2Result, Phase25Result, Phase3Result, QAConfig, QAReport, RegressionComparison, ReleaseVerdict} from '../types.js';
import {formatHealthScoreMarkdown} from '../health_score.js';

export function generateReport(
    config: QAConfig,
    phase1: Phase1Result,
    phase2: Phase2Result,
    verdict: ReleaseVerdict,
    generatedSpecs: string[],
    phase25?: Phase25Result,
    healthScore?: HealthScore,
    regressionComparison?: RegressionComparison,
): Phase3Result {
    const outputDir = config.outputDir || '.e2e-ai-agents';
    mkdirSync(outputDir, {recursive: true});

    const reportPath = join(outputDir, 'qa-report.json');
    const summaryPath = join(outputDir, 'qa-summary.md');

    const report: QAReport = {
        schemaVersion: '1.1.0',
        generatedAt: new Date().toISOString(),
        mode: config.mode,
        config: {
            baseUrl: config.baseUrl,
            timeLimitMinutes: config.timeLimitMinutes,
            budgetUSD: config.budgetUSD,
            fixTier: config.fixTier,
        },
        phase1,
        phase2,
        phase25,
        phase3: {
            reportPath,
            summaryPath,
            verdict,
            generatedSpecs,
        },
        verdict,
        healthScore,
        regressionComparison,
    };

    try {
        writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    } catch (err) {
        throw new Error(`Failed to write report to ${reportPath}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const markdown = renderMarkdown(report);
    try {
        writeFileSync(summaryPath, markdown, 'utf-8');
    } catch (err) {
        throw new Error(`Failed to write summary to ${summaryPath}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
        reportPath,
        summaryPath,
        verdict,
        generatedSpecs,
    };
}

function renderMarkdown(report: QAReport): string {
    const v = report.verdict;
    const badge = v.decision === 'go' ? '✅ GO' : v.decision === 'no-go' ? '❌ NO-GO' : '⚠️ CONDITIONAL';

    const lines: string[] = [
        `# QA Agent Report — ${badge}`,
        '',
    ];

    // Metadata table
    lines.push(
        '| Field | Value |',
        '|-------|-------|',
        `| **Date** | ${report.generatedAt} |`,
        `| **URL** | ${report.config.baseUrl} |`,
        `| **Mode** | ${report.mode} |`,
        `| **Fix Tier** | ${report.config.fixTier || 'standard'} |`,
        `| **Duration** | ${Math.round(report.phase2.durationMs / 1000)}s |`,
        `| **Cost** | $${report.phase2.costUSD.toFixed(4)} |`,
        '',
    );

    // Health score
    if (report.healthScore) {
        lines.push(formatHealthScoreMarkdown(report.healthScore));
        lines.push('');
    }

    // Verdict
    lines.push(
        `## Verdict: ${badge}`,
        '',
        v.reason,
        '',
        '| Severity | Count |',
        '|----------|-------|',
        `| Critical | ${v.criticalFindings} |`,
        `| High | ${v.highFindings} |`,
        `| Medium | ${v.mediumFindings} |`,
        `| Low | ${v.lowFindings} |`,
        '',
    );

    // Top 3 things to fix
    const topFindings = report.phase2.findings
        .filter((f) => f.type !== 'verified-ok')
        .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity))
        .slice(0, 3);
    if (topFindings.length > 0) {
        lines.push('## Top Issues to Fix', '');
        for (let i = 0; i < topFindings.length; i++) {
            const f = topFindings[i];
            lines.push(`${i + 1}. **[${f.severity.toUpperCase()}] ${f.summary}** — ${f.evidence.url}`);
        }
        lines.push('');
    }

    // Phase 1 summary
    const specTotal = report.phase1.specResults.length;
    const specPassed = report.phase1.specResults.reduce((s, r) => s + r.passed, 0);
    const specFailed = report.phase1.specResults.reduce((s, r) => s + r.failed, 0);
    lines.push(
        '## Phase 1: Scripted Tests',
        '',
        `- Flows identified: ${report.phase1.flows.length}`,
        `- Specs run: ${specTotal} (${specPassed} passed, ${specFailed} failed)`,
        '',
    );

    // Phase 2 summary
    lines.push(
        '## Phase 2: Autonomous Exploration',
        '',
        `- Flows explored: ${report.phase2.flowsExplored.length}`,
        `- Actions taken: ${report.phase2.actionsCount}`,
        `- Duration: ${Math.round(report.phase2.durationMs / 1000)}s`,
        `- Cost: $${report.phase2.costUSD.toFixed(4)}`,
        `- Tokens: ${report.phase2.tokensUsed}`,
        '',
    );

    // Phase 2.5: Fixes applied
    if (report.phase25) {
        const p25 = report.phase25;
        lines.push(
            '## Phase 2.5: Fix Loop',
            '',
            `- Fixes attempted: ${p25.fixesAttempted}`,
            `- Verified: ${p25.fixesVerified}`,
            `- Best-effort: ${p25.fixesBestEffort}`,
            `- Reverted: ${p25.fixesReverted}`,
            `- Skipped: ${p25.fixesSkipped}`,
            `- Health score: ${p25.healthScoreBefore.overall} → ${p25.healthScoreAfter.overall}`,
            `- Duration: ${Math.round(p25.durationMs / 1000)}s`,
            `- Cost: $${p25.costUSD.toFixed(4)}`,
            '',
        );

        if (p25.fixes.length > 0) {
            lines.push(
                '| Issue | Status | Commit | Files |',
                '|-------|--------|--------|-------|',
            );
            for (const fix of p25.fixes) {
                const finding = report.phase2.findings.find((f) => f.id === fix.findingId);
                const summary = finding ? finding.summary.slice(0, 50) : fix.findingId;
                const commit = fix.commitHash || '—';
                const files = fix.filesChanged?.join(', ') || '—';
                lines.push(`| ${summary} | ${fix.status} | ${commit} | ${files} |`);
            }
            lines.push('');
        }
    }

    // Findings
    if (report.phase2.findings.length > 0) {
        lines.push('## Findings', '');
        for (const f of report.phase2.findings) {
            if (f.type === 'verified-ok') continue;
            const dupNote = f.duplicateCount && f.duplicateCount > 1
                ? ` (seen ${f.duplicateCount} times)`
                : '';
            lines.push(`### [${f.severity.toUpperCase()}] ${f.summary}${dupNote}`);
            lines.push('');
            lines.push(`- **Type:** ${f.type}`);
            lines.push(`- **Flow:** ${f.flow}`);
            lines.push(`- **URL:** ${f.evidence.url}`);

            if (f.evidence.expectedBehavior || f.evidence.actualBehavior) {
                const escapePipe = (s: string) => s.replace(/\|/g, '\\|');
                lines.push('');
                lines.push('| Expected | Actual |');
                lines.push('|----------|--------|');
                lines.push(`| ${escapePipe(f.evidence.expectedBehavior || '—')} | ${escapePipe(f.evidence.actualBehavior || '—')} |`);
                lines.push('');
            }

            if (f.evidence.screenshotRefs && f.evidence.screenshotRefs.length > 0) {
                for (const ref of f.evidence.screenshotRefs) {
                    lines.push(`![Evidence](${ref})`);
                }
            } else if (f.evidence.screenshotPath) {
                lines.push(`![Evidence](${f.evidence.screenshotPath})`);
            }

            if (f.evidence.consoleErrors && f.evidence.consoleErrors.length > 0) {
                lines.push('');
                lines.push('**Console errors:**');
                for (const err of f.evidence.consoleErrors.slice(0, 5)) {
                    lines.push(`- \`${err.replace(/`/g, '\\`')}\``);
                }
            }

            if (f.evidence.reproSteps.length > 0) {
                lines.push('');
                lines.push('**Repro steps:**');
                for (const step of f.evidence.reproSteps) {
                    lines.push(`  1. ${step}`);
                }
            }
            lines.push('');
        }
    }

    // Regression comparison
    if (report.regressionComparison) {
        const rc = report.regressionComparison;
        const deltaSign = rc.scoreDelta >= 0 ? '+' : '';
        lines.push(
            '## Regression Comparison',
            '',
            `- **Baseline date:** ${rc.baselineDate}`,
            `- **Score delta:** ${deltaSign}${rc.scoreDelta}`,
            '',
        );

        if (Object.keys(rc.categoryDeltas).length > 0) {
            lines.push('| Category | Delta |');
            lines.push('|----------|-------|');
            for (const [cat, delta] of Object.entries(rc.categoryDeltas)) {
                const sign = (delta as number) >= 0 ? '+' : '';
                lines.push(`| ${cat} | ${sign}${delta} |`);
            }
            lines.push('');
        }

        if (rc.fixedIssues.length > 0) {
            lines.push('**Fixed since baseline:**');
            for (const issue of rc.fixedIssues) {
                lines.push(`- ${issue}`);
            }
            lines.push('');
        }

        if (rc.newIssues.length > 0) {
            lines.push('**New since baseline:**');
            for (const issue of rc.newIssues) {
                lines.push(`- ${issue}`);
            }
            lines.push('');
        }
    }

    // Flow sign-offs
    lines.push('## Flow Sign-offs', '');
    lines.push('| Flow | Status | Findings |');
    lines.push('|------|--------|----------|');
    for (const s of v.flowSignoffs) {
        const statusIcon = s.status === 'passed' ? '✅' : s.status === 'failed' ? '❌' : '⏭️';
        lines.push(`| ${s.flowName} | ${statusIcon} ${s.status} | ${s.findings.length} |`);
    }
    lines.push('');

    // Generated specs
    if (report.phase3.generatedSpecs.length > 0) {
        lines.push('## Generated Specs', '');
        for (const spec of report.phase3.generatedSpecs) {
            lines.push(`- ${spec}`);
        }
        lines.push('');
    }

    // Ship readiness summary
    lines.push('## Ship Readiness', '');
    const score = report.healthScore?.overall ?? '—';
    const fixCount = report.phase25 ? `${report.phase25.fixesVerified} verified, ${report.phase25.fixesBestEffort} best-effort` : 'no fixes';
    lines.push(`> QA found ${report.phase2.findings.filter((f) => f.type !== 'verified-ok').length} issues (${fixCount}). Health score: ${score}/100. Verdict: **${v.decision.toUpperCase()}**.`);
    lines.push('');

    return lines.join('\n');
}

function severityOrder(severity: string): number {
    switch (severity) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    default: return 4;
    }
}

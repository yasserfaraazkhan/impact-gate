// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {mkdirSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';

import type {Phase1Result, Phase2Result, Phase3Result, QAConfig, QAReport, ReleaseVerdict} from '../types.js';

export function generateReport(
    config: QAConfig,
    phase1: Phase1Result,
    phase2: Phase2Result,
    verdict: ReleaseVerdict,
    generatedSpecs: string[],
): Phase3Result {
    const outputDir = config.outputDir || '.e2e-ai-agents';
    mkdirSync(outputDir, {recursive: true});

    const reportPath = join(outputDir, 'qa-report.json');
    const summaryPath = join(outputDir, 'qa-summary.md');

    const report: QAReport = {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        mode: config.mode,
        config: {
            baseUrl: config.baseUrl,
            timeLimitMinutes: config.timeLimitMinutes,
            budgetUSD: config.budgetUSD,
        },
        phase1,
        phase2,
        phase3: {
            reportPath,
            summaryPath,
            verdict,
            generatedSpecs,
        },
        verdict,
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
        `**Mode:** ${report.mode}`,
        `**Base URL:** ${report.config.baseUrl}`,
        `**Generated:** ${report.generatedAt}`,
        '',
        `## Verdict`,
        '',
        `**Decision:** ${badge}`,
        `**Reason:** ${v.reason}`,
        '',
        `| Severity | Count |`,
        `|----------|-------|`,
        `| Critical | ${v.criticalFindings} |`,
        `| High | ${v.highFindings} |`,
        `| Medium | ${v.mediumFindings} |`,
        `| Low | ${v.lowFindings} |`,
        '',
    ];

    // Phase 1 summary
    const specTotal = report.phase1.specResults.length;
    const specPassed = report.phase1.specResults.reduce((s, r) => s + r.passed, 0);
    const specFailed = report.phase1.specResults.reduce((s, r) => s + r.failed, 0);
    lines.push(
        `## Phase 1: Scripted Tests`,
        '',
        `- Flows identified: ${report.phase1.flows.length}`,
        `- Specs run: ${specTotal} (${specPassed} passed, ${specFailed} failed)`,
        '',
    );

    // Phase 2 summary
    lines.push(
        `## Phase 2: Autonomous Exploration`,
        '',
        `- Flows explored: ${report.phase2.flowsExplored.length}`,
        `- Actions taken: ${report.phase2.actionsCount}`,
        `- Duration: ${Math.round(report.phase2.durationMs / 1000)}s`,
        `- Cost: $${report.phase2.costUSD.toFixed(4)}`,
        `- Tokens: ${report.phase2.tokensUsed}`,
        '',
    );

    // Findings
    if (report.phase2.findings.length > 0) {
        lines.push(`## Findings`, '');
        for (const f of report.phase2.findings) {
            lines.push(`### [${f.severity.toUpperCase()}] ${f.summary}`);
            lines.push('');
            lines.push(`- **Type:** ${f.type}`);
            lines.push(`- **Flow:** ${f.flow}`);
            lines.push(`- **URL:** ${f.evidence.url}`);
            if (f.evidence.screenshotPath) {
                lines.push(`- **Screenshot:** ${f.evidence.screenshotPath}`);
            }
            if (f.evidence.reproSteps.length > 0) {
                lines.push('- **Repro steps:**');
                for (const step of f.evidence.reproSteps) {
                    lines.push(`  1. ${step}`);
                }
            }
            lines.push('');
        }
    }

    // Flow sign-offs
    lines.push(`## Flow Sign-offs`, '');
    lines.push(`| Flow | Status | Findings |`);
    lines.push(`|------|--------|----------|`);
    for (const s of v.flowSignoffs) {
        const statusIcon = s.status === 'passed' ? '✅' : s.status === 'failed' ? '❌' : '⏭️';
        lines.push(`| ${s.flowName} | ${statusIcon} ${s.status} | ${s.findings.length} |`);
    }
    lines.push('');

    // Generated specs
    if (report.phase3.generatedSpecs.length > 0) {
        lines.push(`## Generated Specs`, '');
        for (const spec of report.phase3.generatedSpecs) {
            lines.push(`- ${spec}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

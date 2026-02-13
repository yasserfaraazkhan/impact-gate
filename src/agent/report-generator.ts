/**
 * Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
 * See LICENSE.txt for license information.
 *
 * Report Generation Engine
 *
 * Generates console, markdown, and JSON reports from impact analysis results.
 */

import {writeFileSync, mkdirSync} from 'fs';
import {join} from 'path';
import type {ImpactReport} from './impact-analyzer';

// =============================================================================
// REPORT GENERATION
// =============================================================================

export interface ReportOptions {
    console?: boolean;
    markdown?: boolean;
    json?: boolean;
    outputDir?: string;
}

/**
 * Generate all requested report formats
 */
export async function generateReports(analysis: ImpactReport, options: ReportOptions = {}): Promise<void> {
    const {
        console: consoleReport = true,
        markdown = true,
        json = true,
        outputDir = './.e2e-ai-agents/reports',
    } = options;

    if (consoleReport) {
        printConsoleReport(analysis);
    }

    if (markdown || json) {
        mkdirSync(outputDir, {recursive: true});
    }

    if (markdown) {
        const mdPath = join(outputDir, `impact-${Date.now()}.md`);
        const markdownReport = generateMarkdownReport(analysis);
        writeFileSync(mdPath, markdownReport);
        console.log(`\n📄 Markdown report: ${mdPath}`);
    }

    if (json) {
        const jsonPath = join(outputDir, `impact-${Date.now()}.json`);
        writeFileSync(jsonPath, JSON.stringify(analysis, null, 2));
        console.log(`📊 JSON report: ${jsonPath}`);
    }
}

// =============================================================================
// CONSOLE REPORT
// =============================================================================

function printConsoleReport(analysis: ImpactReport): void {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('📊 CODE IMPACT ANALYSIS REPORT');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    // Summary
    console.log('📈 SUMMARY');
    console.log(`   Changed files: ${analysis.totalChanges}`);
    console.log(`   Affected flows: ${analysis.affectedFlows.length}`);
    console.log(
        `   Priority breakdown: P0=${analysis.priorityBreakdown.p0}, P1=${analysis.priorityBreakdown.p1}, P2=${analysis.priorityBreakdown.p2}`,
    );
    console.log(
        `   Test coverage: ${analysis.testCoverage.covered}/${analysis.testCoverage.total} flows have tests (${analysis.testCoverage.gaps} gaps)\n`,
    );

    // P0 Flows (Critical)
    const p0Flows = analysis.affectedFlows.filter((f) => f.flow.priority === 'P0');
    if (p0Flows.length > 0) {
        console.log('🔴 CRITICAL (P0) FLOWS AFFECTED:');
        p0Flows.forEach((impact) => {
            console.log(`   • ${impact.flow.name} (${impact.flow.id})`);
            console.log(`     Confidence: ${impact.confidence}% | Match: ${impact.matchType}`);
            console.log(
                `     Existing tests: ${impact.existingTests.length} ${impact.existingTests.length > 0 ? '✓' : '✗'}`,
            );
            if (impact.testGaps.length > 0) {
                console.log(
                    `     ⚠️  Test gaps: ${impact.testGaps.slice(0, 2).join(', ')}${impact.testGaps.length > 2 ? '...' : ''}`,
                );
            }
            console.log(`     Affected files: ${impact.affectedFiles.length}`);
        });
        console.log('');
    }

    // P1 Flows (High Priority)
    const p1Flows = analysis.affectedFlows.filter((f) => f.flow.priority === 'P1');
    if (p1Flows.length > 0) {
        console.log('🟡 HIGH PRIORITY (P1) FLOWS AFFECTED:');
        p1Flows.slice(0, 5).forEach((impact) => {
            console.log(`   • ${impact.flow.name} (${impact.flow.id})`);
            console.log(
                `     Tests: ${impact.existingTests.length}/${impact.affectedFiles.length} files, Gaps: ${impact.testGaps.length}`,
            );
        });
        if (p1Flows.length > 5) {
            console.log(`   ... and ${p1Flows.length - 5} more P1 flows`);
        }
        console.log('');
    }

    // Recommendations
    if (analysis.recommendations.length > 0) {
        console.log('💡 RECOMMENDATIONS:');
        analysis.recommendations.forEach((rec, i) => {
            console.log(`   ${i + 1}. ${rec}`);
        });
        console.log('');
    }

    // Action Items
    console.log('🎯 SUGGESTED ACTIONS:');
    if (analysis.hasP0Impact) {
        console.log('   1. Run P0 flow tests immediately:');
        const p0Tests = p0Flows.flatMap((f) => f.existingTests).filter((t) => t);
        if (p0Tests.length > 0) {
            console.log(`      npx playwright test ${p0Tests.slice(0, 3).join(' ')}`);
            if (p0Tests.length > 3) {
                console.log(`      ... and ${p0Tests.length - 3} more P0 tests`);
            }
        } else {
            console.log('      ⚠️  No existing P0 tests found - generate tests first:');
            console.log('      npx e2e-ai-agents approve-and-generate --path <app-root> --tests-root <tests-root> --pipeline --pipeline-scenarios 3');
        }
    }

    if (analysis.testCoverage.gaps > 0) {
        console.log(`   2. Address ${analysis.testCoverage.gaps} test coverage gap(s):`);
        const gapFlows = analysis.affectedFlows.filter((f) => f.testGaps.length > 0).slice(0, 2);
        gapFlows.forEach(() => {
            console.log('      npx e2e-ai-agents approve-and-generate --path <app-root> --tests-root <tests-root> --pipeline --pipeline-scenarios 3');
        });
        if (analysis.testCoverage.gaps > 2) {
            console.log(`      # ... and ${analysis.testCoverage.gaps - 2} more flows with gaps`);
        }
    }

    console.log('\n═══════════════════════════════════════════════════════════════════\n');
}

// =============================================================================
// MARKDOWN REPORT
// =============================================================================

function generateMarkdownReport(analysis: ImpactReport): string {
    const lines: string[] = [];

    lines.push('# Code Impact Analysis Report');
    lines.push('');
    lines.push(`**Generated**: ${new Date(analysis.timestamp).toLocaleString()}`);
    lines.push(`**Git Reference**: ${analysis.gitRef}`);
    lines.push('');

    // Risk Level Badge
    const riskLevel = analysis.hasP0Impact
        ? '🔴 **HIGH** (P0 flows affected)'
        : analysis.priorityBreakdown.p1 > 0
          ? '🟡 **MEDIUM** (P1 flows affected)'
          : '🟢 **LOW** (Only P2 flows affected)';

    // Executive Summary
    lines.push('## Executive Summary');
    lines.push('');
    lines.push(`- **Changed files**: ${analysis.totalChanges}`);
    lines.push(`- **Affected flows**: ${analysis.affectedFlows.length}`);
    lines.push(
        `- **Priority**: P0=${analysis.priorityBreakdown.p0}, P1=${analysis.priorityBreakdown.p1}, P2=${analysis.priorityBreakdown.p2}`,
    );
    lines.push(
        `- **Test coverage**: ${analysis.testCoverage.covered}/${analysis.testCoverage.total} flows have tests (${analysis.testCoverage.gaps} gaps)`,
    );
    lines.push(`- **Risk level**: ${riskLevel}`);
    lines.push('');

    // Critical Flows
    const p0Flows = analysis.affectedFlows.filter((f) => f.flow.priority === 'P0');
    if (p0Flows.length > 0) {
        lines.push('## 🔴 Critical (P0) Flows Affected');
        lines.push('');
        p0Flows.forEach((impact) => {
            lines.push(`### ${impact.flow.name} (\`${impact.flow.id}\`)`);
            lines.push('');
            lines.push(`**Confidence**: ${impact.confidence}%`);
            lines.push(`**Match type**: ${impact.matchType}`);
            lines.push(
                `**Affected files**: ${impact.affectedFiles.length} file${impact.affectedFiles.length !== 1 ? 's' : ''}`,
            );
            lines.push('');
            lines.push(
                `**Existing tests**: ${impact.existingTests.length > 0 ? '✓ ' + impact.existingTests.length : '✗ None'}`,
            );
            if (impact.existingTests.length > 0) {
                lines.push('```');
                impact.existingTests.slice(0, 3).forEach((test) => {
                    lines.push(test);
                });
                if (impact.existingTests.length > 3) {
                    lines.push(`... and ${impact.existingTests.length - 3} more`);
                }
                lines.push('```');
            }

            if (impact.testGaps.length > 0) {
                lines.push('');
                lines.push(`**Test gaps**:`);
                impact.testGaps.slice(0, 3).forEach((gap) => {
                    lines.push(`- ${gap}`);
                });
                if (impact.testGaps.length > 3) {
                    lines.push(`- ... and ${impact.testGaps.length - 3} more`);
                }
            }

            lines.push('');
        });
    }

    // High Priority Flows
    const p1Flows = analysis.affectedFlows.filter((f) => f.flow.priority === 'P1');
    if (p1Flows.length > 0) {
        lines.push('## 🟡 High Priority (P1) Flows Affected');
        lines.push('');
        lines.push('| Flow | ID | Files | Tests | Gaps |');
        lines.push('|------|----| ------|-------|------|');
        p1Flows.slice(0, 10).forEach((impact) => {
            lines.push(
                `| ${impact.flow.name} | \`${impact.flow.id}\` | ${impact.affectedFiles.length} | ${impact.existingTests.length} | ${impact.testGaps.length} |`,
            );
        });
        if (p1Flows.length > 10) {
            lines.push(`| ... ${p1Flows.length - 10} more | ... | ... | ... | ... |`);
        }
        lines.push('');
    }

    // Recommendations
    if (analysis.recommendations.length > 0) {
        lines.push('## 💡 Recommendations');
        lines.push('');
        analysis.recommendations.forEach((rec, i) => {
            lines.push(`${i + 1}. ${rec}`);
        });
        lines.push('');
    }

    // Action Items
    lines.push('## 🎯 Action Items');
    lines.push('');

    if (analysis.hasP0Impact) {
        lines.push('### Immediate: Run P0 Tests');
        lines.push('');
        const p0Tests = p0Flows.flatMap((f) => f.existingTests).filter((t) => t);
        if (p0Tests.length > 0) {
            lines.push('```bash');
            lines.push(`npx playwright test ${p0Tests.slice(0, 3).join(' ')}`);
            if (p0Tests.length > 3) {
                lines.push(`# ... and ${p0Tests.length - 3} more P0 tests`);
            }
            lines.push('```');
        } else {
            lines.push('No existing P0 tests found. Generate tests:');
            lines.push('');
            lines.push('```bash');
            lines.push('npx e2e-ai-agents approve-and-generate --path <app-root> --tests-root <tests-root> --pipeline --pipeline-scenarios 3');
            lines.push('```');
        }
        lines.push('');
    }

    if (analysis.testCoverage.gaps > 0) {
        lines.push('### Generate Missing Tests');
        lines.push('');
        const gapFlows = analysis.affectedFlows.filter((f) => f.testGaps.length > 0).slice(0, 3);

        if (gapFlows.length > 0) {
            lines.push('```bash');
            gapFlows.forEach(() => {
                lines.push('npx e2e-ai-agents approve-and-generate --path <app-root> --tests-root <tests-root> --pipeline --pipeline-scenarios 3');
            });
            if (analysis.testCoverage.gaps > 3) {
                lines.push(`# ... and ${analysis.testCoverage.gaps - 3} more gaps to address`);
            }
            lines.push('```');
        }
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(
        '_This report was generated by the E2E Impact Analysis Agent. To regenerate, run: `npx e2e-ai-agents impact --path <app-root> --tests-root <tests-root>`_',
    );

    return lines.join('\n');
}

// =============================================================================
// JSON REPORT
// =============================================================================

/**
 * JSON report is generated directly in generateReports()
 * No additional formatting needed
 */

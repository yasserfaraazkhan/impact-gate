// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';

import type {AgentConfig} from '../../agent/config.js';
import type {CrewPlanInsights, PlanReport} from '../../agent/plan.js';
import {CrossImpactAgent} from '../../agents/cross-impact.js';
import {ImpactAnalystAgent} from '../../agents/impact-analyst.js';
import {RegressionAdvisorAgent} from '../../agents/regression-advisor.js';
import {StrategistAgent} from '../../agents/strategist.js';
import {TestDesignerAgent} from '../../agents/test-designer.js';
import {CrewOrchestrator} from '../../crew/orchestrator.js';
import type {TestDesign} from '../../crew/types.js';
import type {WorkflowName} from '../../crew/workflows.js';

import type {ParsedArgs} from '../types.js';

const VALID_WORKFLOWS = new Set<WorkflowName>(['full-qa', 'quick-check', 'design-only']);

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function singleLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function chooseCrewWorkflow(explicitWorkflow: string | undefined, plan: PlanReport): WorkflowName {
    if (explicitWorkflow && VALID_WORKFLOWS.has(explicitWorkflow as WorkflowName)) {
        return explicitWorkflow as WorkflowName;
    }

    if (plan.decision.action === 'must-add-tests' || plan.metrics.uncoveredP0P1Flows > 0) {
        return 'design-only';
    }

    return 'quick-check';
}

function registerCrewAgents(orchestrator: CrewOrchestrator): void {
    orchestrator.registerAgent(new ImpactAnalystAgent());
    orchestrator.registerAgent(new StrategistAgent());
    orchestrator.registerAgent(new TestDesignerAgent());
    orchestrator.registerAgent(new CrossImpactAgent());
    orchestrator.registerAgent(new RegressionAdvisorAgent());
}

export async function runPlanCrewAnalysis(plan: PlanReport, config: AgentConfig, args: ParsedArgs): Promise<CrewPlanInsights> {
    const reportRoot = config.testsRoot || config.path;
    const workflow = chooseCrewWorkflow(args.crewWorkflow, plan);
    const normalizedProvider = config.llm.provider?.trim().toLowerCase();
    const providerOverride = normalizedProvider && normalizedProvider !== 'auto' ? normalizedProvider : 'auto';

    const orchestrator = new CrewOrchestrator();
    registerCrewAgents(orchestrator);

    const result = await orchestrator.run({
        appPath: config.path,
        testsRoot: reportRoot,
        gitSince: args.gitSince || config.git.since,
        routeFamilies: config.routeFamilies,
        apiSurface: config.apiSurface,
        workflow,
        providerOverride: providerOverride === 'auto' ? undefined : providerOverride,
        budgetUSD: args.budgetUSD,
        dryRun: args.dryRun,
    });

    const ctx = result.context;
    const highRiskCrossImpacts = ctx.crossImpacts.filter((entry) => entry.riskLevel === 'high');
    const manualReviewEntries = ctx.strategyEntries.filter((entry) => entry.approach === 'manual-review');

    return {
        workflow,
        providerOverride,
        summary: {
            impactedFlows: ctx.impactedFlows.length,
            strategyEntries: ctx.strategyEntries.length,
            testDesigns: ctx.testDesigns.length,
            crossImpacts: ctx.crossImpacts.length,
            highRiskCrossImpacts: highRiskCrossImpacts.length,
            regressionRisks: ctx.regressionRisks.length,
            findings: ctx.findings.length,
            generatedSpecs: ctx.generatedSpecs.length,
            manualReviewEntries: manualReviewEntries.length,
            totalCostUSD: Number(ctx.usage.totalCost.toFixed(4)),
            totalTokens: ctx.usage.totalTokens,
        },
        impactedFlows: ctx.impactedFlows,
        strategyEntries: ctx.strategyEntries,
        testDesigns: ctx.testDesigns,
        crossImpacts: ctx.crossImpacts,
        regressionRisks: ctx.regressionRisks,
        findings: ctx.findings,
        warnings: uniqueStrings([...ctx.warnings, ...result.warnings]),
        timings: result.timings,
    };
}

/**
 * Match a strategy/design entry against a set of gap family IDs.
 */
function matchesGapFamily(flowId: string, flowName: string, gapFamilies: Set<string>): boolean {
    return Array.from(gapFamilies).some((fam) =>
        flowId.startsWith(fam) || flowName.toLowerCase().includes(fam.replace(/_/g, ' ')),
    );
}

export function buildCrewMarkdown(crew: CrewPlanInsights, plan?: PlanReport): string {
    const totalCases = crew.testDesigns.reduce((n, td) => n + td.testCases.length, 0);
    const gapFamilies = new Set((plan?.gapDetails ?? []).map((g) => g.id));

    const lines = [
        '### Crew Insights',
        '',
        `Workflow: \`${crew.workflow}\``,
        `Impacted flows: **${crew.summary.impactedFlows}**`,
        `Strategy entries: **${crew.summary.strategyEntries}**`,
    ];

    if (totalCases > 0) {
        const gapDesigns = gapFamilies.size > 0
            ? crew.testDesigns.filter((td) => matchesGapFamily(td.flowId, td.flowName, gapFamilies))
            : [];
        const gapCases = gapDesigns.reduce((n, td) => n + td.testCases.length, 0);
        const gapP0Cases = gapDesigns.reduce((n, td) => n + td.testCases.filter((tc) => tc.priority === 'P0').length, 0);
        lines.push(`Structured test designs: **${crew.summary.testDesigns}** flows, **${totalCases}** test cases`);
        if (gapDesigns.length > 0) {
            lines.push(`Gap-focused: **${gapDesigns.length}** flows, **${gapCases}** test cases (**${gapP0Cases}** P0)`);
        }
    }

    if (crew.summary.crossImpacts > 0) {
        lines.push(`Cross-impacts: **${crew.summary.crossImpacts}** (${crew.summary.highRiskCrossImpacts} high risk)`);
    }

    lines.push(`Estimated AI cost: **$${crew.summary.totalCostUSD.toFixed(4)}**`);

    if (crew.strategyEntries.length > 0) {
        lines.push('');
        lines.push('Top Strategy Recommendations:');
        for (const entry of crew.strategyEntries.slice(0, 5)) {
            lines.push(`- ${entry.priority} ${entry.flowName} -> ${entry.approach} (${entry.crossImpactRisk} cross-impact risk)`);
        }
    }

    if (crew.testDesigns.length > 0) {
        lines.push('');
        lines.push('Structured Test Designs:');
        for (const design of crew.testDesigns.slice(0, 3)) {
            lines.push(`- ${design.flowName}: ${design.testCases.length} designed test case(s)`);
        }
    }

    const riskyCrossImpacts = crew.crossImpacts.filter((entry) => entry.riskLevel === 'high');
    if (riskyCrossImpacts.length > 0) {
        lines.push('');
        lines.push('High-Risk Cross-Impacts:');
        for (const entry of riskyCrossImpacts.slice(0, 5)) {
            lines.push(`- ${entry.sourceFamily} -> ${entry.affectedFamily}: ${entry.sharedDependency}`);
        }
    }

    if (crew.findings.length > 0) {
        lines.push('');
        lines.push('Crew Findings:');
        for (const finding of crew.findings.slice(0, 5)) {
            lines.push(`- ${finding.severity} ${finding.type}: ${finding.summary}`);
        }
    }

    if (crew.warnings.length > 0) {
        lines.push('');
        lines.push('Crew Warnings:');
        for (const warning of crew.warnings.slice(0, 5)) {
            lines.push(`- ${singleLine(warning)}`);
        }
    }

    return lines.join('\n');
}

export function appendCrewToSummary(baseMarkdown: string, crew: CrewPlanInsights, plan?: PlanReport): string {
    return `${baseMarkdown}\n\n---\n\n${buildCrewMarkdown(crew, plan)}`;
}

/**
 * Build a full structured test plan as a Markdown document.
 * Sections: gap flows first (P0 cases expanded), then covered-flow smoke tests.
 */
export function buildCrewTestPlan(crew: CrewPlanInsights, plan?: PlanReport): string {
    const gapFamilies = new Set((plan?.gapDetails ?? []).map((g) => g.id));
    const hasTestDesigns = crew.testDesigns.length > 0;
    const totalCases = crew.testDesigns.reduce((n, td) => n + td.testCases.length, 0);

    // Split strategy entries into gap-related and covered
    const gapStrategies = gapFamilies.size > 0
        ? crew.strategyEntries.filter((s) => matchesGapFamily(s.flowId, s.flowName, gapFamilies))
        : [];
    const coveredStrategies = crew.strategyEntries.filter((s) => !gapStrategies.includes(s));

    // Split test designs (if present) into gap-related and covered
    const gapDesigns: TestDesign[] = [];
    const coveredDesigns: TestDesign[] = [];
    for (const td of crew.testDesigns) {
        if (matchesGapFamily(td.flowId, td.flowName, gapFamilies)) {
            gapDesigns.push(td);
        } else {
            coveredDesigns.push(td);
        }
    }
    const gapCases = gapDesigns.reduce((n, td) => n + td.testCases.length, 0);
    const coveredCases = coveredDesigns.reduce((n, td) => n + td.testCases.length, 0);

    const lines: string[] = [
        '# Crew Test Plan',
        '',
        `> Auto-generated by e2e-agents crew (\`${crew.workflow}\` workflow)`,
        '',
        '## Summary',
        '',
        `| Metric | Count |`,
        `|--------|-------|`,
        `| Gap flows (missing tests) | ${gapStrategies.length} flows${hasTestDesigns ? `, **${gapCases} test cases**` : ''} |`,
        `| Covered flows (expansion) | ${coveredStrategies.length} flows${hasTestDesigns ? `, ${coveredCases} test cases` : ''} |`,
        `| Total strategy entries | ${crew.strategyEntries.length} flows${hasTestDesigns ? `, ${totalCases} test cases` : ''} |`,
        `| High-risk cross-impacts | ${crew.summary.highRiskCrossImpacts} |`,
        `| AI cost | $${crew.summary.totalCostUSD.toFixed(4)} |`,
        '',
    ];

    // ── Gap flows ──
    if (gapStrategies.length > 0) {
        lines.push('## Priority: Gap Flows (Missing Tests)');
        lines.push('');
        lines.push('These flows have **no existing E2E coverage** and should be addressed first.');
        lines.push('');

        for (const strategy of gapStrategies) {
            const td = crew.testDesigns.find((d) => d.flowId === strategy.flowId);
            lines.push(`### ${strategy.flowName}`);
            lines.push('');
            lines.push(`Strategy: **${strategy.approach}** | Priority: **${strategy.priority}** | Cross-impact risk: **${strategy.crossImpactRisk}**`);
            if (strategy.rationale) {
                lines.push(`> ${strategy.rationale}`);
            }
            if (strategy.testCategories.length > 0) {
                lines.push(`Test categories: ${strategy.testCategories.join(', ')}`);
            }
            lines.push('');

            // If test designs exist, show P0/P1 cases
            if (td && td.testCases.length > 0) {
                const p0Cases = td.testCases.filter((tc) => tc.priority === 'P0');
                const p1Cases = td.testCases.filter((tc) => tc.priority === 'P1');
                if (p0Cases.length > 0) {
                    lines.push('**P0 — Must test:**');
                    lines.push('');
                    for (const tc of p0Cases) {
                        lines.push(`- [ ] **${tc.name}** (${tc.type})`);
                        if (tc.preconditions.length > 0) {
                            lines.push(`  - Preconditions: ${tc.preconditions.join('; ')}`);
                        }
                        lines.push(`  - Steps: ${tc.steps.join(' → ')}`);
                        lines.push(`  - Expected: ${tc.expectedOutcome}`);
                    }
                    lines.push('');
                }
                if (p1Cases.length > 0) {
                    lines.push(`<details><summary>P1 — Should test (${p1Cases.length})</summary>`);
                    lines.push('');
                    for (const tc of p1Cases) {
                        lines.push(`- [ ] **${tc.name}** (${tc.type}) — ${tc.expectedOutcome}`);
                    }
                    lines.push('');
                    lines.push('</details>');
                    lines.push('');
                }
            }
        }
    }

    // ── Covered flows ──
    if (coveredStrategies.length > 0) {
        lines.push('## Covered Flows (Regression / Expansion)');
        lines.push('');
        lines.push('These flows already have specs. Verify changes haven\'t introduced regressions.');
        lines.push('');

        for (const strategy of coveredStrategies) {
            const td = crew.testDesigns.find((d) => d.flowId === strategy.flowId);
            const caseCount = td ? td.testCases.length : 0;
            const detail = caseCount > 0 ? ` | ${caseCount} cases` : '';
            lines.push(`<details><summary><strong>${strategy.flowName}</strong> — ${strategy.approach}${detail} (${strategy.priority})</summary>`);
            lines.push('');
            lines.push(`Cross-impact risk: ${strategy.crossImpactRisk}`);
            if (strategy.rationale) {
                lines.push(`> ${strategy.rationale}`);
            }
            if (strategy.testCategories.length > 0) {
                lines.push(`Test categories: ${strategy.testCategories.join(', ')}`);
            }
            if (td && td.testCases.length > 0) {
                lines.push('');
                for (const tc of td.testCases) {
                    lines.push(`- [ ] **${tc.name}** (${tc.priority}, ${tc.type}) — ${tc.expectedOutcome}`);
                }
            }
            lines.push('');
            lines.push('</details>');
            lines.push('');
        }
    }

    // ── Cross-impacts ──
    const highRisk = crew.crossImpacts.filter((ci) => ci.riskLevel === 'high');
    if (highRisk.length > 0) {
        lines.push('## High-Risk Cross-Impacts');
        lines.push('');
        lines.push('These cross-family dependencies should be verified during release testing:');
        lines.push('');
        for (const ci of highRisk) {
            lines.push(`- **${ci.sourceFamily}** → **${ci.affectedFamily}**: ${ci.sharedDependency}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

export function writeCrewArtifacts(reportRoot: string, crew: CrewPlanInsights, plan?: PlanReport): {crewSummaryPath: string; crewMarkdownPath: string; crewTestPlanPath: string} {
    const outputDir = join(reportRoot, '.e2e-ai-agents');
    mkdirSync(outputDir, {recursive: true});

    const crewSummaryPath = join(outputDir, 'crew-summary.json');
    const crewMarkdownPath = join(outputDir, 'crew-summary.md');
    const crewTestPlanPath = join(outputDir, 'crew-test-plan.md');

    writeFileSync(crewSummaryPath, JSON.stringify(crew, null, 2), 'utf-8');
    writeFileSync(crewMarkdownPath, buildCrewMarkdown(crew, plan), 'utf-8');
    writeFileSync(crewTestPlanPath, buildCrewTestPlan(crew, plan), 'utf-8');

    return {crewSummaryPath, crewMarkdownPath, crewTestPlanPath};
}

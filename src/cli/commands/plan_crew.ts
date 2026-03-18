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

export function buildCrewMarkdown(crew: CrewPlanInsights): string {
    const lines = [
        '### Crew Insights',
        '',
        `Workflow: \`${crew.workflow}\``,
        `Provider override: \`${crew.providerOverride}\``,
        `Impacted flows: **${crew.summary.impactedFlows}**`,
        `Strategy entries: **${crew.summary.strategyEntries}**`,
        `Structured test designs: **${crew.summary.testDesigns}**`,
        `Cross-impacts: **${crew.summary.crossImpacts}** (${crew.summary.highRiskCrossImpacts} high risk)`,
        `Findings: **${crew.summary.findings}**`,
        `Estimated AI cost: **$${crew.summary.totalCostUSD.toFixed(4)}**`,
    ];

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

export function appendCrewToSummary(baseMarkdown: string, crew: CrewPlanInsights): string {
    return `${baseMarkdown}\n\n---\n\n${buildCrewMarkdown(crew)}`;
}

export function writeCrewArtifacts(reportRoot: string, crew: CrewPlanInsights): {crewSummaryPath: string; crewMarkdownPath: string} {
    const outputDir = join(reportRoot, '.e2e-ai-agents');
    mkdirSync(outputDir, {recursive: true});

    const crewSummaryPath = join(outputDir, 'crew-summary.json');
    const crewMarkdownPath = join(outputDir, 'crew-summary.md');

    writeFileSync(crewSummaryPath, JSON.stringify(crew, null, 2), 'utf-8');
    writeFileSync(crewMarkdownPath, buildCrewMarkdown(crew), 'utf-8');

    return {crewSummaryPath, crewMarkdownPath};
}

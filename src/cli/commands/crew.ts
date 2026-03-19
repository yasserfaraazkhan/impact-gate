// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * CLI command: crew — runs multi-agent QA analysis workflows.
 */

import {appendFileSync, mkdirSync} from 'fs';
import {join} from 'path';

import {resolveConfig} from '../../agent/config.js';
import {CrewOrchestrator, type CrewConfig, type CrewResult} from '../../crew/orchestrator.js';
import {WORKFLOWS, type WorkflowName} from '../../crew/workflows.js';
import {ImpactAnalystAgent} from '../../agents/impact-analyst.js';
import {GeneratorAgent} from '../../agents/generator.js';
import {ExecutorAgent} from '../../agents/executor.js';
import {HealerAgent} from '../../agents/healer.js';
import {StrategistAgent} from '../../agents/strategist.js';
import {TestDesignerAgent} from '../../agents/test-designer.js';
import {CrossImpactAgent} from '../../agents/cross-impact.js';
import {RegressionAdvisorAgent} from '../../agents/regression-advisor.js';
import type {ParsedArgs} from '../types.js';

const VALID_WORKFLOWS: WorkflowName[] = ['full-qa', 'quick-check', 'design-only'];

export async function runCrewCommand(args: ParsedArgs, autoConfig: string | undefined): Promise<void> {
    if (!args.path && !autoConfig) {
        console.error('Error: --path is required for crew command');
        process.exit(1);
    }

    const {config} = resolveConfig(process.cwd(), autoConfig, {
        path: args.path,
        profile: args.profile,
        testsRoot: args.testsRoot,
        mode: 'impact',
        gitSince: args.gitSince,
        llmProvider: args.llmProvider,
    });
    const testsRoot = config.testsRoot || config.path;

    const rawWorkflow = args.crewWorkflow || 'full-qa';
    if (!VALID_WORKFLOWS.includes(rawWorkflow as WorkflowName)) {
        console.error(`Error: invalid workflow '${rawWorkflow}'. Valid: ${VALID_WORKFLOWS.join(', ')}`);
        process.exit(1);
    }
    const workflowName = rawWorkflow as WorkflowName;

    // Degraded mode: skip all AI features, deterministic analysis only
    const degraded = args.degradedMode || process.env.E2E_AGENTS_DEGRADED === 'true';
    if (degraded) {
        console.log('Running in degraded mode — deterministic analysis only, no LLM calls.');
    }

    const crewConfig: CrewConfig = {
        appPath: config.path,
        testsRoot,
        gitSince: args.gitSince || config.git.since,
        routeFamilies: config.routeFamilies,
        apiSurface: config.apiSurface,
        workflow: workflowName,
        providerOverride: args.llmProvider,
        budgetUSD: args.budgetUSD,
        dryRun: degraded || args.dryRun,
    };

    // Create orchestrator and register all agents
    const orchestrator = new CrewOrchestrator();
    orchestrator.registerAgent(new ImpactAnalystAgent());
    orchestrator.registerAgent(new GeneratorAgent());
    orchestrator.registerAgent(new ExecutorAgent());
    orchestrator.registerAgent(new HealerAgent());
    orchestrator.registerAgent(new StrategistAgent());
    orchestrator.registerAgent(new TestDesignerAgent());
    orchestrator.registerAgent(new CrossImpactAgent());
    orchestrator.registerAgent(new RegressionAdvisorAgent());

    let result;
    try {
        result = await orchestrator.run(crewConfig);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Crew workflow failed: ${message}`);
        process.exit(1);
    }
    const ctx = result.context;

    // Dry-run output
    if (result.dryRun) {
        printDryRunOutput(result, workflowName, args.jsonOutput);
        return;
    }

    // Write crew metrics to metrics.jsonl for cost-report
    if (ctx.usage.requestCount > 0) {
        try {
            const baseDir = join(testsRoot, '.e2e-ai-agents');
            mkdirSync(baseDir, {recursive: true});
            const metricsPath = join(baseDir, 'metrics.jsonl');
            const crewMetric = {
                type: 'crew-run',
                timestamp: new Date().toISOString(),
                workflow: workflowName,
                totalCost: ctx.usage.totalCost,
                totalTokens: ctx.usage.totalTokens,
                totalInputTokens: ctx.usage.totalInputTokens,
                totalOutputTokens: ctx.usage.totalOutputTokens,
                agentUsage: ctx.agentUsage,
            };
            appendFileSync(metricsPath, `${JSON.stringify(crewMetric)}\n`, 'utf-8');
        } catch {
            // Non-fatal: metrics writing should not break the workflow
        }
    }

    // JSON output mode
    if (args.jsonOutput) {
        const jsonReport = {
            workflow: workflowName,
            changedFiles: ctx.changedFiles.length,
            impactedFlows: ctx.impactedFlows,
            strategyEntries: ctx.strategyEntries,
            testDesigns: ctx.testDesigns,
            crossImpacts: ctx.crossImpacts,
            regressionRisks: ctx.regressionRisks,
            findings: ctx.findings,
            generatedSpecs: ctx.generatedSpecs.map((s) => ({flowId: s.flowId, specPath: s.specPath, mode: s.mode, written: s.written})),
            usage: {cost: ctx.usage.totalCost, requests: ctx.usage.requestCount, tokens: ctx.usage.totalTokens},
            timings: result.timings,
            warnings: result.warnings,
        };
        console.log(JSON.stringify(jsonReport, null, 2));
        return;
    }

    // Human-readable output
    console.log(`Crew workflow: ${workflowName}`);
    console.log(`Changed files: ${ctx.changedFiles.length}`);
    console.log(`Impacted flows: ${ctx.impactedFlows.length}`);
    console.log(`Strategy entries: ${ctx.strategyEntries.length}`);
    console.log(`Test designs: ${ctx.testDesigns.length} (${ctx.testDesigns.reduce((sum, td) => sum + td.testCases.length, 0)} test cases)`);
    console.log(`Cross-impacts: ${ctx.crossImpacts.length}`);
    console.log(`Regression risks: ${ctx.regressionRisks.length}`);
    console.log(`Findings: ${ctx.findings.length}`);
    console.log(`Generated specs: ${ctx.generatedSpecs.length}`);
    console.log(`Cost: $${ctx.usage.totalCost.toFixed(4)}`);

    if (ctx.strategyEntries.length > 0) {
        console.log('\nTest Strategy:');
        for (const entry of ctx.strategyEntries) {
            console.log(`  ${entry.priority} ${entry.flowName} → ${entry.approach} [${entry.testCategories.join(', ')}]`);
        }
    }

    if (ctx.testDesigns.length > 0) {
        console.log('\nTest Designs:');
        for (const design of ctx.testDesigns) {
            console.log(`  ${design.flowName}: ${design.testCases.length} test cases`);
            for (const tc of design.testCases) {
                console.log(`    [${tc.type}] ${tc.name} (${tc.priority})`);
            }
        }
    }

    if (ctx.crossImpacts.length > 0) {
        console.log('\nCross-Family Impacts:');
        for (const ci of ctx.crossImpacts) {
            console.log(`  ${ci.sourceFamily} → ${ci.affectedFamily} (${ci.riskLevel}): ${ci.sharedDependency}`);
        }
    }

    if (result.timings && Object.keys(result.timings).length > 0) {
        console.log('\nPhase timings:');
        for (const [phase, ms] of Object.entries(result.timings)) {
            console.log(`  ${phase}: ${ms}ms`);
        }
    }

    if (result.warnings.length > 0) {
        console.log(`\nWarnings: ${result.warnings.length}`);
        for (const w of result.warnings.slice(0, 10)) {
            console.log(`  - ${w}`);
        }
        if (result.warnings.length > 10) {
            console.log(`  ... and ${result.warnings.length - 10} more`);
        }
    }
}

function printDryRunOutput(result: CrewResult, workflowName: WorkflowName, jsonOutput?: boolean): void {
    const ctx = result.context;
    const workflow = WORKFLOWS[workflowName];

    if (jsonOutput) {
        console.log(JSON.stringify({
            dryRun: true,
            workflow: workflowName,
            changedFiles: ctx.changedFiles,
            familyGroups: ctx.familyGroups.map((fg) => ({
                familyId: fg.familyId,
                featureId: fg.featureId,
                files: fg.files,
            })),
            phases: workflow.phases.map((p) => ({
                name: p.name,
                agents: p.parallel || p.sequential || [],
            })),
            manifestSource: ctx.manifest?.source || 'none',
            warnings: result.warnings,
        }, null, 2));
        return;
    }

    console.log('Dry run — no LLM calls will be made.\n');

    console.log(`Changed files (${ctx.changedFiles.length}):`);
    for (const f of ctx.changedFiles.slice(0, 20)) {
        console.log(`  ${f}`);
    }
    if (ctx.changedFiles.length > 20) {
        console.log(`  ... and ${ctx.changedFiles.length - 20} more`);
    }

    console.log(`\nAffected families (${ctx.familyGroups.length}):`);
    for (const fg of ctx.familyGroups) {
        const label = fg.featureId ? `${fg.familyId}/${fg.featureId}` : fg.familyId;
        console.log(`  ${label} (${fg.files.length} files)`);
    }

    if (ctx.manifest?.source === 'heuristic') {
        console.log('\n  Note: Using directory-based heuristics. Run `e2e-ai-agents train` for better accuracy.');
    }

    console.log(`\nWorkflow: ${workflowName}`);
    const phaseNames = workflow.phases
        .map((p) => {
            const agents = p.parallel || p.sequential || [];
            return agents.length > 0 ? `${p.name} (${agents.join(', ')})` : p.name;
        })
        .join(' → ');
    console.log(`Phases: ${phaseNames}`);

    // Cost estimation based on workflow and family count
    const familyCount = Math.max(ctx.familyGroups.length, 1);
    const agentCount = workflow.phases.reduce((sum, p) => sum + (p.parallel?.length || 0) + (p.sequential?.length || 0), 0);
    const costEstimate = estimateCost(workflowName, familyCount, agentCount);
    console.log(`\nEstimated cost: $${costEstimate.low.toFixed(2)}-$${costEstimate.high.toFixed(2)}`);
    if (ctx.modelRoutingProviderType) {
        console.log(`  With model routing: $${(costEstimate.low * 0.5).toFixed(2)}-$${(costEstimate.high * 0.5).toFixed(2)} (Haiku for classification)`);
    }
}

/** Rough cost estimation based on observed averages per workflow type */
function estimateCost(workflow: WorkflowName, families: number, _agents: number): {low: number; high: number} {
    // Per-family cost ranges by workflow (based on typical Sonnet pricing)
    const ranges: Record<WorkflowName, {low: number; high: number}> = {
        'quick-check': {low: 0.03, high: 0.10},
        'design-only': {low: 0.10, high: 0.40},
        'full-qa': {low: 0.30, high: 1.00},
    };
    const range = ranges[workflow] || ranges['full-qa'];
    return {
        low: range.low * families,
        high: range.high * families,
    };
}

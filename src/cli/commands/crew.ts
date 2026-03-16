// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * CLI command: crew — runs multi-agent QA analysis workflows.
 */

import {resolveConfig} from '../../agent/config.js';
import {CrewOrchestrator, type CrewConfig} from '../../crew/orchestrator.js';
import type {WorkflowName} from '../../crew/workflows.js';
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

    const crewConfig: CrewConfig = {
        appPath: config.path,
        testsRoot,
        gitSince: args.gitSince || config.git.since,
        routeFamilies: config.routeFamilies,
        apiSurface: config.apiSurface,
        workflow: workflowName,
        providerOverride: args.llmProvider,
        budgetUSD: args.budgetUSD,
        dryRun: args.dryRun,
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

    const result = await orchestrator.run(crewConfig);
    const ctx = result.context;

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

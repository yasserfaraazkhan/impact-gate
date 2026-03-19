// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Executor Agent — wraps agentic test execution in the Agent interface.
 * Runs generated specs through Playwright and collects results.
 */

import {getCrewProvider} from '../crew/provider.js';
import {runAgenticGeneration, type ScenarioInput} from '../agentic/runner.js';
import type {Agent, AgentTask, AgentResult} from '../crew/protocol.js';
import type {CrewContext} from '../crew/context.js';
import type {AgentRole} from '../crew/types.js';

const MAX_FIX_ATTEMPTS = 2;
const TEST_TIMEOUT_MS = 120000;

export class ExecutorAgent implements Agent {
    readonly role: AgentRole = 'executor';

    async execute(_task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        const warnings: string[] = [];

        const writtenSpecs = ctx.generatedSpecs.filter((s) => s.written);
        if (writtenSpecs.length === 0) {
            warnings.push('Executor: no written specs to execute.');
            return {role: this.role, status: 'partial', output: null, warnings};
        }

        // Build ScenarioInput[] from generated specs + impacted flows
        const flowMap = new Map(ctx.impactedFlows.map((f) => [f.flowId, f]));
        const scenarios: ScenarioInput[] = writtenSpecs.map((spec) => {
            const flow = flowMap.get(spec.flowId);
            return {
                id: spec.flowId,
                name: flow?.flowName || spec.flowId,
                scenarios: flow?.scenariosToAdd || [],
                routeFamily: flow?.routeFamily || 'unknown',
                priority: flow?.priority || 'P2',
                targetSpec: spec.mode === 'add_scenarios' ? spec.specPath : undefined,
                changedFiles: flow?.changedFiles,
                evidence: flow?.evidence,
            };
        });

        try {
            const provider = await getCrewProvider(ctx.providerOverride, ctx.budgetUSD, {
                agentRole: 'executor',
                modelRoutingProviderType: ctx.modelRoutingProviderType,
                modelRoutingOverrides: ctx.modelRoutingOverrides,
            });

            const summary = await runAgenticGeneration({
                scenarios,
                config: {
                    maxAttempts: MAX_FIX_ATTEMPTS,
                    project: 'chrome',
                    testTimeoutMs: TEST_TIMEOUT_MS,
                    provider: ctx.providerOverride,
                    testsRoot: ctx.testsRoot,
                },
                provider,
                apiSurface: ctx.apiSurface,
            });

            warnings.push(...summary.warnings);

            return {
                role: this.role,
                status: summary.totalPassed > 0 ? 'success' : 'partial',
                output: summary,
                usage: provider.getUsageStats(),
                warnings,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Executor failed: ${message}`);
            return {role: this.role, status: 'failed', output: null, warnings};
        }
    }
}

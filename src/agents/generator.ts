// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Generator Agent — wraps pipeline stage3 (test generation) in the Agent interface.
 * Enhanced to accept TestCase[] from the Test Designer in addition to flat scenariosToAdd.
 */

import {runGenerationStage} from '../pipeline/stage3_generation.js';
import type {Agent, AgentTask, AgentResult} from '../crew/protocol.js';
import type {CrewContext} from '../crew/context.js';
import type {AgentRole} from '../crew/types.js';
import type {FlowDecision} from '../validation/output_schema.js';

/**
 * Enrich FlowDecisions with TestDesign data from the crew context.
 * Converts structured TestCase[] into scenariosToAdd strings that the
 * existing generation prompt can consume.
 */
function enrichDecisionsWithTestDesigns(ctx: CrewContext): FlowDecision[] {
    if (ctx.testDesigns.length === 0) {
        return ctx.impactedFlows;
    }

    const designsByFlow = new Map(ctx.testDesigns.map((td) => [td.flowId, td]));

    return ctx.impactedFlows.map((decision) => {
        const design = designsByFlow.get(decision.flowId);
        if (!design || design.testCases.length === 0) {
            return decision;
        }

        // Convert structured test cases to scenario descriptions for the generator prompt
        const designedScenarios = design.testCases.map((tc) => {
            const steps = tc.steps.join(' → ');
            return `[${tc.type}] ${tc.name}: ${steps} → Expected: ${tc.expectedOutcome}`;
        });

        // Merge with any existing scenarios, preferring designed ones
        const existingScenarios = decision.scenariosToAdd || [];
        const mergedScenarios = [...designedScenarios, ...existingScenarios];

        return {
            ...decision,
            scenariosToAdd: mergedScenarios,
            // If we have designs but no action, promote to create_spec
            action: decision.action === 'run_existing' && designedScenarios.length > 0
                ? 'add_scenarios' as const
                : decision.action,
        };
    });
}

export class GeneratorAgent implements Agent {
    readonly role: AgentRole = 'generator';

    async execute(_task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        const warnings: string[] = [];

        const enrichedDecisions = enrichDecisionsWithTestDesigns(ctx);
        const actionable = enrichedDecisions.filter(
            (d) => d.action === 'create_spec' || d.action === 'add_scenarios',
        );

        if (actionable.length === 0) {
            warnings.push('Generator: no actionable decisions for generation.');
            return {role: this.role, status: 'partial', output: [], warnings};
        }

        const result = await runGenerationStage(
            enrichedDecisions,
            ctx.apiSurface,
            ctx.testsRoot,
            {provider: ctx.providerOverride},
        );

        ctx.generatedSpecs.push(...result.generated);
        warnings.push(...result.warnings);

        return {
            role: this.role,
            status: result.generatedCount > 0 ? 'success' : 'partial',
            output: result,
            warnings,
        };
    }
}

// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Coverage Evaluator Agent — wraps pipeline stage2 (coverage evaluation) in the Agent interface.
 */

import {runCoverageStage} from '../pipeline/stage2_coverage.js';
import type {Agent, AgentTask, AgentResult} from '../crew/protocol.js';
import type {CrewContext} from '../crew/context.js';
import type {AgentRole} from '../crew/types.js';

export class CoverageEvaluatorAgent implements Agent {
    readonly role: AgentRole = 'coverage-evaluator';

    async execute(_task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        const warnings: string[] = [];

        if (ctx.impactedFlows.length === 0) {
            warnings.push('Coverage evaluator: no impacted flows to evaluate.');
            return {role: this.role, status: 'partial', output: [], warnings};
        }

        try {
            const result = await runCoverageStage(
                ctx.impactedFlows,
                ctx.specIndex,
                ctx.context,
                ctx.testsRoot,
                {provider: ctx.providerOverride},
            );

            // Replace impacted flows with coverage-enriched versions.
            // This is intentionally a full replace (not push) because coverage evaluation
            // returns the same flow IDs with updated coverage fields.
            ctx.impactedFlows = result.decisions;
            warnings.push(...result.warnings);

            return {
                role: this.role,
                status: 'success',
                output: result.decisions,
                warnings,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Coverage evaluator failed: ${message}`);
            return {role: this.role, status: 'failed', output: null, warnings};
        }
    }
}

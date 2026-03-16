// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Healer Agent — wraps pipeline stage4 (test healing) in the Agent interface.
 */

import {runHealStage, resolveHealTargets} from '../pipeline/stage4_heal.js';
import type {Agent, AgentTask, AgentResult} from '../crew/protocol.js';
import type {CrewContext} from '../crew/context.js';
import type {AgentRole} from '../crew/types.js';

export class HealerAgent implements Agent {
    readonly role: AgentRole = 'healer';

    async execute(_task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        const warnings: string[] = [];

        const healTargets = resolveHealTargets(
            ctx.testsRoot,
            {generatedSpecs: ctx.generatedSpecs},
            ctx.impactedFlows,
        );

        if (healTargets.length === 0) {
            warnings.push('Healer: no heal targets found.');
            return {role: this.role, status: 'partial', output: null, warnings};
        }

        const result = await runHealStage(ctx.testsRoot, healTargets, {mcp: true});
        warnings.push(...result.warnings);

        return {
            role: this.role,
            status: result.healSuccess > 0 ? 'success' : 'partial',
            output: result,
            warnings,
        };
    }
}

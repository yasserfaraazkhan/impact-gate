// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Impact Analyst Agent — wraps pipeline stage1 (impact analysis) in the Agent interface.
 */

import {runImpactStage} from '../pipeline/stage1_impact.js';
import type {Agent, AgentTask, AgentResult} from '../crew/protocol.js';
import type {CrewContext} from '../crew/context.js';
import type {AgentRole} from '../crew/types.js';

export class ImpactAnalystAgent implements Agent {
    readonly role: AgentRole = 'impact-analyst';

    async execute(_task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        const warnings: string[] = [];

        if (ctx.familyGroups.length === 0) {
            warnings.push('Impact analyst: no family groups to analyze.');
            return {role: this.role, status: 'partial', output: [], warnings};
        }

        const result = await runImpactStage(
            ctx.familyGroups,
            ctx.manifest,
            ctx.specIndex,
            ctx.apiSurface,
            ctx.context,
            {provider: ctx.providerOverride},
        );

        ctx.impactedFlows.push(...result.decisions);
        warnings.push(...result.warnings);

        return {
            role: this.role,
            status: result.decisions.length > 0 ? 'success' : 'partial',
            output: result.decisions,
            warnings,
        };
    }
}

// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Explorer Agent — wraps the QA agent browser exploration loop in the Agent interface.
 * This agent is optional and only runs when a browser environment is available.
 */

import type {Agent, AgentTask, AgentResult} from '../crew/protocol.js';
import type {CrewContext} from '../crew/context.js';
import type {AgentRole} from '../crew/types.js';

export class ExplorerAgent implements Agent {
    readonly role: AgentRole = 'explorer';

    async execute(_task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        const warnings: string[] = [];

        // Explorer requires browser environment — skip gracefully if not available
        try {
            // Build target flows from impacted flows
            const targetFlows = ctx.impactedFlows
                .filter((d) => d.action !== 'cannot_determine')
                .map((d) => ({
                    id: d.flowId,
                    name: d.flowName,
                    url: d.specificRoute,
                    priority: d.priority,
                }));

            if (targetFlows.length === 0) {
                warnings.push('Explorer: no target flows for exploration.');
                return {role: this.role, status: 'partial', output: null, warnings};
            }

            // Convert QA findings to crew findings
            warnings.push(`Explorer: ${targetFlows.length} flows available for exploration (requires browser environment).`);

            return {
                role: this.role,
                status: 'partial',
                output: {targetFlows},
                warnings,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Explorer failed: ${message}`);
            return {role: this.role, status: 'failed', output: null, warnings};
        }
    }
}

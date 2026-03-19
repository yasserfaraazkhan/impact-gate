// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Agent Crew Protocol — core interfaces for inter-agent communication and execution.
 */

import type {ProviderUsageStats} from '../provider_interface.js';
import type {AgentRole} from './types.js';
import type {CrewContext} from './context.js';

export interface AgentMessage {
    id: string;
    from: AgentRole;
    to: AgentRole | 'broadcast';
    type: 'task' | 'result' | 'escalation' | 'finding';
    payload: unknown;
    correlationId: string;
    timestamp: number;
}

export interface AgentTask {
    role: AgentRole;
    action: string;
    input: unknown;
}

export interface AgentResult {
    role: AgentRole;
    status: 'success' | 'partial' | 'failed';
    output: unknown;
    usage?: ProviderUsageStats;
    warnings: string[];
}

export interface Agent {
    role: AgentRole;
    execute(task: AgentTask, ctx: CrewContext): Promise<AgentResult>;
    onMessage?(msg: AgentMessage): Promise<void>;
}

/**
 * AgentPlugin — interface for external agent plugins loaded from config.
 *
 * Plugins register into crew workflow phases alongside built-in agents.
 * The CrewContext interface is a public API contract once plugins exist:
 * field additions are non-breaking, field removals or type changes are breaking.
 */
export interface AgentPlugin extends Agent {
    /** Which workflow phase to run in (e.g., 'strategize', 'understand') */
    phase: string;
    /** Run after these agents complete (dependency ordering) */
    runAfter?: AgentRole[];
}

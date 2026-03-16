// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Predefined workflow definitions — playbooks that compose agents into phases.
 */

import type {AgentRole} from './types.js';

export interface WorkflowPhase {
    name: string;
    /** Built-in handler (e.g. preprocess) — no agent dispatch */
    handler?: 'built-in';
    /** Agents to run in parallel */
    parallel?: AgentRole[];
    /** Agents to run sequentially */
    sequential?: AgentRole[];
}

export interface WorkflowDef {
    name: string;
    description: string;
    phases: WorkflowPhase[];
}

export type WorkflowName = 'full-qa' | 'quick-check' | 'design-only';

export const WORKFLOWS: Record<WorkflowName, WorkflowDef> = {
    'full-qa': {
        name: 'full-qa',
        description: 'Full multi-agent QA analysis: understand → strategize → execute → validate',
        phases: [
            {name: 'preprocess', handler: 'built-in'},
            {name: 'understand', parallel: ['impact-analyst', 'cross-impact', 'regression-advisor']},
            {name: 'strategize', sequential: ['strategist', 'test-designer']},
            {name: 'execute', parallel: ['generator', 'explorer']},
            {name: 'validate', sequential: ['executor', 'healer']},
        ],
    },
    'quick-check': {
        name: 'quick-check',
        description: 'Quick impact analysis with strategy recommendations',
        phases: [
            {name: 'preprocess', handler: 'built-in'},
            {name: 'understand', parallel: ['impact-analyst']},
            {name: 'strategize', sequential: ['strategist']},
        ],
    },
    'design-only': {
        name: 'design-only',
        description: 'Impact analysis through test design — no generation or execution',
        phases: [
            {name: 'preprocess', handler: 'built-in'},
            {name: 'understand', parallel: ['impact-analyst', 'cross-impact']},
            {name: 'strategize', sequential: ['strategist', 'test-designer']},
        ],
    },
};

// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Predefined workflow definitions — playbooks that compose agents into phases.
 *
 * Data flow through full-qa workflow:
 *
 *   preprocess (built-in)
 *     → populates: familyGroups, routeFamilies, manifest, apiSurface, specIndex, context
 *
 *   understand (parallel):
 *     impact-analyst      → writes: impactedFlows
 *     cross-impact        → writes: crossImpacts
 *     regression-advisor  → writes: regressionRisks
 *
 *   strategize (sequential):
 *     strategist           → reads: impactedFlows, crossImpacts, regressionRisks
 *                          → writes: strategyEntries
 *     test-designer        → reads: strategyEntries, impactedFlows, crossImpacts, apiSurface, specIndex
 *                          → writes: testDesigns
 *
 *   execute (parallel):
 *     generator            → reads: impactedFlows, testDesigns, apiSurface
 *                          → writes: generatedSpecs
 *
 *   validate (sequential):
 *     executor             → reads: generatedSpecs, impactedFlows
 *     healer               → reads: generatedSpecs, impactedFlows
 */

import type {AgentRole} from './types.js';

export type WorkflowPhase =
    | {name: string; handler: 'built-in'; parallel?: never; sequential?: never}
    | {name: string; handler?: never; parallel: AgentRole[]; sequential?: never}
    | {name: string; handler?: never; parallel?: never; sequential: AgentRole[]};

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
            {name: 'execute', parallel: ['generator']},
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

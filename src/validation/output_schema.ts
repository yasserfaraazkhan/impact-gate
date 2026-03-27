// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export type FlowAction = 'run_existing' | 'add_scenarios' | 'create_spec' | 'cannot_determine';
export type EvidenceSource = 'ai' | 'catalog' | 'traceability' | 'deterministic';
export type FlowPriority = 'P0' | 'P1' | 'P2';
export type ConfidenceClass = 'high' | 'medium' | 'low';
export type CoverageLevel = 'full' | 'partial' | 'none';

export interface ExistingSpecCoverage {
    path: string;
    testTitles: string[];
    coverageLevel: CoverageLevel;
    missingScenarios?: string[];
}

export type {AssertionPattern} from '../knowledge/route_families.js';
import type {AssertionPattern} from '../knowledge/route_families.js';

export interface FlowDecision {
    flowId: string;
    flowName: string;
    routeFamily: string;
    featureId?: string;
    specificRoute?: string;
    changedFiles: string[];
    evidence: string;
    evidenceSource: EvidenceSource;
    confidence: number;
    existingSpecs: ExistingSpecCoverage[];
    action: FlowAction;
    targetSpec?: string;
    newSpecPath?: string;
    scenariosToAdd?: string[];
    blockingReason?: string;
    priority: FlowPriority;
    userActions: string[];
    assertionPatterns?: AssertionPattern[];
}

export interface FlowDecisionSummary {
    changedFiles: number;
    routeFamiliesImpacted: string[];
    flowsIdentified: number;
    flowsCovered: number;
    flowsPartial: number;
    flowsUncovered: number;
    actionsRequired: {
        run_existing: number;
        add_scenarios: number;
        create_spec: number;
        cannot_determine: number;
    };
    overallConfidence: ConfidenceClass;
}

export interface FlowDecisionReport {
    runId: string;
    timestamp: string;
    gitRef: string;
    summary: FlowDecisionSummary;
    decisions: FlowDecision[];
    warnings: string[];
    model: {
        impactAgent?: string;
        coverageAgent?: string;
        generationAgent?: string;
    };
}

const VALID_ACTIONS: FlowAction[] = ['run_existing', 'add_scenarios', 'create_spec', 'cannot_determine'];
const VALID_PRIORITIES: FlowPriority[] = ['P0', 'P1', 'P2'];
const VALID_SOURCES: EvidenceSource[] = ['ai', 'catalog', 'traceability', 'deterministic'];

export function validateFlowDecision(decision: unknown): {valid: boolean; errors: string[]} {
    const errors: string[] = [];
    if (!decision || typeof decision !== 'object') {
        return {valid: false, errors: ['Decision must be a non-null object']};
    }
    const d = decision as Record<string, unknown>;

    if (typeof d.flowId !== 'string' || !d.flowId) {
        errors.push('flowId is required');
    }
    if (typeof d.flowName !== 'string' || !d.flowName) {
        errors.push('flowName is required');
    }
    if (typeof d.routeFamily !== 'string' || !d.routeFamily) {
        errors.push('routeFamily is required');
    }
    if (!Array.isArray(d.changedFiles)) {
        errors.push('changedFiles must be an array');
    }
    if (typeof d.evidence !== 'string') {
        errors.push('evidence is required');
    }
    if (!VALID_SOURCES.includes(d.evidenceSource as EvidenceSource)) {
        errors.push(`evidenceSource must be one of: ${VALID_SOURCES.join(', ')}`);
    }
    if (typeof d.confidence !== 'number' || d.confidence < 0 || d.confidence > 100) {
        errors.push('confidence must be a number between 0 and 100');
    }
    if (!VALID_ACTIONS.includes(d.action as FlowAction)) {
        errors.push(`action must be one of: ${VALID_ACTIONS.join(', ')}`);
    }
    if (!VALID_PRIORITIES.includes(d.priority as FlowPriority)) {
        errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
    }
    if (d.action === 'cannot_determine' && (typeof d.blockingReason !== 'string' || !d.blockingReason)) {
        errors.push('blockingReason is required when action is cannot_determine');
    }
    if (d.action === 'add_scenarios' && (!Array.isArray(d.scenariosToAdd) || d.scenariosToAdd.length === 0)) {
        errors.push('scenariosToAdd is required when action is add_scenarios');
    }

    return {valid: errors.length === 0, errors};
}

export function buildSummary(decisions: FlowDecision[]): FlowDecisionSummary {
    const families = new Set<string>();
    const actions = {run_existing: 0, add_scenarios: 0, create_spec: 0, cannot_determine: 0};
    let covered = 0;
    let partial = 0;
    let uncovered = 0;

    for (const d of decisions) {
        families.add(d.routeFamily);
        actions[d.action]++;

        if (d.action === 'run_existing') {
            covered++;
        } else if (d.action === 'add_scenarios') {
            partial++;
        } else if (d.action === 'create_spec') {
            uncovered++;
        }
    }

    const actionable = decisions.filter((d) => d.action !== 'cannot_determine');
    const avgConfidence = actionable.length > 0
        ? actionable.reduce((sum, d) => sum + d.confidence, 0) / actionable.length
        : 0;

    return {
        changedFiles: new Set(decisions.flatMap((d) => d.changedFiles)).size,
        routeFamiliesImpacted: Array.from(families).sort(),
        flowsIdentified: decisions.length,
        flowsCovered: covered,
        flowsPartial: partial,
        flowsUncovered: uncovered,
        actionsRequired: actions,
        overallConfidence: avgConfidence >= 75 ? 'high' : avgConfidence >= 40 ? 'medium' : 'low',
    };
}

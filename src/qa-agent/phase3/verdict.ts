// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Finding, Phase1Result, Phase2Result, ReleaseVerdict, TargetFlow, FlowSignoff} from '../types.js';

export function computeVerdict(
    phase1: Phase1Result,
    phase2: Phase2Result,
): ReleaseVerdict {
    const findings = phase2.findings;

    const critical = findings.filter((f) => f.severity === 'critical').length;
    const high = findings.filter((f) => f.severity === 'high').length;
    const medium = findings.filter((f) => f.severity === 'medium').length;
    const low = findings.filter((f) => f.severity === 'low' || f.severity === 'info').length;

    // Flow sign-offs
    const flowSignoffs = buildFlowSignoffs(phase1.flows, phase2);

    // Decision logic
    let decision: ReleaseVerdict['decision'];
    let reason: string;

    if (critical > 0) {
        decision = 'no-go';
        reason = `${critical} critical finding(s) — must fix before release.`;
    } else if (high > 0) {
        decision = 'no-go';
        reason = `${high} high-severity finding(s) — requires triage before release.`;
    } else if (medium > 0) {
        decision = 'conditional';
        reason = `${medium} medium-severity finding(s) — review and decide if acceptable.`;
    } else {
        decision = 'go';
        reason = findings.length === 0
            ? 'No issues found across all tested flows.'
            : `Only low/info findings (${low}). Safe to proceed.`;
    }

    // Check for untested flows (P0/P1 not tested → downgrade to conditional)
    const untestedP0P1 = flowSignoffs.filter(
        (s) => s.status === 'not-tested' && phase1.flows.find((f) => f.id === s.flowId && (f.priority === 'P0' || f.priority === 'P1')),
    );
    if (untestedP0P1.length > 0 && decision === 'go') {
        decision = 'conditional';
        reason += ` ${untestedP0P1.length} P0/P1 flow(s) were not tested.`;
    }

    // Check Phase 1 spec failures
    const specFailures = phase1.specResults.reduce((sum, r) => sum + r.failed, 0);
    if (specFailures > 0 && decision === 'go') {
        decision = 'conditional';
        reason += ` ${specFailures} existing spec(s) failed in Phase 1.`;
    }

    return {
        decision,
        reason,
        flowSignoffs,
        criticalFindings: critical,
        highFindings: high,
        mediumFindings: medium,
        lowFindings: low,
    };
}

function buildFlowSignoffs(flows: TargetFlow[], phase2: Phase2Result): FlowSignoff[] {
    return flows.map((flow) => {
        const explored = phase2.flowsExplored.includes(flow.id);
        const flowFindings = phase2.findings.filter((f) => f.flow === flow.id);
        const hasIssues = flowFindings.some((f) => f.type === 'bug' || f.severity === 'critical' || f.severity === 'high');

        return {
            flowId: flow.id,
            flowName: flow.name,
            status: explored ? (hasIssues ? 'failed' : 'passed') : 'not-tested',
            findings: flowFindings.map((f) => f.id),
        } as FlowSignoff;
    });
}

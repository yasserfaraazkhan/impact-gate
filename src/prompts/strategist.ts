// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Strategist prompt — designs overall test strategy from impact analysis,
 * cross-impact data, and regression risk.
 */

import type {FlowDecision} from '../validation/output_schema.js';
import type {CrossImpact, RegressionRisk, StrategyEntry} from '../crew/types.js';
import {sanitizeForPrompt} from '../crew/sanitize.js';
import {extractJsonFromResponse} from './json_extract.js';

export interface StrategistPromptContext {
    impactedFlows: FlowDecision[];
    crossImpacts: CrossImpact[];
    regressionRisks: RegressionRisk[];
}

export function buildStrategistPrompt(ctx: StrategistPromptContext): string {
    const flowsBlock = ctx.impactedFlows
        .map((f) => {
            const specs = f.existingSpecs.map((s) => `${s.path} (${s.coverageLevel})`).join(', ') || 'none';
            return [
                `- ${f.flowId} (${f.priority}): ${f.flowName}`,
                `  Route Family: ${f.routeFamily}`,
                `  Action: ${f.action}`,
                `  Confidence: ${f.confidence}%`,
                `  Existing Coverage: ${specs}`,
                `  User Actions: ${sanitizeForPrompt(f.userActions.join('; ') || 'unknown')}`,
                `  Changed Files: ${f.changedFiles.join(', ')}`,
            ].join('\n');
        })
        .join('\n\n');

    const crossImpactBlock = ctx.crossImpacts.length > 0
        ? ctx.crossImpacts.map((ci) =>
            `- ${ci.sourceFamily} → ${ci.affectedFamily} (${ci.riskLevel}): ${ci.sharedDependency} — ${ci.evidence}`,
        ).join('\n')
        : 'No cross-family impacts detected.';

    const regressionBlock = ctx.regressionRisks.length > 0
        ? ctx.regressionRisks.map((r) =>
            `- ${r.familyId} (risk=${r.riskScore}): ${r.reason}`,
        ).join('\n')
        : 'No regression risk data available.';

    return [
        'You are a senior QA strategist designing the overall test strategy for a code change.',
        '',
        `IMPACTED FLOWS (${ctx.impactedFlows.length}):`,
        flowsBlock,
        '',
        'CROSS-FAMILY IMPACTS:',
        crossImpactBlock,
        '',
        'REGRESSION RISK:',
        regressionBlock,
        '',
        'TASK: Design a prioritized test strategy for each impacted flow.',
        '',
        'For each flow, decide:',
        '1. Approach: full-test (comprehensive), smoke-test (critical path only), skip, or manual-review',
        '2. Priority: P0 (critical path), P1 (important), P2 (nice to have)',
        '3. Test categories to cover (from: happy-path, edge-case, boundary, negative, state-transition, race-condition, permission, accessibility, performance)',
        '4. Cross-impact risk level based on shared dependencies',
        '',
        'Return strict JSON only with this shape:',
        '{"strategy":[{"flowId":"<id>","flowName":"<name>","priority":"P0|P1|P2","approach":"full-test|smoke-test|skip|manual-review","rationale":"<why this approach>","testCategories":["happy-path","edge-case",...],"crossImpactRisk":"high|medium|low|none"}]}',
        '',
        'Rules:',
        '- P0 flows with create_spec or add_scenarios action should always get full-test.',
        '- Flows with high cross-impact risk should be promoted to at least P1.',
        '- Flows with high regression risk should include edge-case and boundary categories.',
        '- Skip flows only if confidence < 30 AND no cross-impact risk.',
        '- Include accessibility category for any flow involving interactive UI elements.',
        '- Include permission category for any flow involving role-based features.',
        '- Keep rationale concise (1-2 sentences) explaining why this approach was chosen.',
    ].join('\n');
}

export interface StrategistAgentResponse {
    strategy: Array<{
        flowId: string;
        flowName: string;
        priority: 'P0' | 'P1' | 'P2' | string;
        approach: 'full-test' | 'smoke-test' | 'skip' | 'manual-review' | string;
        rationale: string;
        testCategories: string[];
        crossImpactRisk: 'high' | 'medium' | 'low' | 'none' | string;
    }>;
}

export function parseStrategistResponse(text: string): StrategistAgentResponse | null {
    return extractJsonFromResponse<StrategistAgentResponse>(
        text,
        (obj): obj is StrategistAgentResponse =>
            obj != null && typeof obj === 'object' && Array.isArray((obj as StrategistAgentResponse).strategy),
    );
}

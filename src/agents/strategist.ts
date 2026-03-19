// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Strategist Agent — designs overall test strategy from impact analysis,
 * cross-impact data, and regression risk.
 */

import {getCrewProvider} from '../crew/provider.js';
import {buildStrategistPrompt, parseStrategistResponse} from '../prompts/strategist.js';
import type {Agent, AgentTask, AgentResult} from '../crew/protocol.js';
import type {CrewContext} from '../crew/context.js';
import type {AgentRole, StrategyEntry, TestCaseType} from '../crew/types.js';

const VALID_APPROACHES = new Set(['full-test', 'smoke-test', 'skip', 'manual-review']);
const VALID_CATEGORIES = new Set<TestCaseType>([
    'happy-path', 'edge-case', 'boundary', 'negative',
    'state-transition', 'race-condition', 'permission', 'accessibility', 'performance',
]);
const VALID_RISK = new Set(['high', 'medium', 'low', 'none']);

export class StrategistAgent implements Agent {
    readonly role: AgentRole = 'strategist';

    async execute(_task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        const warnings: string[] = [];

        if (ctx.impactedFlows.length === 0) {
            warnings.push('Strategist: no impacted flows to strategize.');
            return {role: this.role, status: 'partial', output: [], warnings};
        }

        const prompt = buildStrategistPrompt({
            impactedFlows: ctx.impactedFlows,
            crossImpacts: ctx.crossImpacts,
            regressionRisks: ctx.regressionRisks,
        });

        try {
            const provider = await getCrewProvider(ctx.providerOverride, ctx.budgetUSD, {
                agentRole: 'strategist',
                modelRoutingProviderType: ctx.modelRoutingProviderType,
                modelRoutingOverrides: ctx.modelRoutingOverrides,
                budgetLedger: ctx.budgetLedger,
            });

            const response = await provider.generateText(prompt, {
                maxTokens: 4000,
                temperature: 0,
                timeout: 45000,
                systemPrompt: 'Return only valid JSON. Do not include markdown fences unless necessary.',
            });

            const parsed = parseStrategistResponse(response.text);
            if (!parsed || parsed.strategy.length === 0) {
                warnings.push('Strategist: LLM returned no strategy.');
                // Fall back to default strategy
                ctx.strategyEntries.push(...this.buildDefaultStrategy(ctx));
                return {role: this.role, status: 'partial', output: ctx.strategyEntries, warnings};
            }

            const entries: StrategyEntry[] = parsed.strategy.map((s) => ({
                flowId: s.flowId,
                flowName: s.flowName,
                priority: (['P0', 'P1', 'P2'].includes(s.priority) ? s.priority : 'P2') as 'P0' | 'P1' | 'P2',
                approach: VALID_APPROACHES.has(s.approach) ? s.approach as StrategyEntry['approach'] : 'full-test',
                rationale: s.rationale || '',
                testCategories: (s.testCategories || []).filter(
                    (c): c is TestCaseType => VALID_CATEGORIES.has(c as TestCaseType),
                ),
                crossImpactRisk: VALID_RISK.has(s.crossImpactRisk) ? s.crossImpactRisk as StrategyEntry['crossImpactRisk'] : 'none',
            }));

            ctx.strategyEntries.push(...entries);

            return {
                role: this.role,
                status: 'success',
                output: entries,
                usage: provider.getUsageStats(),
                warnings,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Strategist LLM failed: ${message}. Using default strategy.`);
            ctx.strategyEntries.push(...this.buildDefaultStrategy(ctx));
            return {role: this.role, status: 'partial', output: ctx.strategyEntries, warnings};
        }
    }

    private buildDefaultStrategy(ctx: CrewContext): StrategyEntry[] {
        return ctx.impactedFlows
            .filter((f) => f.action !== 'cannot_determine')
            .map((f) => ({
                flowId: f.flowId,
                flowName: f.flowName,
                priority: f.priority,
                approach: (f.action === 'create_spec' || f.action === 'add_scenarios' ? 'full-test' : 'smoke-test') as StrategyEntry['approach'],
                rationale: 'Default strategy based on impact action.',
                testCategories: ['happy-path', 'edge-case'] as TestCaseType[],
                crossImpactRisk: 'none' as const,
            }));
    }
}

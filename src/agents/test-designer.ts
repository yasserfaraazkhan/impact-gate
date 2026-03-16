// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Test Designer Agent — designs structured test cases across 9 categories.
 * Takes strategist output + API surface + existing specs and produces TestDesign[].
 */

import {LLMProviderFactory} from '../provider_factory.js';
import {getSpecsForFamily} from '../knowledge/spec_index.js';
import {buildTestDesignerPrompt, parseTestDesignerResponse} from '../prompts/test-designer.js';
import type {Agent, AgentTask, AgentResult} from '../crew/protocol.js';
import type {CrewContext} from '../crew/context.js';
import type {AgentRole, TestDesign, TestCase, TestCaseType, StrategyEntry} from '../crew/types.js';

const VALID_TYPES: TestCaseType[] = [
    'happy-path', 'edge-case', 'boundary', 'negative',
    'state-transition', 'race-condition', 'permission', 'accessibility', 'performance',
];

export class TestDesignerAgent implements Agent {
    readonly role: AgentRole = 'test-designer';

    async execute(_task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        const warnings: string[] = [];

        if (ctx.strategyEntries.length === 0) {
            warnings.push('Test designer: no strategy entries to design tests for.');
            return {role: this.role, status: 'partial', output: [], warnings};
        }

        // Only design tests for flows with full-test or smoke-test approach
        const designable = ctx.strategyEntries.filter(
            (s) => s.approach === 'full-test' || s.approach === 'smoke-test',
        );

        if (designable.length === 0) {
            warnings.push('Test designer: all flows are skip or manual-review.');
            return {role: this.role, status: 'partial', output: [], warnings};
        }

        let provider;
        try {
            provider = ctx.providerOverride
                ? LLMProviderFactory.createFromString(ctx.providerOverride)
                : await LLMProviderFactory.createFromEnv();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Test designer provider unavailable: ${message}`);
            return {role: this.role, status: 'failed', output: [], warnings};
        }

        const designs: TestDesign[] = [];

        for (const strategy of designable) {
            const flow = ctx.impactedFlows.find((f) => f.flowId === strategy.flowId);
            if (!flow) {
                warnings.push(`Test designer: strategy entry '${strategy.flowId}' has no matching flow.`);
                continue;
            }

            const familySpecs = getSpecsForFamily(ctx.specIndex, flow.routeFamily, flow.featureId);
            const relevantCrossImpacts = ctx.crossImpacts.filter(
                (ci) => ci.sourceFamily === flow.routeFamily || ci.affectedFamily === flow.routeFamily,
            );

            const prompt = buildTestDesignerPrompt({
                flow,
                strategy,
                apiSurface: ctx.apiSurface,
                existingSpecs: familySpecs,
                crossImpacts: relevantCrossImpacts,
            });

            try {
                const response = await provider.generateText(prompt, {
                    maxTokens: 4000,
                    temperature: 0.1,
                    timeout: 60000,
                    systemPrompt: 'Return only valid JSON. Do not include markdown fences unless necessary.',
                });

                const parsed = parseTestDesignerResponse(response.text);
                if (!parsed || parsed.testDesign.testCases.length === 0) {
                    warnings.push(`Test designer: no test cases returned for flow ${strategy.flowId}.`);
                    continue;
                }

                const validatedCases: TestCase[] = parsed.testDesign.testCases
                    .filter((tc) => tc.name && tc.steps && tc.steps.length > 0)
                    .map((tc) => ({
                        name: tc.name,
                        type: VALID_TYPES.includes(tc.type as TestCaseType) ? tc.type as TestCaseType : 'happy-path',
                        preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : [],
                        steps: Array.isArray(tc.steps) ? tc.steps : [],
                        expectedOutcome: tc.expectedOutcome || '',
                        priority: (['P0', 'P1', 'P2'].includes(tc.priority) ? tc.priority : 'P2') as 'P0' | 'P1' | 'P2',
                        rationale: tc.rationale || '',
                    }))
                    .slice(0, 15); // Max 15 per flow

                if (validatedCases.length > 0) {
                    designs.push({
                        flowId: strategy.flowId,
                        flowName: strategy.flowName,
                        testCases: validatedCases,
                    });
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                warnings.push(`Test designer failed for flow ${strategy.flowId}: ${message}`);
            }
        }

        ctx.testDesigns = designs;

        return {
            role: this.role,
            status: designs.length > 0 ? 'success' : 'partial',
            output: designs,
            usage: provider.getUsageStats(),
            warnings,
        };
    }
}

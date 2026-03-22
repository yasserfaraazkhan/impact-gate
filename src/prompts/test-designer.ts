// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Test Designer prompt — designs structured test cases across 9 categories.
 * Replaces flat scenariosToAdd with rich TestCase[] that feed the Generator.
 */

import type {FlowDecision} from '../validation/output_schema.js';
import {extractJsonFromResponse} from './json_extract.js';
import {formatApiSurfaceForPrompt, type ApiSurfaceCatalog} from '../knowledge/api_surface.js';
import type {SpecEntry} from '../knowledge/spec_index.js';
import type {StrategyEntry, CrossImpact, TestDesign} from '../crew/types.js';
import {sanitizeForPrompt} from '../crew/sanitize.js';
import type {GenerationProfile} from './generation_profile.js';

export interface TestDesignerPromptContext {
    flow: FlowDecision;
    strategy: StrategyEntry;
    apiSurface: ApiSurfaceCatalog;
    existingSpecs: SpecEntry[];
    crossImpacts: CrossImpact[];
    profile?: GenerationProfile;
}

export function buildTestDesignerPrompt(ctx: TestDesignerPromptContext): string {
    const relevantClasses = ctx.apiSurface.pageObjects
        .map((po) => po.className)
        .filter((name) => {
            const lower = name.toLowerCase();
            const hints = [ctx.flow.routeFamily, ctx.flow.featureId, ...ctx.flow.userActions.join(' ').split(/\s+/)]
                .filter(Boolean)
                .map((s) => s!.toLowerCase().replace(/[^a-z]/g, ''));
            return lower.includes('page') || hints.some((h) => h.length > 3 && lower.includes(h));
        })
        .slice(0, 10);

    const apiBlock = relevantClasses.length > 0
        ? formatApiSurfaceForPrompt(ctx.apiSurface, relevantClasses)
        : 'No page objects available.';

    const existingSpecsBlock = ctx.existingSpecs.length > 0
        ? ctx.existingSpecs.map((s) => `- ${s.relativePath}: ${s.testTitles.join(', ')}`).join('\n')
        : 'No existing specs.';

    const crossImpactBlock = ctx.crossImpacts.length > 0
        ? ctx.crossImpacts.map((ci) =>
            `- ${ci.sourceFamily} → ${ci.affectedFamily}: ${ci.sharedDependency} (${ci.riskLevel})`,
        ).join('\n')
        : 'None detected.';

    const categories = ctx.strategy.testCategories.join(', ');

    return [
        `You are a senior QA engineer designing comprehensive test cases for a ${ctx.profile?.projectName || 'Mattermost'} user flow.`,
        '',
        `FLOW: ${ctx.flow.flowName}`,
        `Flow ID: ${ctx.flow.flowId}`,
        `Route Family: ${ctx.flow.routeFamily}${ctx.flow.featureId ? ` / ${ctx.flow.featureId}` : ''}`,
        `Route: ${ctx.flow.specificRoute || '(not specified)'}`,
        `Priority: ${ctx.strategy.priority}`,
        `Approach: ${ctx.strategy.approach}`,
        `User Actions: ${sanitizeForPrompt(ctx.flow.userActions.join('; ') || 'unknown')}`,
        `Evidence: ${sanitizeForPrompt(ctx.flow.evidence)}`,
        '',
        `REQUIRED TEST CATEGORIES: ${categories}`,
        '',
        'AVAILABLE PAGE OBJECTS:',
        apiBlock,
        '',
        'EXISTING SPECS (avoid duplicating these):',
        existingSpecsBlock,
        '',
        'CROSS-FAMILY IMPACTS:',
        crossImpactBlock,
        '',
        'TASK: Design structured test cases for this flow.',
        '',
        'Return strict JSON only with this shape:',
        '{"testDesign":{"flowId":"<id>","flowName":"<name>","testCases":[{"name":"<descriptive name>","type":"<category>","preconditions":["<state required>"],"steps":["<user action>"],"expectedOutcome":"<what should happen>","priority":"P0|P1|P2","rationale":"<why this test matters>"}]}}',
        '',
        'TYPE VALUES: happy-path, edge-case, boundary, negative, state-transition, race-condition, permission, accessibility, performance',
        '',
        'Rules:',
        '- Every test must describe a specific USER ACTION, not an implementation detail.',
        '- Steps must be concrete: "click Create Channel button" not "test channel creation".',
        '- Include preconditions (logged-in role, existing data state, etc.).',
        '- Reference only page objects and methods listed above.',
        '- Include a mandatory rationale explaining why this specific test case matters.',
        '- Do NOT duplicate tests already covered by existing specs.',
        '- Maximum 15 test cases per flow.',
        '- For accessibility: test keyboard navigation, screen reader support, ARIA labels.',
        '- For performance: test with realistic data volumes, measure load times.',
        '- For edge cases: test unicode input, max-length fields, empty states, concurrent edits.',
        '',
        'FEW-SHOT EXAMPLES:',
        '',
        'Edge case example:',
        '```json',
        '{"name":"channel creation with unicode characters and max-length name","type":"edge-case","preconditions":["logged in as team member","team has < 1000 channels"],"steps":["open create channel dialog","enter 64-character name with emoji and CJK characters","click Create"],"expectedOutcome":"channel created successfully, name renders correctly in sidebar and header","priority":"P1","rationale":"catches encoding issues in channel name storage and rendering"}',
        '```',
        '',
        'Permission example:',
        '```json',
        '{"name":"guest user cannot archive a public channel","type":"permission","preconditions":["logged in as guest user","guest has access to public channel"],"steps":["open channel header menu","look for Archive Channel option"],"expectedOutcome":"Archive Channel option is not visible in the menu","priority":"P0","rationale":"permission escalation bug — guests archiving channels could disrupt entire teams"}',
        '```',
        '',
        'Accessibility example:',
        '```json',
        '{"name":"keyboard navigation through channel switcher results","type":"accessibility","preconditions":["logged in","channel switcher open via Ctrl+K"],"steps":["type partial channel name","press ArrowDown to navigate results","press Enter to select"],"expectedOutcome":"focus moves visually and via aria-activedescendant, selected channel opens","priority":"P1","rationale":"screen reader users rely on keyboard navigation — broken focus management makes the app unusable"}',
        '```',
    ].join('\n');
}

export interface TestDesignerAgentResponse {
    testDesign: {
        flowId: string;
        flowName: string;
        testCases: Array<{
            name: string;
            type: 'happy-path' | 'edge-case' | 'boundary' | 'negative' | 'state-transition' | 'race-condition' | 'permission' | 'accessibility' | 'performance' | string;
            preconditions: string[];
            steps: string[];
            expectedOutcome: string;
            priority: 'P0' | 'P1' | 'P2' | string;
            rationale: string;
        }>;
    };
}

export function parseTestDesignerResponse(text: string): TestDesignerAgentResponse | null {
    return extractJsonFromResponse<TestDesignerAgentResponse>(
        text,
        (obj): obj is TestDesignerAgentResponse => {
            const r = obj as TestDesignerAgentResponse;
            return r?.testDesign?.testCases != null && Array.isArray(r.testDesign.testCases);
        },
    );
}

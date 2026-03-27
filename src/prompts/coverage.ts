// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {SpecEntry} from '../knowledge/spec_index.js';
import {extractJsonFromResponse} from './json_extract.js';
import {sanitizeForPrompt} from '../crew/sanitize.js';
import type {GenerationProfile} from './generation_profile.js';

export interface CoveragePromptFlow {
    flowId: string;
    flowName: string;
    route: string;
    userActions: string[];
    evidence: string;
    priority: string;
}

export interface CoveragePromptContext {
    flows: CoveragePromptFlow[];
    specs: Array<{
        relativePath: string;
        content: string;
        testTitles: string[];
    }>;
    contextBlock: string;
    profile?: GenerationProfile;
}

export function buildCoveragePrompt(ctx: CoveragePromptContext): string {
    const flowsBlock = ctx.flows
        .map((f) => {
            const actions = f.userActions.length > 0 ? f.userActions.map((a) => sanitizeForPrompt(a)).join('; ') : 'unknown';
            return `- ${f.flowId} (${f.priority}): ${f.flowName}\n  Route: ${f.route}\n  User actions: ${actions}\n  Evidence: ${sanitizeForPrompt(f.evidence)}`;
        })
        .join('\n\n');

    const specsBlock = ctx.specs
        .map((s) => {
            return `### ${s.relativePath}\nTest titles: ${s.testTitles.join(', ')}\n\`\`\`typescript\n${s.content}\n\`\`\``;
        })
        .join('\n\n');

    return [
        `You are evaluating whether existing ${ctx.profile?.projectName || 'the project'} ${ctx.profile?.testFramework || 'Playwright'} E2E tests cover the impacted flows.`,
        '',
        `IMPACTED FLOWS (${ctx.flows.length}):`,
        flowsBlock,
        '',
        `EXISTING SPEC FILES (${ctx.specs.length}):`,
        specsBlock,
        '',
        ctx.contextBlock,
        '',
        'For each flow, determine coverage.',
        '',
        'Return strict JSON only with this shape:',
        '{"coverage":[{"flowId":"<flow_id>","action":"run_existing|add_scenarios|create_spec|cannot_determine","existingSpecs":[{"path":"<relative path>","testTitles":["<exact test title>"],"coverageLevel":"full|partial|none","missingScenarios":["<specific scenario>"]}],"scenariosToAdd":["<scenario description>"],"targetSpec":"<path to extend>","newSpecPath":"<path for new spec>","blockingReason":"<why cannot_determine>","confidence":0-100}]}',
        '',
        'Rules:',
        '- When claiming coverage exists, you MUST quote the exact test title from the spec file.',
        '- If a spec tests a related but different flow, mark as "partial" not "full".',
        '- Do NOT claim coverage exists if you cannot cite the exact test.',
        '- Scenario gaps must be stated as user actions, not code changes.',
        '  Wrong: "test the new isEditing state"',
        '  Right: "test editing a scheduled message while it is in pending state"',
        '- For add_scenarios, specify which existing spec file to extend in targetSpec.',
        `- For create_spec, suggest a path following ${ctx.profile?.projectName || 'the project'} conventions.`,
        '- Prefer adding scenarios to existing specs over creating new spec files.',
        '',
        'SEMANTIC MATCHING RULES (critical for accuracy):',
        '- A happy-path test does NOT cover the negative/error path of the same feature.',
        '  "user can edit post" does NOT cover "user without permission cannot edit post".',
        '- A test for one user role does NOT cover a different role.',
        '  "admin can delete channel" does NOT cover "member cannot delete channel".',
        '- A test for creation does NOT cover editing or deletion of the same entity.',
        '- "partial" means: same feature area but different specific scenario.',
        '- "full" means: the exact user action sequence and outcome is tested.',
        '- When in doubt between "full" and "partial", choose "partial".',
    ].join('\n');
}

export interface CoverageAgentResponse {
    coverage: Array<{
        flowId: string;
        action: string;
        existingSpecs?: Array<{
            path: string;
            testTitles?: string[];
            coverageLevel?: string;
            missingScenarios?: string[];
        }>;
        scenariosToAdd?: string[];
        targetSpec?: string;
        newSpecPath?: string;
        blockingReason?: string;
        confidence?: number;
    }>;
}

export function parseCoverageResponse(text: string): CoverageAgentResponse | null {
    return extractJsonFromResponse<CoverageAgentResponse>(
        text,
        (obj): obj is CoverageAgentResponse =>
            obj != null && typeof obj === 'object' && Array.isArray((obj as CoverageAgentResponse).coverage),
    );
}

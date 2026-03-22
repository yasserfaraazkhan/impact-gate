// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Cross-Impact Analyst prompt — finds ripple effects across route families.
 */

import type {RouteFamily} from '../knowledge/route_families.js';
import type {CrossImpact} from '../crew/types.js';
import {sanitizeForPrompt} from '../crew/sanitize.js';
import {extractJsonFromResponse} from './json_extract.js';

export interface CrossImpactPromptContext {
    changedFiles: string[];
    families: RouteFamily[];
    /** The families directly impacted by changed files */
    directlyImpactedFamilyIds: string[];
    projectName?: string;
}

export function buildCrossImpactPrompt(ctx: CrossImpactPromptContext): string {
    const familiesBlock = ctx.families
        .map((f) => {
            const paths = [
                ...(f.webappPaths || []),
                ...(f.serverPaths || []),
                ...(f.components || []),
            ];
            return `- ${f.id}: routes=[${f.routes.join(', ')}] paths=[${paths.join(', ')}] pageObjects=[${(f.pageObjects || []).join(', ')}]`;
        })
        .join('\n');

    const changedBlock = ctx.changedFiles.map((f) => sanitizeForPrompt(f)).join('\n');

    return [
        `You are analyzing code changes in ${ctx.projectName || 'Mattermost'} to identify cross-family ripple effects.`,
        'When a change in one route family could affect another family through shared dependencies,',
        'that is a cross-impact.',
        '',
        `CHANGED FILES (${ctx.changedFiles.length}):`,
        changedBlock,
        '',
        `DIRECTLY IMPACTED FAMILIES: ${ctx.directlyImpactedFamilyIds.join(', ')}`,
        '',
        `ALL ROUTE FAMILIES (${ctx.families.length}):`,
        familiesBlock,
        '',
        'TASK: Identify cross-family impacts. For each pair, explain the shared dependency.',
        '',
        'Look for:',
        '1. Shared webapp paths (same component used by multiple families)',
        '2. Shared page objects (same PO class referenced by multiple families)',
        '3. Shared API endpoints (changes affecting data used by multiple families)',
        '4. Shared components (React components imported across family boundaries)',
        '5. Shared state management (Redux stores, contexts used across families)',
        '',
        'Return strict JSON only with this shape:',
        '{"crossImpacts":[{"sourceFamily":"<directly impacted family>","affectedFamily":"<indirectly affected family>","sharedDependency":"<what connects them>","riskLevel":"high|medium|low","evidence":"<specific file/component/API that creates the dependency>"}]}',
        '',
        'Rules:',
        '- Only report cross-impacts where both families are in the manifest.',
        '- sourceFamily must be one of the directly impacted families.',
        '- affectedFamily must be DIFFERENT from sourceFamily.',
        '- Risk levels: high = shared data model/state, medium = shared UI component, low = shared utility.',
        '- Evidence must cite specific files, components, or API paths.',
        '- Return empty array if no cross-impacts are found.',
    ].join('\n');
}

export interface CrossImpactAgentResponse {
    crossImpacts: Array<{
        sourceFamily: string;
        affectedFamily: string;
        sharedDependency: string;
        riskLevel: 'high' | 'medium' | 'low' | string;
        evidence: string;
    }>;
}

export function parseCrossImpactResponse(text: string): CrossImpactAgentResponse | null {
    return extractJsonFromResponse<CrossImpactAgentResponse>(
        text,
        (obj): obj is CrossImpactAgentResponse =>
            obj != null && typeof obj === 'object' && Array.isArray((obj as CrossImpactAgentResponse).crossImpacts),
    );
}

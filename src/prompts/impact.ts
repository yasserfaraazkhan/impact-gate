// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {RouteFamily} from '../knowledge/route_families.js';
import type {SpecEntry} from '../knowledge/spec_index.js';
import {extractJsonFromResponse} from './json_extract.js';
import {formatSpecsForPrompt} from '../knowledge/spec_index.js';
import {formatApiSurfaceForPrompt, type ApiSurfaceCatalog} from '../knowledge/api_surface.js';

export interface ImpactPromptContext {
    family: RouteFamily;
    featureId?: string;
    changedFiles: Array<{path: string; snippet?: string}>;
    existingSpecs: SpecEntry[];
    apiSurface: ApiSurfaceCatalog;
    contextBlock: string;
    projectName?: string;
}

export function buildImpactPrompt(ctx: ImpactPromptContext): string {
    const familyRoutes = ctx.family.routes.join(', ');
    const featureNote = ctx.featureId ? `\nFEATURE: ${ctx.featureId}` : '';
    const pageObjectNames = ctx.family.pageObjects || [];
    const componentNames = ctx.family.components || [];
    const allClassNames = [...pageObjectNames, ...componentNames];

    const apiSurfaceBlock = allClassNames.length > 0
        ? formatApiSurfaceForPrompt(ctx.apiSurface, allClassNames)
        : 'No page objects or components mapped for this family.';

    const specsBlock = ctx.existingSpecs.length > 0
        ? formatSpecsForPrompt(ctx.existingSpecs)
        : 'No existing specs found for this route family.';

    const changedFilesBlock = ctx.changedFiles
        .map((f) => {
            if (f.snippet) {
                return `${f.path}:\n\`\`\`\n${f.snippet}\n\`\`\``;
            }
            return f.path;
        })
        .join('\n\n');

    return [
        `You are analyzing code changes in ${ctx.projectName || 'the project'} to identify impacted user-facing flows.`,
        '',
        `ROUTE FAMILY: ${ctx.family.id}`,
        `ROUTES: ${familyRoutes}`,
        featureNote,
        '',
        `PAGE OBJECTS AND COMPONENTS:`,
        apiSurfaceBlock,
        '',
        `EXISTING SPECS FOR THIS FAMILY (${ctx.existingSpecs.length}):`,
        specsBlock,
        '',
        `CHANGED FILES (${ctx.changedFiles.length}):`,
        changedFilesBlock,
        '',
        ctx.contextBlock,
        '',
        'For each changed file, identify impacted user-facing flows.',
        '',
        'Return strict JSON only with this shape:',
        '{"flows":[{"id":"<flow_id>","name":"<human readable name>","route":"<specific route from ROUTES>","userActions":["<what the user does>"],"priority":"P0|P1|P2","confidence":0-100,"evidence":"<why this flow is impacted>","pageObjects":["<page object used>"],"changedFiles":["<files>"]}]}',
        '',
        'Rules:',
        '- ONLY use routes listed in ROUTES above.',
        '- ONLY reference page objects and components listed above.',
        '- Each flow must describe a specific user action, not a generic category.',
        '- If you cannot determine the impacted flow with high confidence, return:',
        '  {"id":"unknown","name":"cannot determine","confidence":0,"evidence":"<reason>","userActions":[],"changedFiles":["<files>"]}',
        '- Do NOT default to /admin_console/reporting/system_analytics unless the changed files are literally analytics code.',
        '- Do NOT invent routes, page objects, or methods that are not listed above.',
        '- Keep at most 8 flows.',
        '- Prioritize true user-impacting flows; avoid low-value internal buckets.',
    ].filter(Boolean).join('\n');
}

export interface ImpactAgentResponse {
    flows: Array<{
        id: string;
        name: string;
        route?: string;
        userActions?: string[];
        priority?: string;
        confidence?: number;
        evidence?: string;
        pageObjects?: string[];
        changedFiles?: string[];
    }>;
}

export function parseImpactResponse(text: string): ImpactAgentResponse | null {
    return extractJsonFromResponse<ImpactAgentResponse>(
        text,
        (obj): obj is ImpactAgentResponse =>
            obj != null && typeof obj === 'object' && Array.isArray((obj as ImpactAgentResponse).flows),
    );
}

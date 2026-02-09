// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {FlowImpact} from './analysis.js';
import type {AgentConfig} from './config.js';
import type {FlowCatalog} from './flow_catalog.js';
import {matchGlob, normalizePath, tokenize, uniqueTokens} from './utils.js';

export interface CatalogMappingResult {
    flows: FlowImpact[];
    testsByFlow: Map<string, string[]>;
    warnings: string[];
}

function pathMatches(patterns: string[], filePath: string): string | null {
    for (const pattern of patterns) {
        if (matchGlob(filePath, pattern)) {
            return pattern;
        }
    }
    return null;
}

function keywordMatches(keywords: string[], filePath: string): string | null {
    const tokens = tokenize(filePath);
    for (const keyword of keywords) {
        if (tokens.includes(keyword.toLowerCase())) {
            return keyword;
        }
    }
    return null;
}

export function mapChangesToCatalogFlows(
    catalog: FlowCatalog,
    changedFiles: string[],
    mode: 'impact' | 'gap',
    config: AgentConfig,
): CatalogMappingResult {
    const warnings: string[] = [];
    const flows: FlowImpact[] = [];
    const testsByFlow = new Map<string, string[]>();

    const normalizedChanges = Array.from(new Set(changedFiles.map((file) => normalizePath(file))));

    for (const flow of catalog.flows) {
        const reasons: string[] = [];
        const matchedFiles = new Set<string>();
        let matched = false;

        if (flow.paths && flow.paths.length > 0) {
            for (const file of normalizedChanges) {
                const match = pathMatches(flow.paths, file);
                if (match) {
                    matchedFiles.add(file);
                    reasons.push(`Path match: ${match}`);
                    matched = true;
                }
            }
        }

        if (!matched && flow.keywords && flow.keywords.length > 0) {
            for (const file of normalizedChanges) {
                const keyword = keywordMatches(flow.keywords, file);
                if (keyword) {
                    matchedFiles.add(file);
                    reasons.push(`Keyword match: ${keyword}`);
                    matched = true;
                }
            }
        }

        if (mode === 'impact' && !matched) {
            continue;
        }

        if (mode === 'gap' && reasons.length === 0) {
            reasons.push('Catalog flow');
        }

        const priorityScore =
            config.catalogScoring?.priorityScores?.[flow.priority] ??
            (flow.priority === 'P0' ? 10 : flow.priority === 'P1' ? 6 : 3);
        const fileMatchWeight = config.catalogScoring?.fileMatchWeight ?? 1;
        const score = priorityScore + matchedFiles.size * fileMatchWeight;
        const matchedFilesList = Array.from(matchedFiles);
        flows.push({
            id: flow.id,
            name: flow.name || flow.id,
            kind: 'flow',
            score,
            priority: flow.priority,
            reasons: uniqueTokens(reasons),
            keywords: flow.keywords || [],
            files: uniqueTokens(matchedFilesList),
            audience: flow.audience,
            flags: flow.flags,
        });

        if (flow.tests && flow.tests.length > 0) {
            testsByFlow.set(flow.id, flow.tests.map((test) => normalizePath(test)));
        }
    }

    if (flows.length === 0 && mode === 'impact') {
        warnings.push('No flow catalog entries matched changed files.');
    }

    return {flows, testsByFlow, warnings};
}

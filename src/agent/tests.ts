// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync} from 'fs';
import {globSync} from 'glob';
import {join} from 'path';
import type {FlowImpact} from './analysis.js';
import {normalizePath, safeReadTextFile, tokenize, uniqueTokens} from './utils.js';

export interface TestFile {
    path: string;
    content: string | null;
}

export interface FlowCoverage {
    flowId: string;
    flowName: string;
    priority: string;
    coveredBy: string[];
    score: number;
    expectedTests?: string[];
    source?: 'catalog' | 'traceability' | 'heuristic' | 'ai';
    missingScenarios?: string[];
}

export function discoverTests(appRoot: string, patterns: string[]): TestFile[] {
    const files = new Set<string>();
    for (const pattern of patterns) {
        const matches = globSync(pattern, {
            cwd: appRoot,
            ignore: ['**/node_modules/**', '**/.git/**'],
            nodir: true,
        });
        for (const match of matches) {
            files.add(normalizePath(match));
        }
    }

    return Array.from(files).map((relativePath) => {
        const fullPath = join(appRoot, relativePath);
        const content = safeReadTextFile(fullPath);
        return {path: relativePath, content};
    });
}

function buildFlowKeywords(flow: FlowImpact): string[] {
    const tokens: string[] = [];
    tokens.push(...tokenize(flow.id));
    tokens.push(...tokenize(flow.name));
    tokens.push(...flow.keywords);
    return uniqueTokens(tokens);
}

export function mapTestsToFlows(flows: FlowImpact[], tests: TestFile[]): FlowCoverage[] {
    const coverage: FlowCoverage[] = [];

    for (const flow of flows) {
        const keywords = buildFlowKeywords(flow);
        const matched: string[] = [];
        let score = 0;
        for (const test of tests) {
            const haystack = `${test.path} ${test.content || ''}`.toLowerCase();
            let localScore = 0;
            for (const keyword of keywords) {
                if (keyword && haystack.includes(keyword.toLowerCase())) {
                    localScore += 1;
                }
            }
            if (localScore > 0) {
                matched.push(test.path);
                score += localScore;
            }
        }

        coverage.push({
            flowId: flow.id,
            flowName: flow.name,
            priority: flow.priority,
            coveredBy: matched,
            score,
            source: 'heuristic',
        });
    }

    return coverage;
}

function resolveExpectedTests(testsRoot: string, expectedTests: string[]): string[] {
    const resolved: string[] = [];
    for (const entry of expectedTests) {
        if (!entry) {
            continue;
        }
        const normalized = normalizePath(entry).replace(/^\.\//, '');
        if (normalized.startsWith('e2e-tests/playwright/')) {
            resolved.push(normalized.slice('e2e-tests/playwright/'.length));
            continue;
        }
        const specsIndex = normalized.indexOf('specs/');
        if (specsIndex >= 0) {
            resolved.push(normalized.slice(specsIndex));
            continue;
        }
        resolved.push(normalized);
    }
    return Array.from(new Set(resolved));
}

export function mapCatalogTestsToFlows(
    flows: FlowImpact[],
    testsRoot: string,
    testsByFlow: Map<string, string[]>,
): FlowCoverage[] {
    return flows.map((flow) => {
        const expectedTests = resolveExpectedTests(testsRoot, testsByFlow.get(flow.id) || []);
        const coveredBy: string[] = [];
        for (const expected of expectedTests) {
            const isAbsolute = expected.startsWith('/');
            const globTarget = isAbsolute ? expected : expected;
            if (expected.includes('*') || expected.includes('?') || expected.includes('{')) {
                const matches = globSync(globTarget, {cwd: isAbsolute ? undefined : testsRoot, nodir: true});
                if (matches.length > 0) {
                    coveredBy.push(...matches.map((match) => normalizePath(match)));
                }
                continue;
            }
            const fullPath = isAbsolute ? expected : join(testsRoot, expected);
            if (existsSync(fullPath)) {
                coveredBy.push(isAbsolute ? normalizePath(expected) : expected);
            }
        }

        return {
            flowId: flow.id,
            flowName: flow.name,
            priority: flow.priority,
            coveredBy: Array.from(new Set(coveredBy)),
            score: coveredBy.length,
            expectedTests,
            source: 'catalog',
        };
    });
}

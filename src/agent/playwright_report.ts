// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {readFileSync} from 'fs';
import {resolve} from 'path';
import {normalizePath} from './utils.js';

interface PlaywrightResultNode {
    status?: unknown;
}

interface PlaywrightTestNode {
    status?: unknown;
    outcome?: unknown;
    results?: unknown;
}

interface PlaywrightSpecNode {
    file?: unknown;
    tests?: unknown;
}

interface PlaywrightSuiteNode {
    suites?: unknown;
    specs?: unknown;
}

type Instability = 'failed' | 'flaky' | 'stable';

export interface UnstablePlaywrightSpec {
    specPath: string;
    status: 'failed' | 'flaky';
    failingTests: number;
    flakyTests: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function isFailureStatus(value: string): boolean {
    return value === 'failed' || value === 'timedOut' || value === 'interrupted';
}

function classifyTestInstability(testNode: PlaywrightTestNode): Instability {
    const outcome = typeof testNode.outcome === 'string' ? testNode.outcome : '';
    if (outcome === 'unexpected') {
        return 'failed';
    }
    if (outcome === 'flaky') {
        return 'flaky';
    }

    const status = typeof testNode.status === 'string' ? testNode.status : '';
    if (status === 'flaky') {
        return 'flaky';
    }
    if (isFailureStatus(status)) {
        return 'failed';
    }

    let sawFailure = false;
    let sawPass = false;
    for (const resultValue of asArray(testNode.results)) {
        const resultNode = asRecord(resultValue) as PlaywrightResultNode | null;
        if (!resultNode) {
            continue;
        }
        const resultStatus = typeof resultNode.status === 'string' ? resultNode.status : '';
        if (isFailureStatus(resultStatus)) {
            sawFailure = true;
        } else if (resultStatus === 'passed') {
            sawPass = true;
        }
    }

    if (sawFailure && sawPass) {
        return 'flaky';
    }
    if (sawFailure) {
        return 'failed';
    }
    return 'stable';
}

function relativize(pathValue: string, roots: string[]): string {
    const normalized = normalizePath(pathValue);
    for (const root of roots) {
        const normalizedRoot = normalizePath(resolve(root));
        if (normalized === normalizedRoot) {
            return '.';
        }
        if (normalized.startsWith(`${normalizedRoot}/`)) {
            return normalized.slice(normalizedRoot.length + 1);
        }
    }
    return normalized;
}

function collectUnstableSpecs(
    value: unknown,
    roots: string[],
    unstableMap: Map<string, UnstablePlaywrightSpec>,
): void {
    const node = asRecord(value) as PlaywrightSuiteNode | null;
    if (!node) {
        return;
    }

    for (const specValue of asArray(node.specs)) {
        const specNode = asRecord(specValue) as PlaywrightSpecNode | null;
        if (!specNode || typeof specNode.file !== 'string') {
            continue;
        }

        let failingTests = 0;
        let flakyTests = 0;
        for (const testValue of asArray(specNode.tests)) {
            const testNode = asRecord(testValue) as PlaywrightTestNode | null;
            if (!testNode) {
                continue;
            }
            const instability = classifyTestInstability(testNode);
            if (instability === 'failed') {
                failingTests += 1;
            } else if (instability === 'flaky') {
                flakyTests += 1;
            }
        }

        if (failingTests === 0 && flakyTests === 0) {
            continue;
        }

        const specPath = relativize(specNode.file, roots);
        const existing = unstableMap.get(specPath);
        const mergedFailing = (existing?.failingTests || 0) + failingTests;
        const mergedFlaky = (existing?.flakyTests || 0) + flakyTests;
        unstableMap.set(specPath, {
            specPath,
            status: mergedFailing > 0 ? 'failed' : 'flaky',
            failingTests: mergedFailing,
            flakyTests: mergedFlaky,
        });
    }

    for (const suite of asArray(node.suites)) {
        collectUnstableSpecs(suite, roots, unstableMap);
    }
}

export function extractPlaywrightUnstableSpecs(reportPath: string, roots: string[]): UnstablePlaywrightSpec[] {
    const fullPath = resolve(reportPath);
    const raw = JSON.parse(readFileSync(fullPath, 'utf-8')) as unknown;
    const unstableMap = new Map<string, UnstablePlaywrightSpec>();
    collectUnstableSpecs(raw, roots, unstableMap);
    return Array.from(unstableMap.values()).sort((a, b) => {
        if (a.status !== b.status) {
            return a.status === 'failed' ? -1 : 1;
        }
        return a.specPath.localeCompare(b.specPath);
    });
}

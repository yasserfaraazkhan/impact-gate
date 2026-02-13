// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import {isAbsolute, join} from 'path';
import type {FlowImpact} from './analysis.js';
import type {TraceabilityImpactConfig} from './config.js';
import type {FlowCoverage} from './tests.js';
import {normalizePath} from './utils.js';

interface TraceabilityManifestTestEntry {
    test: string;
    touchedFiles?: string[];
}

interface TraceabilityManifestFileEntry {
    file: string;
    tests: string[];
}

interface TraceabilityManifest {
    schemaVersion?: string;
    tests?: TraceabilityManifestTestEntry[];
    fileToTests?: Record<string, string[]>;
    mappings?: TraceabilityManifestFileEntry[];
}

export interface TraceabilityStats {
    source: 'manifest';
    enabled: boolean;
    manifestPath: string;
    manifestFound: boolean;
    manifestTests: number;
    manifestEdges: number;
    matchedFlows: number;
    totalFlows: number;
    matchedTests: number;
    coverageRatio: number;
}

export interface TraceabilityMappingResult {
    coverage: FlowCoverage[];
    stats: TraceabilityStats;
    warnings: string[];
}

function ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) {
        return 0;
    }
    return Number((numerator / denominator).toFixed(4));
}

function resolveManifestPath(root: string, configuredPath: string): string {
    if (isAbsolute(configuredPath)) {
        return configuredPath;
    }
    return join(root, configuredPath);
}

function safeReadManifest(path: string): TraceabilityManifest | null {
    if (!existsSync(path)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as TraceabilityManifest;
    } catch {
        return null;
    }
}

function normalizeFiles(files: string[] | undefined): string[] {
    if (!files) {
        return [];
    }
    return files.map((file) => normalizePath(file)).filter(Boolean);
}

function normalizeTests(tests: string[] | undefined): string[] {
    if (!tests) {
        return [];
    }
    return tests.map((test) => normalizePath(test)).filter(Boolean);
}

function buildFileToTestsMap(manifest: TraceabilityManifest): Map<string, Set<string>> {
    const fileToTests = new Map<string, Set<string>>();

    const setMapping = (file: string, test: string): void => {
        if (!file || !test) {
            return;
        }
        const key = normalizePath(file);
        const value = normalizePath(test);
        if (!fileToTests.has(key)) {
            fileToTests.set(key, new Set<string>());
        }
        fileToTests.get(key)?.add(value);
    };

    if (manifest.tests) {
        for (const entry of manifest.tests) {
            const files = normalizeFiles(entry.touchedFiles);
            for (const file of files) {
                setMapping(file, entry.test);
            }
        }
    }

    if (manifest.fileToTests) {
        for (const [file, tests] of Object.entries(manifest.fileToTests)) {
            const normalizedTests = normalizeTests(tests);
            for (const test of normalizedTests) {
                setMapping(file, test);
            }
        }
    }

    if (manifest.mappings) {
        for (const entry of manifest.mappings) {
            const normalizedTests = normalizeTests(entry.tests);
            for (const test of normalizedTests) {
                setMapping(entry.file, test);
            }
        }
    }

    return fileToTests;
}

export function mapTraceabilityToFlows(
    appRoot: string,
    config: TraceabilityImpactConfig,
    flows: FlowImpact[],
): TraceabilityMappingResult {
    const manifestPath = resolveManifestPath(appRoot, config.manifestPath);
    const warnings: string[] = [];
    const fallbackStats: TraceabilityStats = {
        source: 'manifest',
        enabled: config.enabled,
        manifestPath,
        manifestFound: false,
        manifestTests: 0,
        manifestEdges: 0,
        matchedFlows: 0,
        totalFlows: flows.length,
        matchedTests: 0,
        coverageRatio: 0,
    };

    if (!config.enabled) {
        return {
            coverage: [],
            warnings,
            stats: fallbackStats,
        };
    }

    const manifest = safeReadManifest(manifestPath);
    if (!manifest) {
        warnings.push(`Traceability manifest not found or invalid: ${manifestPath}`);
        return {
            coverage: [],
            warnings,
            stats: fallbackStats,
        };
    }

    const fileToTests = buildFileToTestsMap(manifest);
    let manifestEdges = 0;
    for (const tests of fileToTests.values()) {
        manifestEdges += tests.size;
    }

    const manifestTests = new Set<string>();
    const coverage: FlowCoverage[] = [];
    const matchedTests = new Set<string>();
    let matchedFlows = 0;

    for (const tests of fileToTests.values()) {
        for (const test of tests) {
            manifestTests.add(test);
        }
    }

    for (const flow of flows) {
        const signalCounts = new Map<string, number>();
        const files = flow.files.map((file) => normalizePath(file));
        for (const file of files) {
            const tests = fileToTests.get(file);
            if (!tests) {
                continue;
            }
            for (const test of tests) {
                signalCounts.set(test, (signalCounts.get(test) || 0) + 1);
            }
        }

        const coveredBy = Array.from(signalCounts.entries())
            .filter(([, count]) => count >= Math.max(1, config.minSignalsPerTest))
            .map(([test]) => test)
            .sort();
        const score = Array.from(signalCounts.values()).reduce((acc, value) => acc + value, 0);

        if (coveredBy.length > 0) {
            matchedFlows += 1;
            for (const test of coveredBy) {
                matchedTests.add(test);
            }
        }

        coverage.push({
            flowId: flow.id,
            flowName: flow.name,
            priority: flow.priority,
            coveredBy,
            score,
            source: 'traceability',
        });
    }

    const stats: TraceabilityStats = {
        source: 'manifest',
        enabled: config.enabled,
        manifestPath,
        manifestFound: true,
        manifestTests: manifestTests.size,
        manifestEdges,
        matchedFlows,
        totalFlows: flows.length,
        matchedTests: matchedTests.size,
        coverageRatio: ratio(matchedFlows, flows.length),
    };

    if (manifestEdges === 0) {
        warnings.push(`Traceability manifest has no file-to-test mappings: ${manifestPath}`);
    } else if (stats.coverageRatio < 0.4) {
        warnings.push(
            `Traceability coverage is low (${stats.matchedFlows}/${stats.totalFlows} flows mapped). Recommendations may require heuristic fallback.`,
        );
    }

    return {
        coverage,
        warnings,
        stats,
    };
}

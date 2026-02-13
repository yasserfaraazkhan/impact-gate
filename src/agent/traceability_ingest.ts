// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, isAbsolute, join} from 'path';
import type {TraceabilityImpactConfig} from './config.js';
import {normalizePath} from './utils.js';

export interface TraceabilityIngestEntry {
    test: string;
    touchedFiles: string[];
    timestamp?: string;
}

export interface TraceabilityIngestOptions {
    minHits?: number;
    maxFilesPerTest?: number;
    maxAgeDays?: number;
}

interface TraceabilityStateEntry {
    files: Record<string, number>;
    seenCount: number;
    lastSeen: string;
}

interface TraceabilityState {
    schemaVersion: '1.0.0';
    updatedAt: string;
    tests: Record<string, TraceabilityStateEntry>;
}

interface TraceabilityManifest {
    schemaVersion: '1.0.0';
    generatedAt: string;
    tests: Array<{
        test: string;
        touchedFiles: string[];
        signalCount: number;
        lastSeen: string;
    }>;
}

interface TraceabilityManifestInput {
    tests?: Array<{test?: unknown; touchedFiles?: unknown; timestamp?: unknown}>;
    runs?: Array<{test?: unknown; touchedFiles?: unknown; coveredFiles?: unknown; files?: unknown; timestamp?: unknown}>;
    fileToTests?: Record<string, unknown>;
    mappings?: Array<{file?: unknown; tests?: unknown}>;
}

export interface TraceabilityIngestResult {
    manifestPath: string;
    statePath: string;
    entriesIngested: number;
    testsTracked: number;
    edgesTracked: number;
    warnings: string[];
}

const DEFAULT_OPTIONS: Required<TraceabilityIngestOptions> = {
    minHits: 1,
    maxFilesPerTest: 200,
    maxAgeDays: 120,
};

function resolvePath(root: string, value: string): string {
    if (isAbsolute(value)) {
        return value;
    }
    return join(root, value);
}

function parseDate(value: string): number | null {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
        return null;
    }
    return parsed;
}

function safeReadJson<T>(path: string): T | null {
    if (!existsSync(path)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as T;
    } catch {
        return null;
    }
}

function normalizeFiles(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(
        new Set(
            value
                .filter((entry) => typeof entry === 'string')
                .map((entry) => normalizePath(entry)),
        ),
    );
}

function normalizeTest(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = normalizePath(value);
    return normalized ? normalized : null;
}

function buildEntriesFromInput(payload: unknown): {entries: TraceabilityIngestEntry[]; warnings: string[]} {
    const warnings: string[] = [];
    const entries: TraceabilityIngestEntry[] = [];

    const pushEntry = (testValue: unknown, filesValue: unknown, timestampValue?: unknown): void => {
        const test = normalizeTest(testValue);
        const files = normalizeFiles(filesValue);
        if (!test || files.length === 0) {
            return;
        }
        entries.push({
            test,
            touchedFiles: files,
            timestamp: typeof timestampValue === 'string' ? timestampValue : undefined,
        });
    };

    if (Array.isArray(payload)) {
        for (const item of payload) {
            if (!item || typeof item !== 'object') {
                continue;
            }
            const entry = item as Record<string, unknown>;
            pushEntry(entry.test, entry.touchedFiles, entry.timestamp);
        }
        if (entries.length === 0) {
            warnings.push('Traceability input array had no valid entries.');
        }
        return {entries, warnings};
    }

    if (!payload || typeof payload !== 'object') {
        warnings.push('Traceability input must be an object or array.');
        return {entries, warnings};
    }

    const input = payload as TraceabilityManifestInput;

    if (Array.isArray(input.tests)) {
        for (const item of input.tests) {
            pushEntry(item?.test, item?.touchedFiles, item?.timestamp);
        }
    }

    if (Array.isArray(input.runs)) {
        for (const item of input.runs) {
            const files = Array.isArray(item?.touchedFiles) ? item?.touchedFiles : (Array.isArray(item?.coveredFiles) ? item?.coveredFiles : item?.files);
            pushEntry(item?.test, files, item?.timestamp);
        }
    }

    if (input.fileToTests && typeof input.fileToTests === 'object') {
        for (const [file, tests] of Object.entries(input.fileToTests)) {
            if (!Array.isArray(tests)) {
                continue;
            }
            const normalizedFile = normalizePath(file);
            for (const test of tests) {
                pushEntry(test, [normalizedFile]);
            }
        }
    }

    if (Array.isArray(input.mappings)) {
        for (const mapping of input.mappings) {
            const file = typeof mapping?.file === 'string' ? normalizePath(mapping.file) : null;
            if (!file || !Array.isArray(mapping.tests)) {
                continue;
            }
            for (const test of mapping.tests) {
                pushEntry(test, [file]);
            }
        }
    }

    if (entries.length === 0) {
        warnings.push('Traceability input had no valid test<->file entries.');
    }

    return {entries, warnings};
}

function defaultState(): TraceabilityState {
    return {
        schemaVersion: '1.0.0',
        updatedAt: new Date().toISOString(),
        tests: {},
    };
}

function loadState(path: string): TraceabilityState {
    const existing = safeReadJson<TraceabilityState>(path);
    if (!existing || typeof existing !== 'object' || !existing.tests) {
        return defaultState();
    }
    return {
        schemaVersion: '1.0.0',
        updatedAt: existing.updatedAt || new Date().toISOString(),
        tests: existing.tests,
    };
}

function pruneByAge(state: TraceabilityState, maxAgeDays: number): void {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    for (const [test, entry] of Object.entries(state.tests)) {
        const lastSeen = parseDate(entry.lastSeen);
        if (lastSeen === null) {
            continue;
        }
        if (lastSeen < cutoff) {
            delete state.tests[test];
        }
    }
}

function buildManifest(
    state: TraceabilityState,
    minHits: number,
    maxFilesPerTest: number,
): TraceabilityManifest {
    const tests = Object.entries(state.tests)
        .map(([test, entry]) => {
            const touchedFiles = Object.entries(entry.files)
                .filter(([, hits]) => hits >= minHits)
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .slice(0, maxFilesPerTest)
                .map(([file]) => file);
            const signalCount = Object.values(entry.files).reduce((acc, value) => acc + value, 0);
            return {
                test,
                touchedFiles,
                signalCount,
                lastSeen: entry.lastSeen,
            };
        })
        .filter((entry) => entry.touchedFiles.length > 0)
        .sort((a, b) => a.test.localeCompare(b.test));

    return {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        tests,
    };
}

function ensureParent(path: string): void {
    mkdirSync(dirname(path), {recursive: true});
}

export function ingestTraceabilityInput(
    rootPath: string,
    traceabilityConfig: TraceabilityImpactConfig,
    inputPayload: unknown,
    options?: TraceabilityIngestOptions,
): TraceabilityIngestResult {
    const resolvedOptions: Required<TraceabilityIngestOptions> = {
        minHits: options?.minHits ?? DEFAULT_OPTIONS.minHits,
        maxFilesPerTest: options?.maxFilesPerTest ?? DEFAULT_OPTIONS.maxFilesPerTest,
        maxAgeDays: options?.maxAgeDays ?? DEFAULT_OPTIONS.maxAgeDays,
    };
    const warnings: string[] = [];
    const manifestPath = resolvePath(rootPath, traceabilityConfig.manifestPath);
    const statePath = join(dirname(manifestPath), 'traceability-state.json');

    if (!traceabilityConfig.enabled) {
        warnings.push('Traceability is disabled in config. Input was not ingested.');
        return {
            manifestPath,
            statePath,
            entriesIngested: 0,
            testsTracked: 0,
            edgesTracked: 0,
            warnings,
        };
    }

    const parsed = buildEntriesFromInput(inputPayload);
    warnings.push(...parsed.warnings);
    const state = loadState(statePath);
    const now = new Date().toISOString();

    for (const entry of parsed.entries) {
        const bucket = state.tests[entry.test] || {
            files: {},
            seenCount: 0,
            lastSeen: now,
        };
        bucket.seenCount += 1;
        bucket.lastSeen = entry.timestamp || now;
        for (const file of entry.touchedFiles) {
            bucket.files[file] = (bucket.files[file] || 0) + 1;
        }
        state.tests[entry.test] = bucket;
    }

    pruneByAge(state, Math.max(1, resolvedOptions.maxAgeDays));
    state.updatedAt = now;

    const manifest = buildManifest(
        state,
        Math.max(1, resolvedOptions.minHits),
        Math.max(1, resolvedOptions.maxFilesPerTest),
    );

    let edgesTracked = 0;
    for (const entry of manifest.tests) {
        edgesTracked += entry.touchedFiles.length;
    }

    ensureParent(statePath);
    ensureParent(manifestPath);
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    return {
        manifestPath,
        statePath,
        entriesIngested: parsed.entries.length,
        testsTracked: manifest.tests.length,
        edgesTracked,
        warnings,
    };
}

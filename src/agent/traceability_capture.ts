// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, isAbsolute, resolve} from 'path';
import {getChangedFiles} from './git.js';
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

interface CoverageInput {
    tests?: Array<{test?: unknown; touchedFiles?: unknown; files?: unknown}>;
    runs?: Array<{test?: unknown; touchedFiles?: unknown; coveredFiles?: unknown; files?: unknown}>;
    fileToTests?: Record<string, unknown>;
    mappings?: Array<{file?: unknown; tests?: unknown}>;
}

export interface TraceabilityCaptureOptions {
    appPath: string;
    testsRoot: string;
    reportPath: string;
    sinceRef: string;
    outputPath?: string;
    coverageMapPath?: string;
    changedFilesPath?: string;
}

export interface TraceabilityCaptureResult {
    outputPath: string;
    testsSeen: number;
    runsGenerated: number;
    changedFilesUsed: number;
    warnings: string[];
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

function resolveFilePath(cwd: string, value: string): string {
    if (isAbsolute(value)) {
        return value;
    }
    return resolve(cwd, value);
}

function normalizeList(values: string[]): string[] {
    return Array.from(
        new Set(
            values
                .map((value) => normalizePath(value))
                .filter(Boolean),
        ),
    );
}

function parseStringArray(value: unknown): string[] {
    return normalizeList(
        asArray(value)
            .filter((item) => typeof item === 'string')
            .map((item) => item as string),
    );
}

function isExecutedStatus(status: string): boolean {
    return status !== 'skipped';
}

function specExecuted(spec: PlaywrightSpecNode): boolean {
    const tests = asArray(spec.tests);
    if (tests.length === 0) {
        return false;
    }
    for (const testValue of tests) {
        const testNode = asRecord(testValue) as PlaywrightTestNode | null;
        if (!testNode) {
            continue;
        }
        const testStatus = typeof testNode.status === 'string' ? testNode.status : undefined;
        if (testStatus && isExecutedStatus(testStatus)) {
            return true;
        }
        const outcome = typeof testNode.outcome === 'string' ? testNode.outcome : undefined;
        if (outcome && isExecutedStatus(outcome)) {
            return true;
        }
        const results = asArray(testNode.results);
        for (const resultValue of results) {
            const resultNode = asRecord(resultValue) as PlaywrightResultNode | null;
            if (!resultNode) {
                continue;
            }
            const status = typeof resultNode.status === 'string' ? resultNode.status : undefined;
            if (status && isExecutedStatus(status)) {
                return true;
            }
        }
    }
    return false;
}

function relativizePath(path: string, roots: string[]): string {
    const normalized = normalizePath(path);
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

function collectExecutedSpecs(value: unknown, roots: string[], output: Set<string>): void {
    const node = asRecord(value) as PlaywrightSuiteNode | null;
    if (!node) {
        return;
    }

    const specs = asArray(node.specs);
    for (const specValue of specs) {
        const specNode = asRecord(specValue) as PlaywrightSpecNode | null;
        if (!specNode) {
            continue;
        }
        const file = typeof specNode.file === 'string' ? specNode.file : '';
        if (!file) {
            continue;
        }
        if (!specExecuted(specNode)) {
            continue;
        }
        output.add(relativizePath(file, roots));
    }

    const suites = asArray(node.suites);
    for (const suite of suites) {
        collectExecutedSpecs(suite, roots, output);
    }
}

function loadPlaywrightExecutedSpecs(reportPath: string, roots: string[]): string[] {
    const raw = JSON.parse(readFileSync(reportPath, 'utf-8')) as unknown;
    const specs = new Set<string>();
    collectExecutedSpecs(raw, roots, specs);
    return Array.from(specs).sort();
}

function loadChangedFilesFromPath(filePath: string): string[] {
    const rawText = readFileSync(filePath, 'utf-8');
    const trimmed = rawText.trim();
    if (!trimmed) {
        return [];
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
            return normalizeList(parsed.filter((value) => typeof value === 'string') as string[]);
        }
        const node = asRecord(parsed);
        if (!node) {
            return [];
        }
        if (Array.isArray(node.files)) {
            return normalizeList(node.files.filter((value) => typeof value === 'string') as string[]);
        }
        if (Array.isArray(node.changedFiles)) {
            return normalizeList(node.changedFiles.filter((value) => typeof value === 'string') as string[]);
        }
        return [];
    }
    return normalizeList(
        rawText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
    );
}

function addCoverageEntry(map: Map<string, Set<string>>, test: string, files: string[]): void {
    if (!test || files.length === 0) {
        return;
    }
    const normalizedTest = normalizePath(test);
    if (!map.has(normalizedTest)) {
        map.set(normalizedTest, new Set<string>());
    }
    const bucket = map.get(normalizedTest);
    for (const file of files) {
        bucket?.add(normalizePath(file));
    }
}

function loadCoverageMap(path: string): Map<string, Set<string>> {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    const map = new Map<string, Set<string>>();

    const appendTestEntry = (testValue: unknown, filesValue: unknown): void => {
        if (typeof testValue !== 'string') {
            return;
        }
        const files = parseStringArray(filesValue);
        addCoverageEntry(map, testValue, files);
    };

    if (Array.isArray(raw)) {
        for (const entry of raw) {
            const node = asRecord(entry);
            if (!node) {
                continue;
            }
            appendTestEntry(node.test, node.touchedFiles);
        }
        return map;
    }

    const node = asRecord(raw);
    if (!node) {
        return map;
    }

    for (const entry of asArray(node.tests)) {
        const testNode = asRecord(entry);
        if (!testNode) {
            continue;
        }
        appendTestEntry(testNode.test, Array.isArray(testNode.touchedFiles) ? testNode.touchedFiles : testNode.files);
    }

    for (const entry of asArray(node.runs)) {
        const runNode = asRecord(entry);
        if (!runNode) {
            continue;
        }
        const files = Array.isArray(runNode.touchedFiles)
            ? runNode.touchedFiles
            : (Array.isArray(runNode.coveredFiles) ? runNode.coveredFiles : runNode.files);
        appendTestEntry(runNode.test, files);
    }

    const mappings = asArray(node.mappings);
    for (const mapping of mappings) {
        const mappingNode = asRecord(mapping);
        if (!mappingNode || typeof mappingNode.file !== 'string' || !Array.isArray(mappingNode.tests)) {
            continue;
        }
        const normalizedFile = normalizePath(mappingNode.file);
        for (const test of mappingNode.tests) {
            if (typeof test !== 'string') {
                continue;
            }
            addCoverageEntry(map, test, [normalizedFile]);
        }
    }

    const fileToTests = asRecord(node.fileToTests);
    if (fileToTests) {
        for (const [file, tests] of Object.entries(fileToTests)) {
            if (!Array.isArray(tests)) {
                continue;
            }
            for (const test of tests) {
                if (typeof test !== 'string') {
                    continue;
                }
                addCoverageEntry(map, test, [normalizePath(file)]);
            }
        }
    }

    return map;
}

function coverageForSpec(specPath: string, coverageMap: Map<string, Set<string>>): string[] {
    const normalizedSpec = normalizePath(specPath);
    const files = new Set<string>();

    const direct = coverageMap.get(normalizedSpec);
    if (direct) {
        for (const file of direct) {
            files.add(file);
        }
    }

    const prefix = `${normalizedSpec}#`;
    for (const [key, value] of coverageMap.entries()) {
        if (key.startsWith(prefix)) {
            for (const file of value) {
                files.add(file);
            }
        }
    }

    return Array.from(files).sort();
}

export function captureTraceabilityInput(options: TraceabilityCaptureOptions): TraceabilityCaptureResult {
    const warnings: string[] = [];
    const reportPath = resolveFilePath(process.cwd(), options.reportPath);
    if (!existsSync(reportPath)) {
        throw new Error(`Traceability report not found: ${reportPath}`);
    }

    const roots = [options.testsRoot, options.appPath].map((root) => resolve(root));
    const executedSpecs = loadPlaywrightExecutedSpecs(reportPath, roots);
    if (executedSpecs.length === 0) {
        warnings.push('No executed tests found in Playwright report.');
    }

    let changedFiles: string[] = [];
    if (options.changedFilesPath) {
        const changedPath = resolveFilePath(process.cwd(), options.changedFilesPath);
        if (existsSync(changedPath)) {
            changedFiles = loadChangedFilesFromPath(changedPath);
        } else {
            warnings.push(`Changed files path not found: ${changedPath}`);
        }
    } else {
        const diff = getChangedFiles(options.appPath, options.sinceRef, {includeUncommitted: false});
        if (diff.error) {
            warnings.push(`Git diff failed while building traceability input: ${diff.error}`);
        }
        changedFiles = diff.files;
    }
    changedFiles = normalizeList(changedFiles);

    let coverageMap = new Map<string, Set<string>>();
    if (options.coverageMapPath) {
        const coveragePath = resolveFilePath(process.cwd(), options.coverageMapPath);
        if (existsSync(coveragePath)) {
            coverageMap = loadCoverageMap(coveragePath);
        } else {
            warnings.push(`Coverage map path not found: ${coveragePath}`);
        }
    }

    const runs = executedSpecs.map((spec) => {
        const mappedFiles = coverageForSpec(spec, coverageMap);
        const touchedFiles = mappedFiles.length > 0 ? mappedFiles : changedFiles;
        return {
            test: spec,
            touchedFiles,
            timestamp: new Date().toISOString(),
        };
    }).filter((entry) => entry.touchedFiles.length > 0);

    if (runs.length < executedSpecs.length && changedFiles.length === 0) {
        warnings.push('Some executed tests had no coverage-map entries and no changed-files fallback.');
    }

    const outputPath = options.outputPath
        ? resolveFilePath(process.cwd(), options.outputPath)
        : resolve(options.testsRoot, '.e2e-ai-agents', 'traceability-input.json');
    mkdirSync(dirname(outputPath), {recursive: true});
    writeFileSync(
        outputPath,
        JSON.stringify(
            {
                schemaVersion: '1.0.0',
                source: 'traceability-capture',
                generatedAt: new Date().toISOString(),
                runs,
            },
            null,
            2,
        ),
        'utf-8',
    );

    return {
        outputPath,
        testsSeen: executedSpecs.length,
        runsGenerated: runs.length,
        changedFilesUsed: changedFiles.length,
        warnings,
    };
}

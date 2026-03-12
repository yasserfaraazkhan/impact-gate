// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readdirSync, readFileSync} from 'fs';
import {join} from 'path';

import type {
    RouteFamilyManifest,
    FileBinding,
    FeaturePriority,
} from '../knowledge/route_families.js';
import {
    loadRouteFamilyManifest,
    bindFilesToFamilies,
    getSpecDirsForBinding,
    getCypressSpecDirsForBinding,
    getPriorityForBinding,
    getUserFlowsForBinding,
} from '../knowledge/route_families.js';
import type {RouteFamiliesConfig} from '../agent/config.js';

export type CoverageStatus = 'covered' | 'partial' | 'uncovered';

export interface SpecWithScenarios {
    file: string;
    scenarios: string[];
}

export interface ImpactedFeature {
    familyId: string;
    featureId?: string;
    priority: FeaturePriority;
    changedFiles: string[];
    playwrightSpecs: string[];
    cypressSpecs: string[];
    playwrightSpecDetails: SpecWithScenarios[];
    cypressSpecDetails: SpecWithScenarios[];
    userFlows: string[];
    coverageStatus: CoverageStatus;
}

export interface ImpactResult {
    changedFiles: string[];
    expandedFiles: string[];
    impactedFeatures: ImpactedFeature[];
    unboundFiles: string[];
    warnings: string[];
}

export interface ImpactEngineOptions {
    testsRoot: string;
    cypressRoot?: string;
    routeFamilies?: RouteFamiliesConfig;
    expandedFiles?: string[];
}

function scanDirForSpecs(baseDir: string, specDir: string, extension: string): string[] {
    const fullDir = join(baseDir, specDir);
    if (!existsSync(fullDir)) {
        return [];
    }
    const specs: string[] = [];
    try {
        const items = readdirSync(fullDir, {withFileTypes: true});
        for (const item of items) {
            const itemPath = join(fullDir, item.name);
            if (item.isDirectory()) {
                specs.push(...scanDirForSpecsRecursive(itemPath, extension));
            } else if (item.name.endsWith(extension)) {
                specs.push(join(specDir, item.name));
            }
        }
    } catch {
        // Directory not readable
    }
    return specs;
}

function scanDirForSpecsRecursive(dir: string, extension: string): string[] {
    const specs: string[] = [];
    try {
        const items = readdirSync(dir, {withFileTypes: true});
        for (const item of items) {
            const fullPath = join(dir, item.name);
            if (item.isDirectory()) {
                specs.push(...scanDirForSpecsRecursive(fullPath, extension));
            } else if (item.name.endsWith(extension)) {
                specs.push(fullPath);
            }
        }
    } catch {
        // Directory not readable
    }
    return specs;
}

// Regex patterns for extracting test scenario titles from spec files.
// Playwright uses test() and test.describe(); Cypress uses describe(), context(), it().
const PLAYWRIGHT_SCENARIO_RE = /(?:test\.describe|test)\(\s*['"`]([^'"`]+)['"`]/g;
const CYPRESS_SCENARIO_RE = /(?:describe|context|it)\(\s*['"`]([^'"`]+)['"`]/g;

/**
 * Extract describe/test/it titles from a spec file using regex.
 * Returns an empty array if the file cannot be read.
 */
export function extractScenarios(filePath: string, framework: 'playwright' | 'cypress'): string[] {
    let content: string;
    try {
        content = readFileSync(filePath, 'utf-8');
    } catch {
        return [];
    }
    const re = framework === 'playwright' ? PLAYWRIGHT_SCENARIO_RE : CYPRESS_SCENARIO_RE;
    const scenarios: string[] = [];
    let match: RegExpExecArray | null;
    // Reset lastIndex in case the regex was used before
    re.lastIndex = 0;
    while ((match = re.exec(content)) !== null) {
        scenarios.push(match[1]);
    }
    return scenarios;
}

function resolvePlaywrightSpecs(testsRoot: string, specDirs: string[]): {paths: string[]; details: SpecWithScenarios[]} {
    const paths: string[] = [];
    const details: SpecWithScenarios[] = [];
    for (const dir of specDirs) {
        const found = scanDirForSpecs(testsRoot, dir, '.spec.ts');
        for (const relPath of found) {
            paths.push(relPath);
            const absPath = join(testsRoot, relPath);
            details.push({file: relPath, scenarios: extractScenarios(absPath, 'playwright')});
        }
    }
    return {paths, details};
}

function resolveCypressSpecs(cypressRoot: string, specDirs: string[]): {paths: string[]; details: SpecWithScenarios[]} {
    const paths: string[] = [];
    const details: SpecWithScenarios[] = [];
    for (const dir of specDirs) {
        // cypressSpecDirs are relative to testsRoot (e.g. ../cypress/tests/integration/channels/search/)
        // Resolve them relative to the cypress root
        const resolvedDir = join(cypressRoot, dir.replace(/^\.\.\/cypress\//, ''));
        if (!existsSync(resolvedDir)) {
            continue;
        }
        const found = scanDirForSpecsRecursive(resolvedDir, '.js');
        const tsFound = scanDirForSpecsRecursive(resolvedDir, '.ts');
        for (const absPath of [...found, ...tsFound]) {
            paths.push(absPath);
            details.push({file: absPath, scenarios: extractScenarios(absPath, 'cypress')});
        }
    }
    return {paths, details};
}

function computeCoverageStatus(pwSpecs: string[], cySpecs: string[]): CoverageStatus {
    // Playwright is the primary framework — having Playwright specs is sufficient for "covered".
    // Cypress-only = partial (advisory: legacy coverage, migrate when possible).
    // Neither = uncovered (must add tests).
    if (pwSpecs.length > 0) {
        return 'covered';
    }
    if (cySpecs.length > 0) {
        return 'partial';
    }
    return 'uncovered';
}

/**
 * Group file bindings into a deduplicated map of family/feature → changed files.
 */
function groupBindings(fileBindings: FileBinding[]): Map<string, {familyId: string; featureId?: string; files: string[]}> {
    const groups = new Map<string, {familyId: string; featureId?: string; files: string[]}>();
    for (const fb of fileBindings) {
        for (const binding of fb.bindings) {
            const key = binding.feature || binding.family;
            const existing = groups.get(key);
            if (existing) {
                if (!existing.files.includes(fb.file)) {
                    existing.files.push(fb.file);
                }
            } else {
                groups.set(key, {
                    familyId: binding.family,
                    featureId: binding.feature,
                    files: [fb.file],
                });
            }
        }
    }
    return groups;
}

/** Filter out test files that should not be treated as application changes. */
function isTestFile(file: string): boolean {
    const normalized = file.replace(/\\/g, '/');
    return /\.(spec|test)\.(ts|tsx|js|jsx)$/.test(normalized) ||
           /_test\.go$/.test(normalized) ||
           normalized.includes('__tests__/') ||
           normalized.includes('/tests/') ||
           normalized.includes('/test/');
}

export function analyzeImpact(
    changedFiles: string[],
    options: ImpactEngineOptions,
): ImpactResult {
    const {testsRoot, routeFamilies} = options;
    const warnings: string[] = [];

    // Filter out test files before analysis
    changedFiles = changedFiles.filter((f) => !isTestFile(f));

    // Load manifest
    const manifest = loadRouteFamilyManifest(testsRoot, routeFamilies);
    if (!manifest) {
        return {
            changedFiles,
            expandedFiles: options.expandedFiles || [],
            impactedFeatures: [],
            unboundFiles: [...changedFiles],
            warnings: ['Route family manifest not found. All files are unbound.'],
        };
    }

    // Combine original + expanded files
    const allFiles = [...new Set([...changedFiles, ...(options.expandedFiles || [])])];

    // Bind files to families
    const fileBindings = bindFilesToFamilies(allFiles, manifest);

    // Find unbound files
    const unboundFiles = fileBindings
        .filter((fb) => fb.bindings.length === 0)
        .map((fb) => fb.file);

    // Group bindings into features
    const groups = groupBindings(fileBindings.filter((fb) => fb.bindings.length > 0));

    // Determine cypress root
    const cypressRoot = options.cypressRoot || inferCypressRoot(testsRoot);

    // Resolve specs and compute coverage for each feature
    const impactedFeatures: ImpactedFeature[] = [];
    for (const group of groups.values()) {
        const binding = {family: group.familyId, feature: group.featureId};
        const specDirs = getSpecDirsForBinding(manifest, binding);
        const cypressSpecDirs = getCypressSpecDirsForBinding(manifest, binding);
        const priority = getPriorityForBinding(manifest, binding);
        const userFlows = getUserFlowsForBinding(manifest, binding);

        const pw = resolvePlaywrightSpecs(testsRoot, specDirs);
        const cy = cypressRoot ? resolveCypressSpecs(cypressRoot, cypressSpecDirs) : {paths: [], details: []};
        const coverageStatus = computeCoverageStatus(pw.paths, cy.paths);

        impactedFeatures.push({
            familyId: group.familyId,
            featureId: group.featureId,
            priority,
            changedFiles: group.files,
            playwrightSpecs: pw.paths,
            cypressSpecs: cy.paths,
            playwrightSpecDetails: pw.details,
            cypressSpecDetails: cy.details,
            userFlows,
            coverageStatus,
        });
    }

    // Sort by priority (P0 first, then P1, then P2)
    const priorityOrder: Record<FeaturePriority, number> = {P0: 0, P1: 1, P2: 2};
    impactedFeatures.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    if (unboundFiles.length > 0 && unboundFiles.length <= 5) {
        warnings.push(`${unboundFiles.length} file(s) not mapped to any route family: ${unboundFiles.join(', ')}`);
    } else if (unboundFiles.length > 5) {
        warnings.push(`${unboundFiles.length} file(s) not mapped to any route family`);
    }

    return {
        changedFiles,
        expandedFiles: options.expandedFiles || [],
        impactedFeatures,
        unboundFiles,
        warnings,
    };
}

function inferCypressRoot(testsRoot: string): string | undefined {
    // testsRoot is typically the Playwright tests directory
    // Cypress tests are at a sibling path: e2e-tests/cypress/tests/integration/channels/
    const candidate = join(testsRoot, '..', 'cypress');
    if (existsSync(candidate)) {
        return candidate;
    }
    return undefined;
}

/**
 * Get gaps: P0/P1 features with 'uncovered' status.
 */
export function getGaps(result: ImpactResult): ImpactedFeature[] {
    return result.impactedFeatures.filter(
        (f) => (f.priority === 'P0' || f.priority === 'P1') && f.coverageStatus === 'uncovered',
    );
}

/**
 * Get partial gaps: P0/P1 features with 'partial' status (advisory).
 */
export function getPartialGaps(result: ImpactResult): ImpactedFeature[] {
    return result.impactedFeatures.filter(
        (f) => (f.priority === 'P0' || f.priority === 'P1') && f.coverageStatus === 'partial',
    );
}

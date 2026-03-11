// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readdirSync} from 'fs';
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

export interface ImpactedFeature {
    familyId: string;
    featureId?: string;
    priority: FeaturePriority;
    changedFiles: string[];
    playwrightSpecs: string[];
    cypressSpecs: string[];
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

function resolvePlaywrightSpecs(testsRoot: string, specDirs: string[]): string[] {
    const specs: string[] = [];
    for (const dir of specDirs) {
        specs.push(...scanDirForSpecs(testsRoot, dir, '.spec.ts'));
    }
    return specs;
}

function resolveCypressSpecs(cypressRoot: string, specDirs: string[]): string[] {
    const specs: string[] = [];
    for (const dir of specDirs) {
        // cypressSpecDirs are relative to testsRoot (e.g. ../cypress/tests/integration/channels/search/)
        // Resolve them relative to the cypress root
        const resolvedDir = join(cypressRoot, dir.replace(/^\.\.\/cypress\//, ''));
        if (!existsSync(resolvedDir)) {
            continue;
        }
        const found = scanDirForSpecsRecursive(resolvedDir, '.js');
        const tsFound = scanDirForSpecsRecursive(resolvedDir, '.ts');
        specs.push(...found, ...tsFound);
    }
    return specs;
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

export function analyzeImpact(
    changedFiles: string[],
    options: ImpactEngineOptions,
): ImpactResult {
    const {testsRoot, routeFamilies} = options;
    const warnings: string[] = [];

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

        const playwrightSpecs = resolvePlaywrightSpecs(testsRoot, specDirs);
        const cypressSpecs = cypressRoot ? resolveCypressSpecs(cypressRoot, cypressSpecDirs) : [];
        const coverageStatus = computeCoverageStatus(playwrightSpecs, cypressSpecs);

        impactedFeatures.push({
            familyId: group.familyId,
            featureId: group.featureId,
            priority,
            changedFiles: group.files,
            playwrightSpecs,
            cypressSpecs,
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

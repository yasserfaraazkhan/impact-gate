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
    buildHeuristicFamilies,
    bindFilesToFamilies,
    getSpecDirsForBinding,
    getCypressSpecDirsForBinding,
    getPriorityForBinding,
    getUserFlowsForBinding,
} from '../knowledge/route_families.js';
import type {RouteFamiliesConfig} from '../agent/config.js';
import {isTestFile} from '../agent/git.js';

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

export type PrTestFileType = 'playwright' | 'cypress' | 'unit' | 'snapshot';

export interface PrTestFile {
    file: string;
    type: PrTestFileType;
}

export interface ImpactResult {
    changedFiles: string[];
    expandedFiles: string[];
    impactedFeatures: ImpactedFeature[];
    unboundFiles: string[];
    warnings: string[];
    /** Test files that were in the original PR changeset but filtered from analysis. */
    prIncludedTestFiles: PrTestFile[];
}

export interface ImpactEngineOptions {
    testsRoot: string;
    cypressRoot?: string;
    routeFamilies?: RouteFamiliesConfig;
    expandedFiles?: string[];
    /** Test files that were filtered by the caller (e.g. isRelevantFile in git.ts). Used to detect PR-included E2E specs. */
    filteredTestFiles?: string[];
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
    const groups = new Map<string, {familyId: string; featureId?: string; files: string[]; _seen: Set<string>}>();
    for (const fb of fileBindings) {
        for (const binding of fb.bindings) {
            const key = binding.feature || binding.family;
            const existing = groups.get(key);
            if (existing) {
                if (!existing._seen.has(fb.file)) {
                    existing._seen.add(fb.file);
                    existing.files.push(fb.file);
                }
            } else {
                groups.set(key, {
                    familyId: binding.family,
                    featureId: binding.feature,
                    files: [fb.file],
                    _seen: new Set([fb.file]),
                });
            }
        }
    }
    return groups;
}

/** Classify filtered test files by type for downstream decision-making. */
function classifyPrTestFiles(allFiles: string[], sourceFiles: string[]): PrTestFile[] {
    const sourceSet = new Set(sourceFiles);
    return allFiles
        .filter((f) => !sourceSet.has(f))
        .map((f) => {
            const n = f.replace(/\\/g, '/');
            if (/\.snap$/.test(n) || n.includes('__snapshots__/')) {
                return {file: f, type: 'snapshot' as const};
            }
            if (/\.spec\.(ts|tsx|js|jsx)$/.test(n)) {
                return {file: f, type: 'playwright' as const};
            }
            if (n.includes('/cypress/') && /\.(js|ts)$/.test(n)) {
                return {file: f, type: 'cypress' as const};
            }
            return {file: f, type: 'unit' as const};
        });
}

export function analyzeImpact(
    changedFiles: string[],
    options: ImpactEngineOptions,
): ImpactResult {
    const {testsRoot, routeFamilies} = options;
    const warnings: string[] = [];

    // Partition into source files and test files.
    // Combine: (a) test files already in changedFiles that isTestFile catches, and
    // (b) test files pre-filtered by the caller (filteredTestFiles from git.ts).
    const preFilteredTests = options.filteredTestFiles ?? [];
    const allOriginalFiles = [...new Set([...changedFiles, ...preFilteredTests])];
    changedFiles = changedFiles.filter((f) => !isTestFile(f));
    const prIncludedTestFiles = classifyPrTestFiles(allOriginalFiles, changedFiles);

    // Load manifest, fall back to heuristic families if not found
    let manifest = loadRouteFamilyManifest(testsRoot, routeFamilies);
    if (!manifest) {
        manifest = buildHeuristicFamilies(changedFiles, testsRoot);
        warnings.push(
            'Route family manifest not found. Using directory-based heuristics (lower accuracy).',
            'Tip: Run `impact-gate train` to generate a proper manifest.',
        );
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
        prIncludedTestFiles,
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

export interface GapResult {
    /** Active gaps that should be reported/enforced. */
    gaps: ImpactedFeature[];
    /** Family-level gaps suppressed because all their files are covered by specific feature matches. These should be promoted to advisory. */
    suppressedGaps: ImpactedFeature[];
}

/**
 * Get gaps: P0/P1 features with 'uncovered' status.
 *
 * Suppresses family-level (generic) gaps when ALL their changed files are
 * already covered by feature-level (specific) matches in other families.
 * Suppressed gaps are returned separately so the plan builder can promote
 * them to advisory ("new behavior detected") on covered flows.
 */
export function getGapsWithSuppressed(result: ImpactResult): GapResult {
    // Collect files that are covered via feature-level matches (more specific)
    const filesCoveredByFeatures = new Set<string>();
    for (const f of result.impactedFeatures) {
        if (f.featureId && f.coverageStatus !== 'uncovered') {
            for (const file of f.changedFiles) {
                filesCoveredByFeatures.add(file);
            }
        }
    }

    const gaps: ImpactedFeature[] = [];
    const suppressedGaps: ImpactedFeature[] = [];

    for (const f of result.impactedFeatures) {
        if (f.priority !== 'P0' && f.priority !== 'P1') continue;
        if (f.coverageStatus !== 'uncovered') continue;

        // Only suppress FAMILY-level gaps (no featureId = generic match).
        if (!f.featureId && f.changedFiles.every((file) => filesCoveredByFeatures.has(file))) {
            suppressedGaps.push(f);
        } else {
            gaps.push(f);
        }
    }

    return {gaps, suppressedGaps};
}

/**
 * Get gaps: P0/P1 features with 'uncovered' status.
 * Convenience wrapper that returns only active gaps (backward-compatible).
 */
export function getGaps(result: ImpactResult): ImpactedFeature[] {
    return getGapsWithSuppressed(result).gaps;
}

/**
 * Get partial gaps: P0/P1 features with 'partial' status (advisory).
 */
export function getPartialGaps(result: ImpactResult): ImpactedFeature[] {
    return result.impactedFeatures.filter(
        (f) => (f.priority === 'P0' || f.priority === 'P1') && f.coverageStatus === 'partial',
    );
}

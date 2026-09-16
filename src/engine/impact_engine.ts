// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {assessAdvisoryChanges, conservativeChangeReason, validateRepositoryPath, type AdvisoryAssessment, type AdvisoryConfig} from './advisory.js';
import type {GitChangeResult} from '../agent/git.js';
import {existsSync, readdirSync, readFileSync, realpathSync} from 'fs';
import {join, relative, isAbsolute} from 'path';

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
import type {RouteFamiliesConfig, TraceabilityImpactConfig} from '../agent/config.js';
import {isTestFile, runGitRaw} from '../agent/git.js';

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

export interface MappingProvenance {
    file: string;
    kind: 'declared-traceability' | 'scanner-manifest' | 'scanner-heuristic' | 'unmapped';
    tests: string[];
    origins: string[];
    evidence: 'unverified';
}

export interface ImpactResult {
    mappingProvenance?: MappingProvenance[];
    evidence?: {coverage: 'unavailable'; measuredCoverageEdges: 0};
    advisory?: AdvisoryAssessment;
    unassessedFiles?: string[];
    changedFiles: string[];
    expandedFiles: string[];
    impactedFeatures: ImpactedFeature[];
    unboundFiles: string[];
    warnings: string[];
    /** Test files that were in the original PR changeset but filtered from analysis. */
    prIncludedTestFiles: PrTestFile[];
}

export interface ImpactEngineOptions {
    sourceRoot?: string;
    traceability?: TraceabilityImpactConfig;
    advisory?: {git: GitChangeResult; config: AdvisoryConfig; suite: string};
    testsRoot: string;
    cypressRoot?: string;
    routeFamilies?: RouteFamiliesConfig;
    expandedFiles?: string[];
    /** Test files that were filtered by the caller (e.g. isRelevantFile in git.ts). Used to detect PR-included E2E specs. */
    filteredTestFiles?: string[];
}

function scanDirForSpecs(baseDir: string, specDir: string, pattern: RegExp): string[] {
    try {
        validateRepositoryPath(baseDir, specDir);
        return pattern.test(specDir) ? [specDir] : [];
    } catch { /* May be a directory rather than an exact spec. */ }
    try {
        const dir = validateRepositoryPath(baseDir, specDir.replace(/\/$/, ''), true);
        return readdirSync(dir, {withFileTypes: true}).flatMap((item) => {
            const file = [specDir.replace(/\/$/, ''), item.name].join('/');
            if (item.isDirectory()) return scanDirForSpecs(baseDir, file, pattern);
            if (!item.isFile()) return [];
            return pattern.test(file) ? [file] : [];
        }).sort();
    } catch {return [];}
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
        const found = scanDirForSpecs(testsRoot, dir, /\.spec\.[jt]sx?$/);
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
        const found = scanDirForSpecs(cypressRoot, dir.replace(/^\.\.\/cypress\//, ''), /\.[jt]s$/);
        for (const file of found) {
            const absPath = join(cypressRoot, file);
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

/** Imported relationships are declared advice: no supported input proves execution identity. */
function declaredCandidates(files: string[], options: ImpactEngineOptions, cypressRoot?: string): Map<string, {pw: string[]; cy: string[]; origins: string[]}> {
    const result = new Map<string, {pw: string[]; cy: string[]; origins: string[]}>();
    const config = options.traceability;
    if (!config?.enabled || !options.sourceRoot) return result;
    try {
        const manifestPath = isAbsolute(config.manifestPath) ? config.manifestPath : join(options.testsRoot, config.manifestPath);
        if (!existsSync(manifestPath)) return result;
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest?.schemaVersion !== '1.0.0' || !Array.isArray(manifest.tests)) return result;
        const inventoryRoot = runGitRaw(['rev-parse', '--show-toplevel'], options.testsRoot)?.trim();
        const exactSpec = (test: string, root: string, pattern: RegExp): string | undefined => {
            if (!pattern.test(test)) return undefined;
            // Only strip a repository prefix established from this inventory checkout.
            const prefix = inventoryRoot ? relative(realpathSync(inventoryRoot), realpathSync(root)).replace(/\\/g, '/') : '';
            const local = prefix && !prefix.startsWith('..') && test.startsWith(`${prefix}/`) ? test.slice(prefix.length + 1) : test;
            try {validateRepositoryPath(root, local); return local;} catch {return undefined;}
        };
        for (const row of manifest.tests) {
            if (!row || typeof row.test !== 'string' || !Array.isArray(row.touchedFiles) || typeof row.lastSeen !== 'string' || !Number.isFinite(row.signalCount) || row.signalCount <= 0 || row.signalCount < config.minSignalsPerTest) continue;
            // Match ingest's ISO calendar validation; parseability alone accepts June 31.
            const date = row.lastSeen.match(/^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/);
            const timestamp = Date.parse(row.lastSeen);
            if (!date || !Number.isFinite(timestamp) || new Date(date[1]).toISOString().slice(0, 10) !== date[1]) continue;
            const age = Date.now() - timestamp;
            if (!Number.isFinite(age) || age < 0 || age > 120 * 86400000) continue;
            const test = row.test.replace(/\\/g, '/');
            const pw = exactSpec(test, options.testsRoot, /\.spec\.[jt]sx?$/);
            const cy = cypressRoot ? exactSpec(test, cypressRoot, /(?:\.cy|_spec)\.[jt]s$/) : undefined;
            if (!pw && !cy) continue;
            const origins: string[] = Array.isArray(row.origins) && row.origins.every((o: unknown) => typeof o === 'string') && row.origins.length ? row.origins : ['legacy-import'];
            for (const raw of row.touchedFiles) {
                if (typeof raw !== 'string') continue;
                const file = raw.replace(/\\/g, '/');
                if (!files.includes(file)) continue;
                try {validateRepositoryPath(options.sourceRoot, file);} catch {continue;}
                const entry = result.get(file) || {pw: [], cy: [], origins: []};
                if (pw && !entry.pw.includes(pw)) entry.pw.push(pw);
                if (cy && !entry.cy.includes(cy)) entry.cy.push(cy);
                entry.origins = [...new Set([...entry.origins, ...origins])].sort();
                result.set(file, entry);
            }
        }
    } catch { /* Malformed input is unavailable, never measured. */ }
    return result;
}

export function analyzeImpact(
    changedFiles: string[],
    options: ImpactEngineOptions,
): ImpactResult {
    if (options.advisory) {
        const {git, config, suite} = options.advisory;
        const advisory = assessAdvisoryChanges(git, config, suite);
        return {changedFiles: git.files, expandedFiles: [], impactedFeatures: [],
            unboundFiles: advisory.fileAssessments.filter((f) => f.status === 'unmapped').map((f) => f.file),
            unassessedFiles: advisory.fileAssessments.filter((f) => f.status !== 'mapped').map((f) => f.file),
            warnings: advisory.fullSuiteFallbackReasons, prIncludedTestFiles: classifyPrTestFiles(git.files, git.files.filter((f) => !isTestFile(f))), advisory};
    }
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

    const cypressRoot = options.cypressRoot || inferCypressRoot(testsRoot);
    const declared = declaredCandidates(allFiles, options, cypressRoot);

    // Bind files to families
    const fileBindings = bindFilesToFamilies(allFiles.filter((f) => !declared.has(f)), manifest);

    // Find unbound files
    const unboundFiles = fileBindings
        .filter((fb) => fb.bindings.length === 0)
        .map((fb) => fb.file);

    // Group bindings into features
    const groups = groupBindings(fileBindings.filter((fb) => fb.bindings.length > 0));

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

    for (const [file, candidates] of declared) {
        const pw = resolvePlaywrightSpecs(testsRoot, candidates.pw);
        const cy = cypressRoot ? resolveCypressSpecs(cypressRoot, candidates.cy) : {paths: [], details: []};
        impactedFeatures.push({familyId: file, priority: 'P1', changedFiles: [file], playwrightSpecs: pw.paths, cypressSpecs: cy.paths,
            playwrightSpecDetails: pw.details, cypressSpecDetails: cy.details, userFlows: [], coverageStatus: computeCoverageStatus(pw.paths, cy.paths)});
    }
    const mappingProvenance: MappingProvenance[] = allFiles.map((file) => {
        const features = impactedFeatures.filter((f) => f.changedFiles.includes(file));
        return {file, kind: declared.has(file) ? 'declared-traceability' : features.length ? manifest.source === 'heuristic' ? 'scanner-heuristic' : 'scanner-manifest' : 'unmapped',
            tests: [...new Set(features.flatMap((f) => [...f.playwrightSpecs, ...f.cypressSpecs]))], origins: declared.get(file)?.origins || (features.length ? [manifest.source] : []), evidence: 'unverified'};
    });

    // Sort by priority (P0 first, then P1, then P2)
    const priorityOrder: Record<FeaturePriority, number> = {P0: 0, P1: 1, P2: 2};
    impactedFeatures.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    if (unboundFiles.length > 0 && unboundFiles.length <= 5) {
        warnings.push(`${unboundFiles.length} file(s) not mapped to any route family: ${unboundFiles.join(', ')}`);
    } else if (unboundFiles.length > 5) {
        warnings.push(`${unboundFiles.length} file(s) not mapped to any route family`);
    }

    return {
        mappingProvenance,
        evidence: {coverage: 'unavailable', measuredCoverageEdges: 0},
        changedFiles: allOriginalFiles,
        unassessedFiles: [...new Set([...allOriginalFiles, ...declared.keys()])].filter((f) => conservativeChangeReason(f) || unboundFiles.includes(f) || declared.has(f) || manifest.source === 'heuristic'),
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

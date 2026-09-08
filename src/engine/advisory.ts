// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createHash} from 'node:crypto';
import {readFileSync, realpathSync, statSync} from 'node:fs';
import {isAbsolute, relative, resolve} from 'node:path';
import {minimatch} from 'minimatch';
import {CypressAdapter} from '../adapters/cypress.js';
import {PlaywrightAdapter} from '../adapters/playwright.js';
import {isRelevantFile, isTestFile, runGitRaw, type GitChangeResult} from '../agent/git.js';

export type MappingKind = 'human-reviewed-manifest' | 'static-dependency-inference' | 'co-change-heuristic';
export interface AdvisorySuite {
    id: string;
    framework: 'playwright' | 'cypress';
    root: string;
    configFile: string;
    project: string;
    browser: string;
    variant: string;
    specPattern: string;
    exclude?: string[];
}
export interface AdvisoryMapping {
    sourcePattern: string;
    suite: string;
    specs: string[];
    provenance: {kind: MappingKind; evidence: string};
}
export interface AdvisoryConfig {
    repository: string;
    sourcePatterns: string[];
    crossCuttingPatterns: string[];
    suites: AdvisorySuite[];
    mappings: AdvisoryMapping[];
}
export interface AdvisoryAssessment {
    mode: 'advisory';
    repository: string;
    baseSha: string;
    requestedBaseSha: string;
    headSha: string;
    changedFiles: string[];
    changedFilesSha256: string;
    configurationSha256: string;
    suite: AdvisorySuite & {configSha256: string};
    fileAssessments: Array<{file: string; status: 'mapped' | 'unmapped' | 'unsupported' | 'cross-cutting'; reason: string}>;
    mappings: Array<AdvisoryMapping & {file: string}>;
    inventory: string[];
    inventoryStatus: 'static-spec-files';
    selectedSpecs: string[];
    fullSuiteFallbackReasons: string[];
    diffStatus: 'empty' | 'changed';
    executionPolicy: 'retain-full-suite';
    evidence: {coverage: 'unavailable'; execution: 'unavailable'; release: 'not-assessed'; specPresence: 'verified' | 'unavailable'; measuredCoverageEdges: 0};
}
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Paths are repository-relative POSIX paths, not globs or executable configuration. */
export function validateRepositoryPath(root: string, file: string, directory = false): string {
    if (!file || isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.includes('\\') || file.includes('\0') || file.split('/').some((p) => p === '..' || p === '.' || p === '')) {
        throw new Error(`Invalid repository-relative path: ${file}`);
    }
    const checkout = realpathSync(root);
    const candidate = realpathSync(resolve(checkout, file));
    const rel = relative(checkout, candidate);
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`Path escapes checkout: ${file}`);
    if (directory ? !statSync(candidate).isDirectory() : !statSync(candidate).isFile()) throw new Error(`Invalid ${directory ? 'directory' : 'file'}: ${file}`);
    return candidate;
}

function validatePattern(pattern: string): void {
    if (typeof pattern !== 'string' || !pattern || pattern.length > 1024 || isAbsolute(pattern) || /^[A-Za-z]:/.test(pattern) || pattern.includes('\\') || pattern.includes('\0') || pattern.split('/').includes('..')) {
        throw new Error(`Invalid relative pattern: ${pattern}`);
    }
}
export function validateAdvisoryConfig(value: unknown): AdvisoryConfig {
    if (!value || typeof value !== 'object') throw new Error('Advisory configuration is required.');
    const c = value as AdvisoryConfig;
    if (typeof c.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(c.repository) || !Array.isArray(c.suites) || !c.suites.length || !Array.isArray(c.mappings) || !Array.isArray(c.sourcePatterns) || !Array.isArray(c.crossCuttingPatterns)) throw new Error('Invalid advisory configuration.');
    [...c.sourcePatterns, ...c.crossCuttingPatterns].forEach(validatePattern);
    const ids = new Set<string>();
    for (const suite of c.suites) {
        if (!suite || !['playwright', 'cypress'].includes(suite.framework) || ['id', 'root', 'configFile', 'project', 'browser', 'variant'].some((key) => typeof suite[key as keyof AdvisorySuite] !== 'string' || !suite[key as keyof AdvisorySuite]) || ids.has(suite.id)) throw new Error('Invalid or duplicate advisory suite identity.');
        ids.add(suite.id);
        validatePattern(suite.specPattern);
        if (suite.exclude !== undefined && !Array.isArray(suite.exclude)) throw new Error('Invalid suite exclusions.');
        (suite.exclude ?? []).forEach(validatePattern);
    }
    for (const mapping of c.mappings) {
        if (!mapping || !ids.has(mapping.suite) || !Array.isArray(mapping.specs) || !mapping.specs.length || !mapping.provenance || !['human-reviewed-manifest', 'static-dependency-inference', 'co-change-heuristic'].includes(mapping.provenance.kind) || typeof mapping.provenance.evidence !== 'string' || !mapping.provenance.evidence.trim()) throw new Error('Each mapping requires a known suite, exact specs and mapping provenance.');
        validatePattern(mapping.sourcePattern);
    }
    return c;
}

export function conservativeChangeReason(file: string): string | undefined {
    if (file.startsWith('.github/')) return 'CI/workflow change';
    if (file.startsWith('e2e-tests/') || isTestFile(file)) return 'E2E/test infrastructure change';
    if (/(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|go\.(mod|sum)|Cargo\.(toml|lock)|requirements[^/]*\.txt)$/.test(file)) return 'Dependency change';
    if (/(^|\/)(scripts|config|build)\//.test(file) || /(^|\/)(Makefile|Dockerfile[^/]*|config\.mk|\.[^/]+)$/.test(file) || /(^|\/)[^/]*[.-]config\.[^/]+$/.test(file) || /\.(ya?ml|sh)$/.test(file)) return 'Configuration/build change';
    if (!isRelevantFile(file)) return 'Unsupported change';
    return undefined;
}

export function assessAdvisoryChanges(git: GitChangeResult, config: AdvisoryConfig, suiteId: string): AdvisoryAssessment {
    if (git.error) throw new Error(git.error);
    if (!git.repositoryRoot || !git.headSha || !git.baseRef || !git.requestedBaseSha) throw new Error('Advisory planning requires resolved Git identity.');
    const root = git.repositoryRoot;
    // Bind path presence/configuration to the reported commit, never a dirty worktree.
    const status = runGitRaw(['status', '--porcelain', '--untracked-files=no'], root);
    if (status === null || status !== '') throw new Error('Advisory planning requires a clean tracked checkout.');
    const c = validateAdvisoryConfig(config);
    const origin = runGitRaw(['remote', 'get-url', 'origin'], root)?.trim();
    const repository = origin?.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
    if (repository !== c.repository) throw new Error('Configured repository does not match checkout origin.');
    const suite = c.suites.find((s) => s.id === suiteId);
    if (!suite) throw new Error(`Unknown advisory suite: ${suiteId}`);
    const suiteRoot = validateRepositoryPath(root, suite.root, true);
    const configPath = validateRepositoryPath(root, suite.configFile);
    const adapter = suite.framework === 'cypress' ? new CypressAdapter() : new PlaywrightAdapter();
    const isSpec = (file: string): boolean => {
        const local = relative(suiteRoot, resolve(root, file)).split('\\').join('/');
        return !local.startsWith('../') && minimatch(local, adapter.specGlob) && minimatch(local, suite.specPattern) && !(suite.exclude ?? []).some((p) => minimatch(local, p));
    };
    // Enumerate the committed tree, so absent/sparse/skip-worktree specs cannot
    // silently shrink a full-suite recommendation. Read source/config as data only.
    if (runGitRaw(['rev-parse', 'HEAD'], root)?.trim() !== git.headSha) throw new Error('Checkout HEAD changed during planning.');
    const tree = runGitRaw(['ls-tree', '-r', '-z', git.headSha], root);
    if (tree === null) throw new Error('Cannot read committed spec inventory.');
    const entries = new Map(tree.split('\0').filter(Boolean).map((entry) => {
        const tab = entry.indexOf('\t');
        const [mode, , blob] = entry.slice(0, tab).split(' ');
        return [entry.slice(tab + 1), {mode, blob}];
    }));
    const verifyCommittedFile = (file: string): void => {
        const entry = entries.get(file);
        if (!entry || !['100644', '100755'].includes(entry.mode)) throw new Error(`Expected a regular file committed at HEAD: ${file}`);
        const bytes = readFileSync(validateRepositoryPath(root, file));
        const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (blob !== entry.blob) throw new Error(`File differs from reported HEAD: ${file}`);
    };
    verifyCommittedFile(suite.configFile);
    const inventory = [...entries.keys()].filter(isSpec).sort();
    for (const file of inventory) verifyCommittedFile(file);
    const known = new Set(inventory);
    const suiteMappings = c.mappings.filter((m) => m.suite === suiteId);
    for (const mapping of suiteMappings) {
        for (const spec of mapping.specs) {
            validateRepositoryPath(root, spec);
            if (!known.has(spec)) throw new Error(`Mapped spec is outside the configured suite inventory: ${spec}`);
        }
    }
    const selected = new Set<string>();
    const mappings: AdvisoryAssessment['mappings'] = [];
    const fileAssessments: AdvisoryAssessment['fileAssessments'] = git.files.map((file) => {
        const conservative = conservativeChangeReason(file) || (c.crossCuttingPatterns.some((p) => minimatch(file, p)) ? 'Configured cross-cutting change' : undefined);
        if (conservative) return {file, status: conservative === 'Unsupported change' ? 'unsupported' : 'cross-cutting', reason: conservative};
        if (!c.sourcePatterns.some((p) => minimatch(file, p))) return {file, status: 'unsupported', reason: 'Outside configured product source layout'};
        const matches = suiteMappings.filter((m) => minimatch(file, m.sourcePattern));
        for (const m of matches) { mappings.push({...m, file}); m.specs.forEach((s) => selected.add(s)); }
        if (!matches.some((m) => m.provenance.kind === 'human-reviewed-manifest')) return {file, status: 'unmapped', reason: matches.length ? 'Only heuristic mapping evidence; behavior coverage unknown' : 'No reviewed mapping for this suite/project'};
        return {file, status: 'mapped', reason: 'Human-reviewed mapping; spec presence does not prove behavior coverage'};
    });
    const reasons = fileAssessments.filter((f) => f.status !== 'mapped').map((f) => `${f.file}: ${f.reason}`);
    if (!inventory.length) reasons.push('Configured suite has no existing spec files; inventory unavailable');
    return {
        mode: 'advisory', repository: c.repository, baseSha: git.baseRef, requestedBaseSha: git.requestedBaseSha, headSha: git.headSha,
        changedFiles: git.files, changedFilesSha256: hash(JSON.stringify(git.files)), configurationSha256: hash(JSON.stringify(c)),
        suite: {...suite, configSha256: hash(readFileSync(configPath, 'utf8'))}, fileAssessments, mappings,
        inventory, inventoryStatus: 'static-spec-files', selectedSpecs: reasons.length ? inventory : [...selected].sort(),
        fullSuiteFallbackReasons: reasons, diffStatus: git.files.length ? 'changed' : 'empty', executionPolicy: 'retain-full-suite',
        evidence: {coverage: 'unavailable', execution: 'unavailable', release: 'not-assessed', specPresence: inventory.length ? 'verified' : 'unavailable', measuredCoverageEdges: 0},
    };
}

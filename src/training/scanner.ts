// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {readdirSync, readFileSync, lstatSync, existsSync} from 'fs';
import {join, relative, basename, resolve} from 'path';

import type {DiscoveredDir, ScannedFamily, ScannedFeature, ScanResult} from './types.js';

const SOURCE_MAX_DEPTH = 3;
// One deeper than source to account for test framework wrapper dirs (e2e/, integration/)
const TEST_MAX_DEPTH = 5;
const SPEC_FILES_MAX_DEPTH = 10;

const SOURCE_ROOTS = ['src', 'app', 'pages', 'components', 'features', 'modules'] as const;
const SERVER_ROOTS = ['server', 'api', 'cmd', 'model', 'services'] as const;
const SKIP_DIRS = new Set([
    'node_modules', '.git', '.next', '.nuxt', 'dist', 'build',
    'coverage', '__pycache__', '.e2e-ai-agents', '.cache',
    'vendor', 'third_party',
]);
const TEST_EXTENSIONS = ['.spec.ts', '.test.ts', '.spec.js', '.test.js', '.spec.tsx', '.test.tsx'] as const;
const GO_TEST_SUFFIX = '_test.go';

/**
 * Test category directories that organize tests but aren't feature families.
 * Test-only families matching these names are excluded.
 */
const TEST_CATEGORY_DIRS = new Set([
    'specs', 'spec', 'accessibility', 'visual', 'smoke', 'regression',
    'integration', 'functional', 'unit', 'e2e', 'performance', 'load',
]);

/**
 * Structural directories that are code-organization concerns, not feature families.
 * Discovered source dirs matching these names are excluded from family creation.
 */
const STRUCTURAL_DIRS = new Set([
    'actions', 'client', 'components', 'hooks', 'i18n', 'packages',
    'reducers', 'selectors', 'store', 'stores', 'tests', 'types',
    'utils', 'helpers', 'lib', 'common', 'shared', 'constants',
    'config', 'styles', 'sass', 'css', 'assets', 'images', 'fonts',
    'middleware', 'contexts', 'providers', 'layouts', 'templates',
]);

/**
 * Server Go files that are infrastructure / cross-cutting concerns,
 * not feature-specific domains.  Matched after stripping _local/_store suffixes.
 */
const SERVER_INFRA_FILES = new Set([
    'api', 'apitestlib', 'context', 'helpers', 'params', 'swagger',
    'app', 'server', 'enterprise', 'product_service', 'security_update_check',
    'store', 'adapters', 'errors', 'integrity', 'migrate', 'doc',
    'main', 'init', 'cluster_discovery', 'web_conn', 'web_broadcast_hooks',
    'manualtesting', 'testlib', 'router', 'handler', 'opentracing',
    'platform', 'focalboard', 'playbooks', 'client4', 'model',
    'manifest', 'permission', 'log', 'utils',
]);

/**
 * Server tier directories to scan for Go domain files.
 * Each tier represents a layer of the backend architecture.
 */
const SERVER_TIERS = [
    'channels/api4',
    'channels/app',
    'channels/store/sqlstore',
    'channels/web',
    'channels/wsapi',
    'public/model',
] as const;

/** Type-safe includes check for readonly arrays */
const includes = <T>(arr: readonly T[], v: unknown): v is T => (arr as readonly unknown[]).includes(v);

function isSkipped(name: string): boolean {
    return name.startsWith('.') || SKIP_DIRS.has(name);
}

function normalizeId(name: string): string {
    return name
        .replace(/[A-Z]/g, (c, idx) => (idx > 0 ? `_${c.toLowerCase()}` : c.toLowerCase()))
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

function extractFamilyHint(dirPath: string, projectRoot: string): string {
    const rel = relative(projectRoot, dirPath).replace(/\\/g, '/');
    const parts = rel.split('/').filter(Boolean);
    // Skip the root category dir (src/, server/, tests/, etc.)
    // Return the first meaningful subdirectory name
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (!isSkipped(part) && part !== 'e2e' && part !== 'integration' && part !== 'functional') {
            return normalizeId(part);
        }
    }
    return normalizeId(parts[parts.length - 1] || basename(dirPath));
}

function walkDirs(
    root: string,
    projectRoot: string,
    category: 'webapp' | 'server',
    maxDepth: number,
    results: DiscoveredDir[],
    depth = 0,
): void {
    if (depth > maxDepth || !existsSync(root)) {
        return;
    }
    let entries: string[];
    try {
        entries = readdirSync(root);
    } catch {
        // ENOENT or EACCES — skip inaccessible entries
        return;
    }

    const hasSourceFiles = entries.some((e) => {
        const ext = e.slice(e.lastIndexOf('.'));
        return ['.ts', '.tsx', '.js', '.jsx', '.go', '.py', '.rs'].includes(ext);
    });

    const subdirs = entries.filter((e) => {
        if (isSkipped(e)) return false;
        try {
            const stat = lstatSync(join(root, e));
            if (stat.isSymbolicLink()) return false;
            return stat.isDirectory();
        } catch {
            // ENOENT or EACCES — skip inaccessible entries
            return false;
        }
    });

    if (hasSourceFiles && depth >= 1) {
        results.push({
            path: resolve(root),
            relativePath: relative(projectRoot, root).replace(/\\/g, '/'),
            category,
            familyHint: extractFamilyHint(root, projectRoot),
        });
    }

    for (const sub of subdirs) {
        walkDirs(join(root, sub), projectRoot, category, maxDepth, results, depth + 1);
    }
}

export function discoverSourceDirs(projectRoot: string): DiscoveredDir[] {
    const results: DiscoveredDir[] = [];
    const resolved = resolve(projectRoot);

    let entries: string[];
    try {
        entries = readdirSync(resolved);
    } catch {
        // ENOENT or EACCES — skip inaccessible entries
        return results;
    }

    for (const entry of entries) {
        if (isSkipped(entry)) continue;
        const fullPath = join(resolved, entry);
        try {
            const stat = lstatSync(fullPath);
            if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
        } catch {
            // ENOENT or EACCES — skip inaccessible entries
            continue;
        }

        if (includes(SOURCE_ROOTS, entry)) {
            walkDirs(fullPath, resolved, 'webapp', SOURCE_MAX_DEPTH, results);
        } else if (includes(SERVER_ROOTS, entry)) {
            walkDirs(fullPath, resolved, 'server', SOURCE_MAX_DEPTH, results);
        }
    }

    return results;
}

export function discoverTestDirs(projectRoot: string): DiscoveredDir[] {
    const results: DiscoveredDir[] = [];
    const resolved = resolve(projectRoot);

    function walk(dir: string, category: 'test' | 'cypress', depth: number): void {
        if (depth > TEST_MAX_DEPTH || !existsSync(dir)) return;
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            // ENOENT or EACCES — skip inaccessible entries
            return;
        }

        const hasTests = entries.some((e) => {
            return TEST_EXTENSIONS.some((ext) => e.endsWith(ext)) || e.endsWith(GO_TEST_SUFFIX);
        });

        if (hasTests) {
            results.push({
                path: resolve(dir),
                relativePath: relative(resolved, dir).replace(/\\/g, '/'),
                category,
                familyHint: extractFamilyHint(dir, resolved),
            });
        }

        for (const entry of entries) {
            if (isSkipped(entry)) continue;
            const full = join(dir, entry);
            try {
                const stat = lstatSync(full);
                if (stat.isSymbolicLink()) continue;
                if (stat.isDirectory()) {
                    walk(full, category, depth + 1);
                }
            } catch {
                // ENOENT or EACCES — skip inaccessible entries
            }
        }
    }

    const testRoots = ['tests', 'test', 'e2e-tests', 'e2e', 'specs', 'spec'];
    const cypressRoots = ['cypress/e2e', 'cypress/integration'];

    for (const root of testRoots) {
        walk(join(resolved, root), 'test', 0);
    }
    for (const root of cypressRoots) {
        walk(join(resolved, root), 'cypress', 0);
    }

    // Also scan server dirs for Go test files
    for (const root of SERVER_ROOTS) {
        const serverPath = join(resolved, root);
        if (existsSync(serverPath)) {
            walk(serverPath, 'test', 0);
        }
    }

    return results;
}

function extractTags(specFiles: string[]): string[] {
    const tags = new Set<string>();
    for (const file of specFiles) {
        try {
            const content = readFileSync(file, 'utf-8');
            const matches = content.match(/@[a-zA-Z][a-zA-Z0-9_-]*/g);
            if (matches) {
                for (const m of matches) {
                    if (!m.startsWith('@playwright') && !m.startsWith('@param') && !m.startsWith('@returns')) {
                        tags.add(m);
                    }
                }
            }
        } catch {
            // ENOENT or EACCES — skip unreadable files
        }
    }
    return Array.from(tags);
}

function getSpecFiles(dir: string, depth = 0): string[] {
    if (depth > SPEC_FILES_MAX_DEPTH) return [];
    const files: string[] = [];
    try {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            try {
                const stat = lstatSync(full);
                if (stat.isSymbolicLink()) continue;
                if (stat.isDirectory()) {
                    files.push(...getSpecFiles(full, depth + 1));
                } else if (TEST_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
                    files.push(full);
                }
            } catch {
                // ENOENT or EACCES — skip inaccessible entries
            }
        }
    } catch {
        // ENOENT or EACCES — skip inaccessible directories
    }
    return files;
}

function buildGlobPattern(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/');
    return `${normalized}/*`;
}

interface DirGroup {
    webapp: DiscoveredDir[];
    server: DiscoveredDir[];
    test: DiscoveredDir[];
    cypress: DiscoveredDir[];
}

function groupByFamily(dirs: DiscoveredDir[]): Map<string, DirGroup> {
    const groups = new Map<string, DirGroup>();
    for (const dir of dirs) {
        const key = normalizeId(dir.familyHint);
        if (!groups.has(key)) {
            groups.set(key, {webapp: [], server: [], test: [], cypress: []});
        }
        const group = groups.get(key)!;
        if (dir.category === 'webapp') group.webapp.push(dir);
        else if (dir.category === 'server') group.server.push(dir);
        else if (dir.category === 'cypress') group.cypress.push(dir);
        else group.test.push(dir);
    }
    return groups;
}

function detectFeatures(
    familyId: string,
    group: DirGroup,
    projectRoot: string,
): ScannedFeature[] {
    const features: ScannedFeature[] = [];

    const webappSubdirs = new Map<string, DiscoveredDir[]>();
    for (const dir of group.webapp) {
        try {
            for (const entry of readdirSync(dir.path)) {
                if (isSkipped(entry)) continue;
                const full = join(dir.path, entry);
                try {
                    const stat = lstatSync(full);
                    if (stat.isSymbolicLink()) continue;
                    if (stat.isDirectory()) {
                        const hint = normalizeId(entry);
                        if (!webappSubdirs.has(hint)) webappSubdirs.set(hint, []);
                        webappSubdirs.get(hint)!.push({
                            path: full,
                            relativePath: relative(projectRoot, full).replace(/\\/g, '/'),
                            category: 'webapp',
                            familyHint: entry,
                        });
                    }
                } catch {
                    // ENOENT or EACCES — skip inaccessible entries
                }
            }
        } catch {
            // ENOENT or EACCES — skip inaccessible directories
        }
    }

    for (const testDir of group.test) {
        try {
            for (const entry of readdirSync(testDir.path)) {
                if (isSkipped(entry)) continue;
                const full = join(testDir.path, entry);
                try {
                    const stat = lstatSync(full);
                    if (stat.isSymbolicLink()) continue;
                    if (!stat.isDirectory()) continue;
                } catch {
                    // ENOENT or EACCES — skip inaccessible entries
                    continue;
                }
                const hint = normalizeId(entry);
                if (webappSubdirs.has(hint)) {
                    const webDirs = webappSubdirs.get(hint)!;
                    features.push({
                        id: `${familyId}/${hint}`,
                        webappPaths: webDirs.map((d) => buildGlobPattern(d.relativePath)),
                        serverPaths: [],
                        specDirs: [relative(projectRoot, full).replace(/\\/g, '/') + '/'],
                    });
                }
            }
        } catch {
            // ENOENT or EACCES — skip inaccessible directories
        }
    }

    return features;
}

/**
 * Discover families by walking the test directory tree at depth ≥ 2.
 *
 * This is the primary family discovery mechanism for projects where source
 * code is organized by code type (components/, actions/) but tests are
 * organized by feature (channels/drafts/, channels/search/).
 *
 * Each leaf test directory (containing spec files) at meaningful depth ≥ 2
 * becomes a candidate family.  Top-level feature dirs (depth 1) are already
 * discovered by the standard `discoverTestDirs` + `groupByFamily` pipeline.
 */
/**
 * Normalize a Go filename into a family domain identifier.
 * Strips _local, _store, trailing 's' (plurals), and normalizes casing.
 */
function normalizeServerDomain(baseName: string): string | null {
    let name = baseName;
    // Strip common suffixes
    name = name.replace(/_local$/, '');
    name = name.replace(/_store$/, '');
    // Skip very short names (e.g., single-letter files)
    if (name.length < 3) return null;
    return normalizeId(name);
}

/**
 * Given a domain name like "channel_bookmark", find its parent domain
 * if a shorter prefix exists in the set (e.g., "channel").
 * This groups related server files under a single family.
 */
function findParentDomain(name: string, allDomains: Set<string>): string {
    const parts = name.split('_');
    // Try progressively shorter prefixes
    for (let i = parts.length - 1; i >= 1; i--) {
        const candidate = parts.slice(0, i).join('_');
        if (allDomains.has(candidate) && candidate !== name) {
            return candidate;
        }
    }
    return name;
}

/**
 * Discover families by scanning server Go source files.
 *
 * The backend follows a three-tier pattern:
 *   api4/draft.go + app/draft.go + store/sqlstore/draft_store.go
 *
 * Related files are grouped under parent domains:
 *   channel.go, channel_bookmark.go, channel_category.go → "channel" family
 *
 * Each domain becomes a candidate family with precise serverPaths.
 */
export function discoverServerDerivedFamilies(serverRoot: string): {multiTierFamilies: ScannedFamily[]; singleTierFamilies: ScannedFamily[]} {
    const resolved = resolve(serverRoot);

    // First pass: collect all raw domain names across tiers
    const allRawDomains = new Set<string>();
    // domain → tier → Set<file basenames>
    const domainTierFiles = new Map<string, Map<string, Set<string>>>();

    function collectGoFile(entry: string, tierRelPath: string): void {
        if (!entry.endsWith('.go') || entry.endsWith('_test.go') || entry.startsWith('.')) return;

        const baseName = entry.replace('.go', '');
        const domain = normalizeServerDomain(baseName);
        if (!domain || SERVER_INFRA_FILES.has(domain)) return;

        allRawDomains.add(domain);
        if (!domainTierFiles.has(domain)) domainTierFiles.set(domain, new Map());
        const tierMap = domainTierFiles.get(domain)!;
        if (!tierMap.has(tierRelPath)) tierMap.set(tierRelPath, new Set());
        tierMap.get(tierRelPath)!.add(baseName);
    }

    for (const tier of SERVER_TIERS) {
        const tierPath = join(resolved, tier);
        if (!existsSync(tierPath)) continue;

        let entries: string[];
        try { entries = readdirSync(tierPath); } catch { continue; }

        for (const entry of entries) {
            collectGoFile(entry, tier);

            // Also check subdirectories (e.g., app/slashcommands/, app/users/)
            const subPath = join(tierPath, entry);
            try {
                const stat = lstatSync(subPath);
                if (stat.isDirectory() && !isSkipped(entry)) {
                    const subEntries = readdirSync(subPath);
                    for (const subEntry of subEntries) {
                        collectGoFile(subEntry, `${tier}/${entry}`);
                    }
                }
            } catch { /* skip */ }
        }
    }

    // Scan job directories — each subdirectory is a job type
    const jobsPath = join(resolved, 'channels/jobs');
    if (existsSync(jobsPath)) {
        try {
            for (const entry of readdirSync(jobsPath)) {
                const jobPath = join(jobsPath, entry);
                try {
                    if (!lstatSync(jobPath).isDirectory() || isSkipped(entry)) continue;
                    const domain = normalizeId(entry);
                    if (SERVER_INFRA_FILES.has(domain)) continue;

                    allRawDomains.add(domain);
                    const jobFiles = readdirSync(jobPath);
                    for (const jf of jobFiles) {
                        if (jf.endsWith('.go') && !jf.endsWith('_test.go')) {
                            if (!domainTierFiles.has(domain)) domainTierFiles.set(domain, new Map());
                            const tierMap = domainTierFiles.get(domain)!;
                            const tierKey = `channels/jobs/${entry}`;
                            if (!tierMap.has(tierKey)) tierMap.set(tierKey, new Set());
                            tierMap.get(tierKey)!.add(jf.replace('.go', ''));
                        }
                    }
                } catch { /* skip */ }
            }
        } catch { /* skip */ }
    }

    // Second pass: group child domains under parents
    // e.g., channel_bookmark → channel, post_priority → post
    // Track which top-level tiers each family touches for significance filtering.
    const familyPaths = new Map<string, Set<string>>();
    const familyTiers = new Map<string, Set<string>>();

    for (const [domain, tierMap] of domainTierFiles) {
        const parentDomain = findParentDomain(domain, allRawDomains);

        if (!familyPaths.has(parentDomain)) familyPaths.set(parentDomain, new Set());
        if (!familyTiers.has(parentDomain)) familyTiers.set(parentDomain, new Set());
        const paths = familyPaths.get(parentDomain)!;
        const tiers = familyTiers.get(parentDomain)!;

        for (const [tierRelPath, fileNames] of tierMap) {
            // Track the top-level tier (e.g., "channels/api4" from "channels/api4/slashcommands")
            const topTier = tierRelPath.split('/').slice(0, 2).join('/');
            tiers.add(topTier);

            for (const baseName of fileNames) {
                // Use directory-level glob to capture the file and related variants
                paths.add(`server/${tierRelPath}/${baseName}*.go`);
            }
        }
    }

    // Build families from grouped domains.
    // Multi-tier families (≥2 tiers) can be new families.
    // Single-tier families can only merge into existing families.
    const multiTierFamilies: ScannedFamily[] = [];
    const singleTierFamilies: ScannedFamily[] = [];
    for (const [domain, paths] of familyPaths) {
        if (paths.size === 0) continue;

        const tierCount = familyTiers.get(domain)?.size ?? 0;
        const family: ScannedFamily = {
            id: domain,
            routes: [`/${domain.replace(/_/g, '-')}`],
            webappPaths: [],
            serverPaths: Array.from(paths),
            specDirs: [],
            cypressSpecDirs: [],
            tags: [],
            features: [],
            routesGuessed: true,
        };

        if (tierCount >= 2) {
            multiTierFamilies.push(family);
        } else {
            singleTierFamilies.push(family);
        }
    }

    return {multiTierFamilies, singleTierFamilies};
}

export function discoverTestDerivedFamilies(testsRoot: string): ScannedFamily[] {
    const resolved = resolve(testsRoot);

    interface Candidate {
        dir: string;
        relPath: string;
        leafId: string;
        parentId: string | null;
    }
    const candidates: Candidate[] = [];

    function walk(dir: string, depth: number): void {
        if (depth > 8) return;

        let entries: string[];
        try { entries = readdirSync(dir); } catch { return; }

        const hasSpecs = entries.some((e) =>
            TEST_EXTENSIONS.some((ext) => e.endsWith(ext)) || e.endsWith(GO_TEST_SUFFIX),
        );

        const subdirs = entries.filter((e) => {
            if (isSkipped(e)) return false;
            try {
                const stat = lstatSync(join(dir, e));
                return !stat.isSymbolicLink() && stat.isDirectory();
            } catch { return false; }
        });

        const relPath = relative(resolved, dir).replace(/\\/g, '/');
        const parts = relPath.split('/').filter(Boolean);
        const meaningful = parts.filter(
            (p) => !TEST_CATEGORY_DIRS.has(normalizeId(p)) && !isSkipped(p),
        );

        // Depth-2+ meaningful dirs with spec files → candidate families
        if (meaningful.length >= 2 && hasSpecs) {
            const leafId = normalizeId(meaningful[meaningful.length - 1]);
            const parentId = normalizeId(meaningful[meaningful.length - 2]);

            if (!STRUCTURAL_DIRS.has(leafId) && !TEST_CATEGORY_DIRS.has(leafId)) {
                candidates.push({dir, relPath, leafId, parentId});
            }
        }

        for (const sub of subdirs) {
            walk(join(dir, sub), depth + 1);
        }
    }

    // Walk from standard test roots
    const testRoots = ['tests', 'test', 'e2e-tests', 'e2e', 'specs', 'spec'];
    for (const root of testRoots) {
        const rootPath = join(resolved, root);
        if (existsSync(rootPath)) {
            walk(rootPath, 0);
        }
    }

    // Detect leaf-name collisions across parents
    const idCount = new Map<string, number>();
    for (const c of candidates) {
        idCount.set(c.leafId, (idCount.get(c.leafId) || 0) + 1);
    }

    // Build families — prefix with parent when names collide
    const familyMap = new Map<string, ScannedFamily>();
    for (const c of candidates) {
        let familyId = c.leafId;
        if ((idCount.get(c.leafId) || 0) > 1 && c.parentId) {
            familyId = `${c.parentId}_${c.leafId}`;
        }

        if (!familyMap.has(familyId)) {
            const specFiles = getSpecFiles(c.dir);
            familyMap.set(familyId, {
                id: familyId,
                routes: [`/${familyId.replace(/_/g, '-')}`],
                webappPaths: [],
                serverPaths: [],
                specDirs: [c.relPath + '/'],
                cypressSpecDirs: [],
                tags: extractTags(specFiles),
                features: [],
                routesGuessed: true,
            });
        } else {
            const existing = familyMap.get(familyId)!;
            const specDir = c.relPath + '/';
            if (!existing.specDirs.includes(specDir)) {
                existing.specDirs.push(specDir);
                existing.tags = [...new Set([...existing.tags, ...extractTags(getSpecFiles(c.dir))])];
            }
        }
    }

    return Array.from(familyMap.values());
}

/**
 * Discover test library paths (page objects, helpers) organized by feature.
 * Walks well-known test lib directories and maps subdirectories to family IDs.
 */
export function discoverTestLibPaths(testsRoot: string): Map<string, string[]> {
    const resolved = resolve(testsRoot);
    const result = new Map<string, string[]>();

    const libDirs = [
        'lib/src/ui/components',
        'lib/src/ui/pages',
        'lib/src/server',
    ];

    for (const libDir of libDirs) {
        const fullDir = join(resolved, libDir);
        if (!existsSync(fullDir)) continue;

        let entries: string[];
        try { entries = readdirSync(fullDir); } catch { continue; }

        for (const entry of entries) {
            if (isSkipped(entry)) continue;
            const fullPath = join(fullDir, entry);
            try {
                const stat = lstatSync(fullPath);
                if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
            } catch { continue; }

            const familyId = normalizeId(entry);
            const relPath = relative(resolved, fullPath).replace(/\\/g, '/');
            const pattern = `${relPath}/*`;

            if (!result.has(familyId)) result.set(familyId, []);
            result.get(familyId)!.push(pattern);
        }
    }

    return result;
}

/**
 * Discover files in well-known directories (types, utils) whose basename
 * maps directly to a family ID.
 */
export function discoverNameMatchedPaths(
    appPath: string,
    gitRepoRoot?: string,
): Map<string, string[]> {
    const result = new Map<string, string[]>();
    const resolvedApp = resolve(appPath);

    const scanRoots: Array<{root: string; base: string}> = [
        {root: join(resolvedApp, 'src/utils'), base: resolvedApp},
        {root: join(resolvedApp, 'src/types'), base: resolvedApp},
    ];

    // Monorepo-aware: scan platform types directory
    if (gitRepoRoot) {
        const resolvedGitRoot = resolve(gitRepoRoot);
        const platformTypes = join(resolvedGitRoot, 'webapp/platform/types/src');
        if (existsSync(platformTypes)) {
            scanRoots.push({root: platformTypes, base: resolvedGitRoot});
        }
        const platformClient = join(resolvedGitRoot, 'webapp/platform/client/src');
        if (existsSync(platformClient)) {
            scanRoots.push({root: platformClient, base: resolvedGitRoot});
        }
    }

    for (const {root, base} of scanRoots) {
        if (!existsSync(root)) continue;

        let entries: string[];
        try { entries = readdirSync(root); } catch { continue; }

        for (const entry of entries) {
            if (entry.startsWith('.')) continue;
            const ext = entry.slice(entry.lastIndexOf('.'));
            if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) continue;

            const fullPath = join(root, entry);
            try {
                const stat = lstatSync(fullPath);
                if (!stat.isFile() || stat.isSymbolicLink()) continue;
            } catch { continue; }

            // Strip extension and normalize
            const baseName = entry.slice(0, entry.lastIndexOf('.'));
            const familyId = normalizeId(baseName);
            if (familyId.length < 3) continue;

            const relPath = relative(base, fullPath).replace(/\\/g, '/');
            if (!result.has(familyId)) result.set(familyId, []);
            result.get(familyId)!.push(relPath);
        }
    }

    return result;
}

export function scanProject(projectRoot: string, testsRoot?: string, serverRoot?: string, gitRepoRoot?: string): ScanResult {
    const resolved = resolve(projectRoot);
    const resolvedTestsRoot = testsRoot ? resolve(testsRoot) : resolved;
    const sourceDirs = discoverSourceDirs(resolved);
    const testDirs = discoverTestDirs(resolvedTestsRoot);

    const allDirs = [...sourceDirs, ...testDirs];
    const groups = groupByFamily(allDirs);

    const families: ScannedFamily[] = [];

    for (const [familyId, group] of groups) {
        const hasSrc = group.webapp.length > 0 || group.server.length > 0;
        const hasTests = group.test.length > 0 || group.cypress.length > 0;

        if (!hasSrc && !hasTests) continue;

        // Skip structural directories that are code-organization, not features.
        // Only skip if they have source dirs but no corresponding test dirs.
        if (STRUCTURAL_DIRS.has(familyId) && !hasTests) continue;

        // Skip test-only families that match broad test categories (not feature families).
        if (!hasSrc && hasTests && TEST_CATEGORY_DIRS.has(familyId)) continue;

        const allSpecFiles: string[] = [];
        for (const td of [...group.test, ...group.cypress]) {
            allSpecFiles.push(...getSpecFiles(td.path));
        }

        const features = detectFeatures(familyId, group, resolved);

        families.push({
            id: familyId,
            routes: [`/${familyId}`],
            webappPaths: group.webapp.map((d) => buildGlobPattern(d.relativePath)),
            serverPaths: group.server.map((d) => buildGlobPattern(d.relativePath)),
            specDirs: group.test.map((d) => d.relativePath + '/'),
            cypressSpecDirs: group.cypress.map((d) => d.relativePath + '/'),
            tags: extractTags(allSpecFiles),
            features,
            routesGuessed: true,
        });
    }

    // When a separate testsRoot is provided, discover families from test
    // directory structure.  Projects with feature-organized tests but
    // code-type-organized source benefit from this.
    if (testsRoot) {
        const testFamilies = discoverTestDerivedFamilies(resolvedTestsRoot);
        const existingIds = new Set(families.map((f) => f.id));
        for (const tf of testFamilies) {
            if (existingIds.has(tf.id)) {
                // Merge specDirs into existing family
                const existing = families.find((f) => f.id === tf.id)!;
                for (const sd of tf.specDirs) {
                    if (!existing.specDirs.includes(sd)) {
                        existing.specDirs.push(sd);
                    }
                }
                existing.tags = [...new Set([...existing.tags, ...tf.tags])];
            } else {
                families.push(tf);
                existingIds.add(tf.id);
            }
        }
    }

    // When a separate serverRoot is provided, discover families from Go source
    // filenames across the three-tier backend (api4, app, store).
    if (serverRoot) {
        const {multiTierFamilies: serverMulti, singleTierFamilies: serverSingle} = discoverServerDerivedFamilies(resolve(serverRoot));
        const existingIds = new Set(families.map((f) => f.id));

        // Merge ALL server families (multi + single tier) into existing families,
        // but only add NEW families if they span ≥2 tiers.
        const allServerFamilies = [...serverMulti, ...serverSingle];
        for (const sf of allServerFamilies) {
            // Try exact match, then singular/plural variants
            let target = families.find((f) => f.id === sf.id);
            if (!target && !sf.id.endsWith('s')) {
                target = families.find((f) => f.id === sf.id + 's');
            }
            if (!target && sf.id.endsWith('s')) {
                target = families.find((f) => f.id === sf.id.slice(0, -1));
            }

            if (target) {
                // Merge serverPaths into existing family
                for (const sp of sf.serverPaths) {
                    if (!target.serverPaths.includes(sp)) {
                        target.serverPaths.push(sp);
                    }
                }
            } else if (serverMulti.includes(sf)) {
                // Only add new families if they span ≥2 tiers
                families.push(sf);
                existingIds.add(sf.id);
            }
        }
    }

    // Merge test library paths (page objects, helpers) into existing families
    if (testsRoot) {
        const testLibPaths = discoverTestLibPaths(resolvedTestsRoot);
        for (const [libFamilyId, patterns] of testLibPaths) {
            let target = families.find((f) => f.id === libFamilyId);
            if (!target && !libFamilyId.endsWith('s')) {
                target = families.find((f) => f.id === libFamilyId + 's');
            }
            if (!target && libFamilyId.endsWith('s')) {
                target = families.find((f) => f.id === libFamilyId.slice(0, -1));
            }
            if (target) {
                for (const p of patterns) {
                    if (!target.webappPaths.includes(p)) {
                        target.webappPaths.push(p);
                    }
                }
            }
        }
    }

    // Merge name-matched type/util files into existing families
    {
        const nameMatchedPaths = discoverNameMatchedPaths(resolved, gitRepoRoot);
        for (const [nmFamilyId, paths] of nameMatchedPaths) {
            let target = families.find((f) => f.id === nmFamilyId);
            if (!target && !nmFamilyId.endsWith('s')) {
                target = families.find((f) => f.id === nmFamilyId + 's');
            }
            if (!target && nmFamilyId.endsWith('s')) {
                target = families.find((f) => f.id === nmFamilyId.slice(0, -1));
            }
            if (target) {
                for (const p of paths) {
                    if (!target.webappPaths.includes(p)) {
                        target.webappPaths.push(p);
                    }
                }
            }
        }
    }

    const familyIds = new Set(families.map((f) => f.id));
    const unmatchedSourceDirs = sourceDirs.filter(
        (d) => !familyIds.has(normalizeId(d.familyHint)),
    );
    const unmatchedTestDirs = testDirs.filter(
        (d) => !familyIds.has(normalizeId(d.familyHint)),
    );

    let totalSourceFiles = 0;
    let totalTestFiles = 0;
    for (const dir of sourceDirs) {
        try {
            totalSourceFiles += readdirSync(dir.path).filter((e) => {
                try {
                    const stat = lstatSync(join(dir.path, e));
                    return !stat.isSymbolicLink() && !stat.isDirectory();
                } catch {
                    // ENOENT or EACCES — skip inaccessible entries
                    return false;
                }
            }).length;
        } catch {
            // ENOENT or EACCES — skip inaccessible directories
        }
    }
    for (const dir of testDirs) {
        try {
            totalTestFiles += getSpecFiles(dir.path).length;
        } catch {
            // ENOENT or EACCES — skip inaccessible directories
        }
    }

    return {
        families,
        unmatchedSourceDirs,
        unmatchedTestDirs,
        stats: {
            totalSourceFiles,
            totalTestFiles,
            familyCount: families.length,
        },
    };
}

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

export function scanProject(projectRoot: string): ScanResult {
    const resolved = resolve(projectRoot);
    const sourceDirs = discoverSourceDirs(resolved);
    const testDirs = discoverTestDirs(resolved);

    const allDirs = [...sourceDirs, ...testDirs];
    const groups = groupByFamily(allDirs);

    const families: ScannedFamily[] = [];

    for (const [familyId, group] of groups) {
        const hasSrc = group.webapp.length > 0 || group.server.length > 0;
        const hasTests = group.test.length > 0 || group.cypress.length > 0;

        if (!hasSrc && !hasTests) continue;

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

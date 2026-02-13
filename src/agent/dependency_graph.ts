// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {globSync} from 'glob';
import {dirname, join, normalize} from 'path';
import type {DependencyGraphImpactConfig} from './config.js';
import {normalizePath, safeReadTextFile} from './utils.js';

export interface DependencyGraphExpansion {
    source: 'static-dependency-graph';
    seedFiles: string[];
    impactedFiles: string[];
    expandedFiles: string[];
    analyzedFiles: number;
    analyzedEdges: number;
    maxDepth: number;
    truncated: boolean;
    warnings: string[];
}

const IMPORT_REGEXES = [
    /import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /export\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const RESOLVABLE_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];

function extractImportSpecifiers(content: string): string[] {
    const imports: string[] = [];
    for (const regex of IMPORT_REGEXES) {
        regex.lastIndex = 0;
        let match = regex.exec(content);
        while (match) {
            const specifier = match[1];
            if (specifier) {
                imports.push(specifier);
            }
            match = regex.exec(content);
        }
    }
    return Array.from(new Set(imports));
}

function listCandidateFiles(appRoot: string, cfg: DependencyGraphImpactConfig): string[] {
    const files = new Set<string>();
    for (const pattern of cfg.filePatterns) {
        const matches = globSync(pattern, {
            cwd: appRoot,
            nodir: true,
            ignore: cfg.excludePatterns,
        });
        for (const match of matches) {
            files.add(normalizePath(match));
        }
    }
    return Array.from(files);
}

function resolveWithCandidates(candidateBase: string, fileSet: Set<string>): string | null {
    if (fileSet.has(candidateBase)) {
        return candidateBase;
    }

    for (const ext of RESOLVABLE_EXTENSIONS) {
        const withExt = `${candidateBase}.${ext}`;
        if (fileSet.has(withExt)) {
            return withExt;
        }
    }

    for (const ext of RESOLVABLE_EXTENSIONS) {
        const indexPath = `${candidateBase}/index.${ext}`;
        if (fileSet.has(indexPath)) {
            return indexPath;
        }
    }
    return null;
}

function expandAliasTarget(pattern: string, target: string, specifier: string): string | null {
    const normalizedPattern = normalizePath(pattern);
    const normalizedTarget = normalizePath(target);
    const normalizedSpecifier = normalizePath(specifier);

    if (normalizedPattern.endsWith('/*')) {
        const prefix = normalizedPattern.slice(0, -2);
        if (normalizedSpecifier === prefix || normalizedSpecifier.startsWith(`${prefix}/`)) {
            const suffix = normalizedSpecifier === prefix ? '' : normalizedSpecifier.slice(prefix.length + 1);
            if (normalizedTarget.endsWith('/*')) {
                const targetPrefix = normalizedTarget.slice(0, -2);
                return suffix ? normalizePath(`${targetPrefix}/${suffix}`) : normalizePath(targetPrefix);
            }
            return normalizePath(normalizedTarget);
        }
        return null;
    }

    if (normalizedPattern === normalizedSpecifier) {
        if (normalizedTarget.endsWith('/*')) {
            return normalizePath(normalizedTarget.slice(0, -2));
        }
        return normalizePath(normalizedTarget);
    }

    return null;
}

function resolvePathAliasImport(
    specifier: string,
    fileSet: Set<string>,
    cfg: DependencyGraphImpactConfig,
): string | null {
    for (const [pattern, targets] of Object.entries(cfg.pathAliases)) {
        for (const target of targets) {
            const aliasPath = expandAliasTarget(pattern, target, specifier);
            if (!aliasPath) {
                continue;
            }
            const resolved = resolveWithCandidates(aliasPath, fileSet);
            if (resolved) {
                return resolved;
            }
        }
    }
    return null;
}

function resolveImport(
    fromFile: string,
    specifier: string,
    fileSet: Set<string>,
    cfg: DependencyGraphImpactConfig,
): string | null {
    if (specifier.startsWith('.')) {
        const fromDir = dirname(fromFile);
        const relativeCandidate = normalizePath(normalize(join(fromDir, specifier)));
        return resolveWithCandidates(relativeCandidate, fileSet);
    }

    const aliasResolved = resolvePathAliasImport(specifier, fileSet, cfg);
    if (aliasResolved) {
        return aliasResolved;
    }

    for (const root of cfg.aliasRoots) {
        const rootedCandidate = normalizePath(normalize(join(root, specifier)));
        const resolved = resolveWithCandidates(rootedCandidate, fileSet);
        if (resolved) {
            return resolved;
        }
    }

    const directCandidate = normalizePath(specifier);
    return resolveWithCandidates(directCandidate, fileSet);
}

export function expandByDependencyGraph(
    appRoot: string,
    changedFiles: string[],
    cfg: DependencyGraphImpactConfig,
): DependencyGraphExpansion {
    const warnings: string[] = [];
    if (!cfg.enabled) {
        return {
            source: 'static-dependency-graph',
            seedFiles: [],
            impactedFiles: [],
            expandedFiles: [],
            analyzedFiles: 0,
            analyzedEdges: 0,
            maxDepth: 0,
            truncated: false,
            warnings,
        };
    }

    const candidates = listCandidateFiles(appRoot, cfg);
    const fileSet = new Set(candidates);
    if (candidates.length === 0) {
        warnings.push('Dependency graph found no candidate source files.');
    }

    const reverse = new Map<string, Set<string>>();
    let analyzedEdges = 0;
    for (const file of candidates) {
        const fullPath = join(appRoot, file);
        const content = safeReadTextFile(fullPath);
        if (!content) {
            continue;
        }
        const imports = extractImportSpecifiers(content);
        for (const specifier of imports) {
            const resolved = resolveImport(file, specifier, fileSet, cfg);
            if (!resolved) {
                continue;
            }
            if (!reverse.has(resolved)) {
                reverse.set(resolved, new Set());
            }
            reverse.get(resolved)?.add(file);
            analyzedEdges += 1;
        }
    }

    const seeds = Array.from(
        new Set(
            changedFiles
                .map((file) => normalizePath(file))
                .filter((file) => fileSet.has(file)),
        ),
    );

    if (seeds.length === 0) {
        warnings.push('No changed files were found in dependency graph candidates.');
        return {
            source: 'static-dependency-graph',
            seedFiles: [],
            impactedFiles: [],
            expandedFiles: [],
            analyzedFiles: candidates.length,
            analyzedEdges,
            maxDepth: cfg.maxDepth,
            truncated: false,
            warnings,
        };
    }

    const impacted = new Set<string>(seeds);
    const queue: Array<{file: string; depth: number}> = seeds.map((file) => ({file, depth: 0}));
    let truncated = false;

    while (queue.length > 0) {
        const next = queue.shift();
        if (!next) {
            continue;
        }
        if (next.depth >= cfg.maxDepth) {
            continue;
        }
        const dependents = reverse.get(next.file);
        if (!dependents) {
            continue;
        }
        for (const dependent of dependents) {
            if (impacted.has(dependent)) {
                continue;
            }
            if (impacted.size - seeds.length >= cfg.maxExpandedFiles) {
                truncated = true;
                break;
            }
            impacted.add(dependent);
            queue.push({file: dependent, depth: next.depth + 1});
        }
        if (truncated) {
            break;
        }
    }

    const impactedFiles = Array.from(impacted);
    const expandedFiles = impactedFiles.filter((file) => !seeds.includes(file));
    if (truncated) {
        warnings.push(
            `Dependency expansion was truncated at maxExpandedFiles=${cfg.maxExpandedFiles}.`,
        );
    }

    return {
        source: 'static-dependency-graph',
        seedFiles: seeds,
        impactedFiles,
        expandedFiles,
        analyzedFiles: candidates.length,
        analyzedEdges,
        maxDepth: cfg.maxDepth,
        truncated,
        warnings,
    };
}

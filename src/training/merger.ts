// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {execFileSync} from 'child_process';
import {existsSync} from 'fs';
import {join, resolve} from 'path';

import type {RouteFamily, RouteFamilyManifest} from '../knowledge/route_families.js';

import {isGuessedRoute} from './types.js';
import type {MergeResult, ScannedFamily} from './types.js';

function unionArrays(existing: string[] | undefined, incoming: string[]): string[] {
    const set = new Set(existing || []);
    for (const item of incoming) {
        set.add(item);
    }
    return Array.from(set);
}

function mergeFamily(existing: RouteFamily, scanned: ScannedFamily): RouteFamily {
    const merged: RouteFamily = {...existing};

    // Structural fields: union arrays
    merged.webappPaths = unionArrays(existing.webappPaths, scanned.webappPaths);
    merged.serverPaths = unionArrays(existing.serverPaths, scanned.serverPaths);
    merged.specDirs = unionArrays(existing.specDirs, scanned.specDirs);
    merged.cypressSpecDirs = unionArrays(existing.cypressSpecDirs, scanned.cypressSpecDirs);
    merged.tags = unionArrays(existing.tags, scanned.tags);

    // Routes: only update if existing looks like a guess
    if (isGuessedRoute(existing.routes) && !isGuessedRoute(scanned.routes)) {
        merged.routes = scanned.routes;
    }

    // Human-curated fields: never overwrite (priority, userFlows, pageObjects, components)

    // Merge features
    if (scanned.features.length > 0) {
        const existingFeatures = existing.features || [];
        const existingIds = new Set(existingFeatures.map((f) => f.id));
        const newFeatures = scanned.features.filter((f) => !existingIds.has(f.id));
        if (newFeatures.length > 0) {
            merged.features = [
                ...existingFeatures,
                ...newFeatures.map((f) => ({
                    id: f.id,
                    webappPaths: f.webappPaths,
                    serverPaths: f.serverPaths,
                    specDirs: f.specDirs,
                })),
            ];
        }
    }

    return merged;
}

function scannedToRouteFamily(scanned: ScannedFamily): RouteFamily {
    const family: RouteFamily = {
        id: scanned.id,
        routes: scanned.routes,
    };
    if (scanned.webappPaths.length > 0) family.webappPaths = scanned.webappPaths;
    if (scanned.serverPaths.length > 0) family.serverPaths = scanned.serverPaths;
    if (scanned.specDirs.length > 0) family.specDirs = scanned.specDirs;
    if (scanned.cypressSpecDirs.length > 0) family.cypressSpecDirs = scanned.cypressSpecDirs;
    if (scanned.tags.length > 0) family.tags = scanned.tags;
    if (scanned.features.length > 0) {
        family.features = scanned.features.map((f) => ({
            id: f.id,
            webappPaths: f.webappPaths.length > 0 ? f.webappPaths : undefined,
            serverPaths: f.serverPaths.length > 0 ? f.serverPaths : undefined,
            specDirs: f.specDirs.length > 0 ? f.specDirs : undefined,
        }));
    }
    return family;
}

/**
 * Try to find a matching family ID with singular/plural normalization.
 * "team" matches "teams", "emoji" matches "emoji", etc.
 */
function findFuzzyMatch(id: string, idMap: Map<string, unknown>): string | undefined {
    if (idMap.has(id)) return id;
    // Try adding 's'
    if (!id.endsWith('s') && idMap.has(id + 's')) return id + 's';
    // Try removing 's'
    if (id.endsWith('s') && idMap.has(id.slice(0, -1))) return id.slice(0, -1);
    return undefined;
}

export function mergeFamilies(
    existing: RouteFamilyManifest | null,
    scanned: ScannedFamily[],
): MergeResult {
    const existingFamilies = existing?.families || [];
    const existingMap = new Map(existingFamilies.map((f) => [f.id, f]));
    const scannedMap = new Map(scanned.map((f) => [f.id, f]));

    const newFamilies: string[] = [];
    const updatedFamilies: string[] = [];
    const mergedFamilies: RouteFamily[] = [];

    // Process existing families — match scanned by exact or fuzzy ID
    for (const ef of existingFamilies) {
        let sf = scannedMap.get(ef.id);
        // Try singular/plural match if exact match failed
        if (!sf) {
            const fuzzyId = findFuzzyMatch(ef.id, scannedMap);
            if (fuzzyId) sf = scannedMap.get(fuzzyId);
        }
        if (sf) {
            mergedFamilies.push(mergeFamily(ef, sf));
            updatedFamilies.push(ef.id);
        } else {
            // Keep untouched
            mergedFamilies.push({...ef});
        }
    }

    // Add new families from scanner (if no existing family matched)
    for (const sf of scanned) {
        const matchedExisting = findFuzzyMatch(sf.id, existingMap);
        if (!matchedExisting) {
            mergedFamilies.push(scannedToRouteFamily(sf));
            newFamilies.push(sf.id);
        }
    }

    const parts: string[] = [];
    if (updatedFamilies.length > 0) parts.push(`${updatedFamilies.length} families updated`);
    if (newFamilies.length > 0) parts.push(`${newFamilies.length} new families added`);
    if (parts.length === 0) parts.push('no changes');

    return {
        manifest: {families: mergedFamilies, source: existing?.source || 'train-scan'},
        newFamilies,
        updatedFamilies,
        staleFamilies: [],
        summary: parts.join(', '),
    };
}

/**
 * Detect families whose paths no longer exist on disk.
 *
 * Paths in the manifest may be relative to different roots:
 * - webappPaths / serverPaths are typically relative to the repo root
 * - specDirs may be relative to the tests root
 *
 * We try each pattern against all provided roots (and the git repo root
 * if discoverable) to avoid false positives from path-prefix mismatches.
 */
export function detectStaleFamilies(
    manifest: RouteFamilyManifest,
    projectRoot: string,
    testsRoot?: string,
): string[] {
    const roots = new Set([resolve(projectRoot)]);
    if (testsRoot) roots.add(resolve(testsRoot));

    // Also try to discover the git repo root — manifest paths may be repo-relative
    try {
        const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd: projectRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        if (gitRoot) roots.add(resolve(gitRoot));
    } catch {
        // Not a git repo or git not available — that's fine
    }

    const stale: string[] = [];

    for (const family of manifest.families) {
        const allPatterns = [
            ...(family.webappPaths || []),
            ...(family.serverPaths || []),
            ...(family.specDirs || []),
        ];

        if (allPatterns.length === 0) continue;

        // Check if any pattern resolves to existing files/dirs in any root
        let hasAny = false;
        for (const pattern of allPatterns) {
            // Strip trailing glob (* or **) to get the directory
            const dirPart = pattern.replace(/\/?\*.*$/, '');
            if (!dirPart) continue;

            // For file-level patterns like "server/channels/api4/draft*.go",
            // dirPart is "server/channels/api4/draft" — check the parent dir instead
            const isFileGlob = /\.\w+$/.test(pattern);
            const pathsToCheck = [dirPart];
            if (isFileGlob) {
                const parentDir = dirPart.split('/').slice(0, -1).join('/');
                if (parentDir) pathsToCheck.push(parentDir);
            }

            for (const checkPath of pathsToCheck) {
                for (const root of roots) {
                    if (existsSync(join(root, checkPath))) {
                        hasAny = true;
                        break;
                    }
                }
                if (hasAny) break;
            }
            if (hasAny) break;
        }

        if (!hasAny) {
            stale.push(family.id);
        }
    }

    return stale;
}

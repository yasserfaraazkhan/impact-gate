// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

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

    // Process existing families
    for (const ef of existingFamilies) {
        const sf = scannedMap.get(ef.id);
        if (sf) {
            mergedFamilies.push(mergeFamily(ef, sf));
            updatedFamilies.push(ef.id);
        } else {
            // Keep untouched
            mergedFamilies.push({...ef});
        }
    }

    // Add new families from scanner
    for (const sf of scanned) {
        if (!existingMap.has(sf.id)) {
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

export function detectStaleFamilies(
    manifest: RouteFamilyManifest,
    projectRoot: string,
): string[] {
    const resolved = resolve(projectRoot);
    const stale: string[] = [];

    for (const family of manifest.families) {
        const allPatterns = [
            ...(family.webappPaths || []),
            ...(family.serverPaths || []),
            ...(family.specDirs || []),
        ];

        if (allPatterns.length === 0) continue;

        // Check if any pattern resolves to existing files/dirs
        let hasAny = false;
        for (const pattern of allPatterns) {
            // Strip trailing glob (* or **) to get the directory
            const dirPart = pattern.replace(/\/?\*.*$/, '');
            if (dirPart && existsSync(join(resolved, dirPart))) {
                hasAny = true;
                break;
            }
        }

        if (!hasAny) {
            stale.push(family.id);
        }
    }

    return stale;
}

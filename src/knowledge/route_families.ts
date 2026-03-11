// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync, statSync} from 'fs';
import {join} from 'path';

export type FeaturePriority = 'P0' | 'P1' | 'P2';

export interface RouteFeature {
    id: string;
    routes?: string[];
    webappPaths?: string[];
    serverPaths?: string[];
    specDirs?: string[];
    cypressSpecDirs?: string[];
    tags?: string[];
    priority?: FeaturePriority;
    userFlows?: string[];
}

export interface RouteFamily {
    id: string;
    routes: string[];
    pageObjects?: string[];
    components?: string[];
    webappPaths?: string[];
    serverPaths?: string[];
    specDirs?: string[];
    cypressSpecDirs?: string[];
    tags?: string[];
    priority?: FeaturePriority;
    userFlows?: string[];
    features?: RouteFeature[];
}

export interface RouteFamilyManifest {
    families: RouteFamily[];
    source: string;
}

export interface FileBinding {
    file: string;
    bindings: Array<{family: string; feature?: string}>;
}

export interface RouteFamilyConfig {
    manifestPath?: string;
    strict?: boolean;
}

const manifestCache = new Map<string, {mtimeMs: number; manifest: RouteFamilyManifest | null}>();

function matchesGlob(filePath: string, pattern: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    const parts = pattern.replace(/\\/g, '/').split('*');

    if (parts.length === 1) {
        return normalized === parts[0] || normalized.startsWith(parts[0]);
    }

    let pos = 0;
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === '') {
            continue;
        }
        const idx = normalized.indexOf(part, pos);
        if (idx < 0) {
            return false;
        }
        if (i === 0 && idx !== 0) {
            return false;
        }
        pos = idx + part.length;
    }
    return true;
}

function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
    return patterns.some((pattern) => matchesGlob(filePath, pattern));
}

function validateFamily(family: unknown): RouteFamily | null {
    if (!family || typeof family !== 'object') {
        return null;
    }
    const obj = family as Record<string, unknown>;
    if (typeof obj.id !== 'string' || !obj.id.trim()) {
        return null;
    }
    if (!Array.isArray(obj.routes) || obj.routes.length === 0) {
        return null;
    }
    const routes = obj.routes.filter((r): r is string => typeof r === 'string');
    if (routes.length === 0) {
        return null;
    }

    const result: RouteFamily = {
        id: obj.id.trim(),
        routes,
    };

    if (Array.isArray(obj.pageObjects)) {
        result.pageObjects = obj.pageObjects.filter((v): v is string => typeof v === 'string');
    }
    if (Array.isArray(obj.components)) {
        result.components = obj.components.filter((v): v is string => typeof v === 'string');
    }
    if (Array.isArray(obj.webappPaths)) {
        result.webappPaths = obj.webappPaths.filter((v): v is string => typeof v === 'string');
    }
    if (Array.isArray(obj.serverPaths)) {
        result.serverPaths = obj.serverPaths.filter((v): v is string => typeof v === 'string');
    }
    if (Array.isArray(obj.specDirs)) {
        result.specDirs = obj.specDirs.filter((v): v is string => typeof v === 'string');
    }
    if (Array.isArray(obj.cypressSpecDirs)) {
        result.cypressSpecDirs = obj.cypressSpecDirs.filter((v): v is string => typeof v === 'string');
    }
    if (Array.isArray(obj.tags)) {
        result.tags = obj.tags.filter((v): v is string => typeof v === 'string');
    }
    if (obj.priority === 'P0' || obj.priority === 'P1' || obj.priority === 'P2') {
        result.priority = obj.priority;
    }
    if (Array.isArray(obj.userFlows)) {
        result.userFlows = obj.userFlows.filter((v): v is string => typeof v === 'string');
    }
    if (Array.isArray(obj.features)) {
        result.features = obj.features
            .map((f) => validateFeature(f))
            .filter((f): f is RouteFeature => f !== null);
    }

    return result;
}

function validateFeature(feature: unknown): RouteFeature | null {
    if (!feature || typeof feature !== 'object') {
        return null;
    }
    const obj = feature as Record<string, unknown>;
    if (typeof obj.id !== 'string' || !obj.id.trim()) {
        return null;
    }
    const result: RouteFeature = {id: obj.id.trim()};
    if (Array.isArray(obj.routes)) {
        result.routes = obj.routes.filter((v): v is string => typeof v === 'string');
    }
    if (Array.isArray(obj.webappPaths)) {
        result.webappPaths = obj.webappPaths.filter((v): v is string => typeof v === 'string');
    }
    if (Array.isArray(obj.serverPaths)) {
        result.serverPaths = obj.serverPaths.filter((v): v is string => typeof v === 'string');
    }
    if (Array.isArray(obj.specDirs)) {
        result.specDirs = obj.specDirs.filter((v): v is string => typeof v === 'string');
    }
    if (Array.isArray(obj.cypressSpecDirs)) {
        result.cypressSpecDirs = obj.cypressSpecDirs.filter((v): v is string => typeof v === 'string');
    }
    if (Array.isArray(obj.tags)) {
        result.tags = obj.tags.filter((v): v is string => typeof v === 'string');
    }
    if (obj.priority === 'P0' || obj.priority === 'P1' || obj.priority === 'P2') {
        result.priority = obj.priority;
    }
    if (Array.isArray(obj.userFlows)) {
        result.userFlows = obj.userFlows.filter((v): v is string => typeof v === 'string');
    }
    return result;
}

export function loadRouteFamilyManifest(testsRoot: string, config?: RouteFamilyConfig): RouteFamilyManifest | null {
    const candidates: string[] = [];
    if (config?.manifestPath) {
        candidates.push(config.manifestPath);
    }
    candidates.push(join(testsRoot, '.e2e-ai-agents', 'route-families.json'));

    for (const candidate of candidates) {
        try {
            if (!existsSync(candidate)) {
                continue;
            }
            const mtimeMs = statSync(candidate).mtimeMs;
            const cached = manifestCache.get(candidate);
            if (cached && cached.mtimeMs === mtimeMs && cached.manifest) {
                return cached.manifest;
            }
            const raw = JSON.parse(readFileSync(candidate, 'utf-8')) as {families?: unknown[]};
            if (!raw.families || !Array.isArray(raw.families)) {
                manifestCache.set(candidate, {mtimeMs, manifest: null});
                continue;
            }
            const families = raw.families
                .map((f) => validateFamily(f))
                .filter((f): f is RouteFamily => f !== null);
            if (families.length === 0) {
                manifestCache.set(candidate, {mtimeMs, manifest: null});
                continue;
            }
            const manifest: RouteFamilyManifest = {families, source: candidate};
            manifestCache.set(candidate, {mtimeMs, manifest});
            return manifest;
        } catch {
            continue;
        }
    }

    if (config?.strict) {
        throw new Error('Route family manifest is required but not found. Create .e2e-ai-agents/route-families.json');
    }
    return null;
}

export function bindFilesToFamilies(changedFiles: string[], manifest: RouteFamilyManifest): FileBinding[] {
    return changedFiles.map((file) => {
        const normalized = file.replace(/\\/g, '/');
        const bindings: Array<{family: string; feature?: string}> = [];

        for (const family of manifest.families) {
            const featureBindings: Array<{family: string; feature: string}> = [];

            // Check feature-level first (more specific)
            if (family.features) {
                for (const feature of family.features) {
                    const featurePatterns = [
                        ...(feature.webappPaths || []),
                        ...(feature.serverPaths || []),
                    ];
                    if (featurePatterns.length > 0 && matchesAnyPattern(normalized, featurePatterns)) {
                        featureBindings.push({family: family.id, feature: feature.id});
                    }
                }
            }

            if (featureBindings.length > 0) {
                bindings.push(...featureBindings);
                continue;
            }

            // Fall back to family-level patterns
            const familyPatterns = [
                ...(family.webappPaths || []),
                ...(family.serverPaths || []),
            ];
            if (familyPatterns.length > 0 && matchesAnyPattern(normalized, familyPatterns)) {
                bindings.push({family: family.id});
            }
        }

        return {file: normalized, bindings};
    });
}

export function getFamilyById(manifest: RouteFamilyManifest, familyId: string): RouteFamily | undefined {
    return manifest.families.find((f) => f.id === familyId);
}

export function getFeatureById(family: RouteFamily, featureId: string): RouteFeature | undefined {
    return family.features?.find((f) => f.id === featureId);
}

export function getSpecDirsForBinding(
    manifest: RouteFamilyManifest,
    binding: {family: string; feature?: string},
): string[] {
    const family = getFamilyById(manifest, binding.family);
    if (!family) {
        return [];
    }
    if (binding.feature) {
        const feature = getFeatureById(family, binding.feature);
        if (feature?.specDirs && feature.specDirs.length > 0) {
            return feature.specDirs;
        }
    }
    return family.specDirs || [];
}

export function getCypressSpecDirsForBinding(
    manifest: RouteFamilyManifest,
    binding: {family: string; feature?: string},
): string[] {
    const family = getFamilyById(manifest, binding.family);
    if (!family) {
        return [];
    }
    if (binding.feature) {
        const feature = getFeatureById(family, binding.feature);
        if (feature?.cypressSpecDirs && feature.cypressSpecDirs.length > 0) {
            return feature.cypressSpecDirs;
        }
    }
    return family.cypressSpecDirs || [];
}

export function getPriorityForBinding(
    manifest: RouteFamilyManifest,
    binding: {family: string; feature?: string},
): FeaturePriority {
    const family = getFamilyById(manifest, binding.family);
    if (!family) {
        return 'P2';
    }
    if (binding.feature) {
        const feature = getFeatureById(family, binding.feature);
        if (feature?.priority) {
            return feature.priority;
        }
    }
    return family.priority || 'P2';
}

export function getUserFlowsForBinding(
    manifest: RouteFamilyManifest,
    binding: {family: string; feature?: string},
): string[] {
    const family = getFamilyById(manifest, binding.family);
    if (!family) {
        return [];
    }
    if (binding.feature) {
        const feature = getFeatureById(family, binding.feature);
        if (feature?.userFlows && feature.userFlows.length > 0) {
            return feature.userFlows;
        }
    }
    return family.userFlows || [];
}

export function getRoutesForBinding(
    manifest: RouteFamilyManifest,
    binding: {family: string; feature?: string},
): string[] {
    const family = getFamilyById(manifest, binding.family);
    if (!family) {
        return [];
    }
    if (binding.feature) {
        const feature = getFeatureById(family, binding.feature);
        if (feature?.routes && feature.routes.length > 0) {
            return feature.routes;
        }
    }
    return family.routes;
}

export function clearManifestCache(): void {
    manifestCache.clear();
}

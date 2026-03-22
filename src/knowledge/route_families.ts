// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync, statSync} from 'fs';
import {join} from 'path';
import {logger} from '../logger.js';

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

export interface ApiEndpoint {
    method: string;
    path: string;
    description?: string;
}

export type TestType = 'ui' | 'api' | 'both';

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
    apiEndpoints?: ApiEndpoint[];
    testType?: TestType;
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

export function matchesGlob(filePath: string, pattern: string): boolean {
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

export function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
    return patterns.some((pattern) => matchesGlob(filePath, pattern));
}

function validateApiEndpoint(ep: unknown): ApiEndpoint | null {
    if (!ep || typeof ep !== 'object') return null;
    const obj = ep as Record<string, unknown>;
    if (typeof obj.method !== 'string' || typeof obj.path !== 'string') return null;
    const result: ApiEndpoint = {method: obj.method, path: obj.path};
    if (typeof obj.description === 'string') result.description = obj.description;
    return result;
}

function validateFamily(family: unknown): RouteFamily | null {
    if (!family || typeof family !== 'object') {
        return null;
    }
    const obj = family as Record<string, unknown>;
    if (typeof obj.id !== 'string' || !obj.id.trim()) {
        return null;
    }

    // When testType is 'api', routes may contain API paths like "GET /api/users"
    const testType = (obj.testType === 'ui' || obj.testType === 'api' || obj.testType === 'both')
        ? obj.testType as TestType
        : undefined;

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
    if (Array.isArray(obj.apiEndpoints)) {
        const endpoints = obj.apiEndpoints
            .map((ep) => validateApiEndpoint(ep))
            .filter((ep): ep is ApiEndpoint => ep !== null);
        if (endpoints.length > 0) result.apiEndpoints = endpoints;
    }
    if (testType) {
        result.testType = testType;
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
        logger.warn('Route family manifest not found. Create .e2e-ai-agents/route-families.json to enable family-level routing hints.');
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
                        ...(feature.specDirs || []),
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
                ...(family.specDirs || []),
                ...(family.cypressSpecDirs || []),
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
        // An explicitly declared specDirs (even []) is intentional — don't fall back to family.
        if (feature && feature.specDirs !== undefined) {
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
        // An explicitly declared cypressSpecDirs (even []) is intentional — don't fall back to family.
        if (feature && feature.cypressSpecDirs !== undefined) {
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

/**
 * Build heuristic route families from changed files when no manifest exists.
 * Groups files by their top-level directory to create rough family groupings.
 * Results are lower confidence but allow analysis to proceed without training.
 */
export function buildHeuristicFamilies(changedFiles: string[], testsRoot: string): RouteFamilyManifest {
    const dirGroups = new Map<string, string[]>();

    for (const file of changedFiles) {
        const normalized = file.replace(/\\/g, '/');
        const parts = normalized.split('/');
        // Use the first meaningful directory segment as the family ID
        // Skip common prefixes like 'src/', 'app/', 'lib/'
        const skipDirs = new Set(['src', 'app', 'lib', 'packages', 'components']);
        let familyDir = parts[0] || 'root';
        if (skipDirs.has(familyDir) && parts.length > 1) {
            familyDir = parts[1];
        }
        // Normalize to a clean family name
        familyDir = familyDir.replace(/\.[^.]+$/, ''); // strip file extensions for single files

        if (!dirGroups.has(familyDir)) {
            dirGroups.set(familyDir, []);
        }
        dirGroups.get(familyDir)!.push(normalized);
    }

    const families: RouteFamily[] = [];
    for (const [dir, files] of dirGroups) {
        families.push({
            id: dir,
            routes: [`/${dir}`],
            webappPaths: files.map((f) => `${f}*`),
        });
    }

    logger.info(`Built ${families.length} heuristic families from ${changedFiles.length} changed files (no route-families.json found)`);
    logger.info('Tip: Run `e2e-ai-agents train` to generate a proper route-families manifest for better accuracy.');

    return {
        families,
        source: 'heuristic',
    };
}

/**
 * Serialize a RouteFamilyManifest to clean JSON, stripping empty optional fields.
 */
export function serializeManifest(manifest: RouteFamilyManifest): string {
    const output = {
        families: manifest.families.map((f) => {
            const cleaned = {...f};
            const optionalArrays = [
                'pageObjects', 'components', 'webappPaths', 'serverPaths',
                'specDirs', 'cypressSpecDirs', 'tags', 'userFlows', 'features', 'apiEndpoints',
            ] as const;
            for (const key of optionalArrays) {
                if (!cleaned[key] || (Array.isArray(cleaned[key]) && (cleaned[key] as unknown[]).length === 0)) {
                    delete cleaned[key];
                }
            }
            if (!cleaned.priority) delete cleaned.priority;
            if (!cleaned.testType) delete cleaned.testType;
            return cleaned;
        }),
    };
    return JSON.stringify(output, null, 2) + '\n';
}

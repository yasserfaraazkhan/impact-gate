// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';
import {
    bindFilesToFamilies,
    buildHeuristicFamilies,
    loadRouteFamilyManifest,
    type FileBinding,
    type RouteFamilyConfig,
    type RouteFamilyManifest,
} from '../knowledge/route_families.js';
import {loadOrBuildApiSurface, type ApiSurfaceCatalog, type ApiSurfaceConfig} from '../knowledge/api_surface.js';
import {buildSpecIndex, type SpecIndex} from '../knowledge/spec_index.js';
import {loadContextDocuments, type LoadedContext} from '../knowledge/context_loader.js';

export interface PreprocessConfig {
    appPath: string;
    testsRoot: string;
    routeFamilies?: RouteFamilyConfig;
    apiSurface?: ApiSurfaceConfig;
}

export interface FamilyGroup {
    familyId: string;
    featureId?: string;
    files: Array<{path: string; snippet?: string}>;
}

export interface PreprocessResult {
    changedFiles: string[];
    fileBindings: FileBinding[];
    unboundFiles: string[];
    familyGroups: FamilyGroup[];
    manifest: RouteFamilyManifest | null;
    apiSurface: ApiSurfaceCatalog;
    specIndex: SpecIndex;
    context: LoadedContext;
    warnings: string[];
}

const MAX_SNIPPET_CHARS = 3000;
const MAX_FILES_PER_GROUP = 30;

function loadFileSnippet(appPath: string, filePath: string): string | undefined {
    const candidates = [
        join(appPath, filePath),
        filePath,
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            try {
                const content = readFileSync(candidate, 'utf-8');
                if (content.length <= MAX_SNIPPET_CHARS) {
                    return content;
                }
                return content.slice(0, MAX_SNIPPET_CHARS) + '\n// ... truncated';
            } catch {
                continue;
            }
        }
    }
    return undefined;
}

export function preprocess(changedFiles: string[], config: PreprocessConfig): PreprocessResult {
    const warnings: string[] = [];

    // Load route family manifest, fall back to heuristic families
    let manifest = loadRouteFamilyManifest(config.testsRoot, config.routeFamilies);
    if (!manifest) {
        manifest = buildHeuristicFamilies(changedFiles, config.testsRoot);
        warnings.push(
            'Route family manifest not found. Using directory-based heuristics (lower accuracy).',
            'Tip: Run `e2e-ai-agents train` to generate a proper manifest.',
        );
    }

    // Load API surface catalog
    const apiSurface = loadOrBuildApiSurface(config.testsRoot, config.apiSurface);
    if (apiSurface.pageObjects.length === 0) {
        warnings.push('API surface catalog is empty. Generated test validation will be limited.');
    }

    // Build spec index
    const specIndex = buildSpecIndex(config.testsRoot, undefined, manifest);

    // Load context documents
    const context = loadContextDocuments(config.testsRoot, config.appPath);
    warnings.push(...context.warnings);

    // Bind files to families (manifest is always non-null now — either real or heuristic)
    const fileBindings = bindFilesToFamilies(changedFiles, manifest);
    const unboundFiles = fileBindings
        .filter((fb) => fb.bindings.length === 0)
        .map((fb) => fb.file);
    if (unboundFiles.length > 0) {
        warnings.push(
            `${unboundFiles.length} changed file(s) did not match any route family: ${unboundFiles.slice(0, 5).join(', ')}${unboundFiles.length > 5 ? '...' : ''}`,
        );
    }

    // Group files by family+feature
    const groupMap = new Map<string, FamilyGroup>();
    for (const binding of fileBindings) {
        if (binding.bindings.length === 0) {
            // Unbound files go into a special "unbound" group
            const key = '__unbound__';
            if (!groupMap.has(key)) {
                groupMap.set(key, {familyId: '__unbound__', files: []});
            }
            const group = groupMap.get(key)!;
            if (group.files.length < MAX_FILES_PER_GROUP) {
                group.files.push({
                    path: binding.file,
                    snippet: loadFileSnippet(config.appPath, binding.file),
                });
            }
            continue;
        }
        for (const b of binding.bindings) {
            const key = b.feature ? `${b.family}::${b.feature}` : b.family;
            if (!groupMap.has(key)) {
                groupMap.set(key, {familyId: b.family, featureId: b.feature, files: []});
            }
            const group = groupMap.get(key)!;
            if (group.files.length < MAX_FILES_PER_GROUP) {
                group.files.push({
                    path: binding.file,
                    snippet: loadFileSnippet(config.appPath, binding.file),
                });
            }
        }
    }

    const familyGroups = Array.from(groupMap.values()).filter((g) => g.familyId !== '__unbound__');

    return {
        changedFiles,
        fileBindings,
        unboundFiles,
        familyGroups,
        manifest,
        apiSurface,
        specIndex,
        context,
        warnings,
    };
}

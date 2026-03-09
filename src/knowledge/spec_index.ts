// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync, readdirSync} from 'fs';
import {join, relative} from 'path';
import type {RouteFamilyManifest} from './route_families.js';

export interface SpecEntry {
    path: string;
    relativePath: string;
    testTitles: string[];
    tags: string[];
    familyId?: string;
    featureId?: string;
}

export interface SpecIndex {
    specs: SpecEntry[];
    indexedAt: string;
}

function extractTestTitles(content: string): string[] {
    const titles: string[] = [];
    const testRe = /\btest\s*\(\s*(['"`])((?:(?!\1).|\\.)*)\1/g;
    let match;
    while ((match = testRe.exec(content)) !== null) {
        const title = match[2].trim();
        if (title) {
            titles.push(title);
        }
    }
    return titles;
}

function extractTags(content: string): string[] {
    const tags = new Set<string>();
    const singleTagRe = /\btag:\s*['"`](@[\w-]+)['"`]/g;
    let match;
    while ((match = singleTagRe.exec(content)) !== null) {
        tags.add(match[1]);
    }
    const arrayTagRe = /\btag:\s*\[([^\]]*)\]/g;
    while ((match = arrayTagRe.exec(content)) !== null) {
        const inner = match[1];
        const tagRe = /['"`](@[\w-]+)['"`]/g;
        let tagMatch;
        while ((tagMatch = tagRe.exec(inner)) !== null) {
            tags.add(tagMatch[1]);
        }
    }
    return Array.from(tags);
}

function scanSpecDir(dir: string, testsRoot: string): SpecEntry[] {
    const entries: SpecEntry[] = [];
    if (!existsSync(dir)) {
        return entries;
    }
    const items = readdirSync(dir, {withFileTypes: true});
    for (const item of items) {
        const fullPath = join(dir, item.name);
        if (item.isDirectory()) {
            entries.push(...scanSpecDir(fullPath, testsRoot));
            continue;
        }
        if (!item.name.endsWith('.spec.ts') && !item.name.endsWith('.spec.tsx')) {
            continue;
        }
        try {
            const content = readFileSync(fullPath, 'utf-8');
            entries.push({
                path: fullPath,
                relativePath: relative(testsRoot, fullPath).replace(/\\/g, '/'),
                testTitles: extractTestTitles(content),
                tags: extractTags(content),
            });
        } catch {
            continue;
        }
    }
    return entries;
}

function bindSpecToFamily(spec: SpecEntry, manifest: RouteFamilyManifest): void {
    const specPath = spec.relativePath;

    for (const family of manifest.families) {
        if (family.features) {
            for (const feature of family.features) {
                if (feature.specDirs?.some((dir) => specPath.startsWith(dir))) {
                    spec.familyId = family.id;
                    spec.featureId = feature.id;
                    return;
                }
            }
        }
        if (family.specDirs?.some((dir) => specPath.startsWith(dir))) {
            spec.familyId = family.id;
            return;
        }
        if (family.tags && spec.tags.some((t) => family.tags!.includes(t))) {
            spec.familyId = family.id;
            return;
        }
    }
}

export function buildSpecIndex(
    testsRoot: string,
    _specPatterns?: string[],
    manifest?: RouteFamilyManifest | null,
): SpecIndex {
    const specsDir = join(testsRoot, 'specs');
    const specs = scanSpecDir(specsDir, testsRoot);

    if (manifest) {
        for (const spec of specs) {
            bindSpecToFamily(spec, manifest);
        }
    }

    return {
        specs,
        indexedAt: new Date().toISOString(),
    };
}

export function getSpecsForFamily(index: SpecIndex, familyId: string, featureId?: string): SpecEntry[] {
    return index.specs.filter((s) => {
        if (s.familyId !== familyId) {
            return false;
        }
        if (featureId && s.featureId && s.featureId !== featureId) {
            return false;
        }
        return true;
    });
}

export function getSpecByPath(index: SpecIndex, relativePath: string): SpecEntry | undefined {
    return index.specs.find((s) => s.relativePath === relativePath);
}

export function formatSpecsForPrompt(specs: SpecEntry[]): string {
    return specs
        .map((s) => {
            const titles = s.testTitles.map((t) => `  - ${t}`).join('\n');
            const tagsStr = s.tags.length > 0 ? ` [${s.tags.join(', ')}]` : '';
            return `${s.relativePath}${tagsStr}\n${titles}`;
        })
        .join('\n\n');
}

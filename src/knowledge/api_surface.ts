// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync, readdirSync, writeFileSync} from 'fs';
import {join, extname} from 'path';

export interface MethodSignature {
    name: string;
    kind: 'method' | 'property' | 'getter';
}

export interface PageObjectSurface {
    className: string;
    file: string;
    methods: MethodSignature[];
}

export interface ApiSurfaceCatalog {
    pageObjects: PageObjectSurface[];
    generatedAt: string;
}

export interface ApiSurfaceConfig {
    enabled: boolean;
    pageObjectsDir?: string;
    componentsDir?: string;
    cachePath?: string;
}

const RESERVED_WORDS = new Set([
    'private', 'protected', 'static', 'abstract', 'override',
    'if', 'for', 'while', 'switch', 'return',
    'const', 'let', 'var', 'import', 'export',
    'class', 'type', 'interface', 'constructor',
]);

function extractMethodsFromSource(content: string): MethodSignature[] {
    const methods: MethodSignature[] = [];
    const seen = new Set<string>();

    // Match async method declarations: async methodName(
    const asyncMethodRe = /(?:async\s+)([a-zA-Z_]\w*)\s*\(/g;
    let match;
    while ((match = asyncMethodRe.exec(content)) !== null) {
        const name = match[1];
        if (RESERVED_WORDS.has(name)) {
            continue;
        }
        if (!seen.has(name)) {
            seen.add(name);
            methods.push({name, kind: 'method'});
        }
    }

    // Match non-async public method patterns
    const methodRe = /^\s+(?:readonly\s+)?([a-zA-Z_]\w*)\s*(?:\(|=\s*(?:async\s*)?\()/gm;
    while ((match = methodRe.exec(content)) !== null) {
        const name = match[1];
        if (RESERVED_WORDS.has(name) || seen.has(name)) {
            continue;
        }
        seen.add(name);
        methods.push({name, kind: 'method'});
    }

    // Match getter patterns: get propertyName()
    const getterRe = /\bget\s+([a-zA-Z_]\w*)\s*\(\)/g;
    while ((match = getterRe.exec(content)) !== null) {
        const name = match[1];
        if (!seen.has(name)) {
            seen.add(name);
            methods.push({name, kind: 'getter'});
        }
    }

    // Match readonly property declarations
    const propRe = /^\s+(?:readonly\s+)?([a-zA-Z_]\w*)\s*[:=]/gm;
    while ((match = propRe.exec(content)) !== null) {
        const name = match[1];
        if (RESERVED_WORDS.has(name) || seen.has(name)) {
            continue;
        }
        seen.add(name);
        methods.push({name, kind: 'property'});
    }

    return methods;
}

function extractClassName(content: string): string | null {
    const match = content.match(/(?:export\s+)?class\s+(\w+)/);
    return match ? match[1] : null;
}

function scanDirectory(dir: string): PageObjectSurface[] {
    const surfaces: PageObjectSurface[] = [];
    if (!existsSync(dir)) {
        return surfaces;
    }

    const entries = readdirSync(dir, {withFileTypes: true});
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            surfaces.push(...scanDirectory(fullPath));
            continue;
        }
        const ext = extname(entry.name);
        if (ext !== '.ts' && ext !== '.tsx') {
            continue;
        }
        if (entry.name === 'index.ts' || entry.name === 'index.tsx') {
            continue;
        }
        try {
            const content = readFileSync(fullPath, 'utf-8');
            const className = extractClassName(content);
            if (!className) {
                continue;
            }
            const extractedMethods = extractMethodsFromSource(content);
            if (extractedMethods.length > 0) {
                surfaces.push({
                    className,
                    file: fullPath,
                    methods: extractedMethods,
                });
            }
        } catch {
            continue;
        }
    }
    return surfaces;
}

export function buildApiSurface(testsRoot: string, config?: ApiSurfaceConfig): ApiSurfaceCatalog {
    const pageObjectsDir = config?.pageObjectsDir
        ? join(testsRoot, config.pageObjectsDir)
        : join(testsRoot, 'lib', 'src', 'ui', 'pages');
    const componentsDir = config?.componentsDir
        ? join(testsRoot, config.componentsDir)
        : join(testsRoot, 'lib', 'src', 'ui', 'components');

    const pageObjects = [
        ...scanDirectory(pageObjectsDir),
        ...scanDirectory(componentsDir),
    ];

    return {
        pageObjects,
        generatedAt: new Date().toISOString(),
    };
}

export function loadOrBuildApiSurface(testsRoot: string, config?: ApiSurfaceConfig): ApiSurfaceCatalog {
    if (!config?.enabled) {
        return {pageObjects: [], generatedAt: new Date().toISOString()};
    }

    const cachePath = config.cachePath
        ? join(testsRoot, config.cachePath)
        : join(testsRoot, '.e2e-ai-agents', 'api-surface.json');

    if (existsSync(cachePath)) {
        try {
            const cached = JSON.parse(readFileSync(cachePath, 'utf-8')) as ApiSurfaceCatalog;
            if (cached.pageObjects && Array.isArray(cached.pageObjects)) {
                return cached;
            }
        } catch {
            // Rebuild if cache is corrupt
        }
    }

    const catalog = buildApiSurface(testsRoot, config);

    try {
        const dir = join(cachePath, '..');
        if (existsSync(dir)) {
            writeFileSync(cachePath, JSON.stringify(catalog, null, 2), 'utf-8');
        }
    } catch {
        // Cache write failure is non-fatal
    }

    return catalog;
}

export function getMethodsForPageObject(catalog: ApiSurfaceCatalog, className: string): MethodSignature[] {
    const surface = catalog.pageObjects.find((po) => po.className === className);
    return surface?.methods || [];
}

export function validateMethodCall(catalog: ApiSurfaceCatalog, className: string, methodName: string): boolean {
    const methods = getMethodsForPageObject(catalog, className);
    return methods.some((m) => m.name === methodName);
}

export function formatApiSurfaceForPrompt(catalog: ApiSurfaceCatalog, classNames: string[]): string {
    const sections: string[] = [];
    for (const name of classNames) {
        const surface = catalog.pageObjects.find((po) => po.className === name);
        if (!surface) {
            continue;
        }
        const methodList = surface.methods
            .map((m) => {
                if (m.kind === 'property') {
                    return `  ${m.name} (property)`;
                }
                if (m.kind === 'getter') {
                    return `  get ${m.name}()`;
                }
                return `  ${m.name}()`;
            })
            .join('\n');
        sections.push(`${name}:\n${methodList}`);
    }
    return sections.join('\n\n');
}

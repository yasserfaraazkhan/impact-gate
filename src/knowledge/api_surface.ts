// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync, readdirSync, writeFileSync} from 'fs';
import {join, extname} from 'path';
import ts from 'typescript';

export interface MethodParam {
    name: string;
    type?: string;
    optional?: boolean;
}

export interface MethodSignature {
    name: string;
    kind: 'method' | 'property' | 'getter';
    params?: MethodParam[];
    returnType?: string;
    async?: boolean;
}

export interface PageObjectSurface {
    className: string;
    file: string;
    methods: MethodSignature[];
    /** Base class name if the class extends another */
    extends?: string;
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
    /** Use fast regex extraction instead of TypeScript AST (fallback mode) */
    useRegexFallback?: boolean;
}

// ── TypeScript AST-based extraction ────────────────────────

function extractMethodsFromAST(sourceFile: ts.SourceFile, checker: ts.TypeChecker | null): PageObjectSurface[] {
    const surfaces: PageObjectSurface[] = [];

    ts.forEachChild(sourceFile, (node) => {
        if (!ts.isClassDeclaration(node) || !node.name) {
            return;
        }

        const className = node.name.text;
        const methods: MethodSignature[] = [];
        const seen = new Set<string>();

        // Get base class name if extends
        let extendsName: string | undefined;
        if (node.heritageClauses) {
            for (const clause of node.heritageClauses) {
                if (clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.length > 0) {
                    const expr = clause.types[0].expression;
                    if (ts.isIdentifier(expr)) {
                        extendsName = expr.text;
                    }
                }
            }
        }

        for (const member of node.members) {
            // Skip constructor
            if (ts.isConstructorDeclaration(member)) {
                continue;
            }

            // Skip private/protected members
            const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
            if (modifiers?.some((m: ts.Modifier) =>
                m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
            )) {
                continue;
            }

            const name = member.name && ts.isIdentifier(member.name) ? member.name.text : null;
            if (!name || name.startsWith('_') || seen.has(name)) {
                continue;
            }
            seen.add(name);

            if (ts.isMethodDeclaration(member)) {
                const isAsync = modifiers?.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
                const params = extractParams(member.parameters, checker);
                const returnType = extractReturnType(member, checker);
                methods.push({
                    name,
                    kind: 'method',
                    async: isAsync ? true : undefined,
                    params: params.length > 0 ? params : undefined,
                    returnType: returnType || undefined,
                });
            } else if (ts.isGetAccessorDeclaration(member)) {
                methods.push({name, kind: 'getter'});
            } else if (ts.isPropertyDeclaration(member)) {
                // Check if it's an arrow function property (e.g., name = async () => {})
                if (member.initializer && (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))) {
                    const fn = member.initializer;
                    const fnModifiers = ts.canHaveModifiers(fn) ? ts.getModifiers(fn) : undefined;
                    const isAsync = fnModifiers?.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
                    const params = extractParams(fn.parameters, checker);
                    methods.push({
                        name,
                        kind: 'method',
                        async: isAsync ? true : undefined,
                        params: params.length > 0 ? params : undefined,
                    });
                } else {
                    methods.push({name, kind: 'property'});
                }
            }
        }

        if (methods.length > 0) {
            surfaces.push({
                className,
                file: sourceFile.fileName,
                methods,
                extends: extendsName,
            });
        }
    });

    return surfaces;
}

function extractParams(params: ts.NodeArray<ts.ParameterDeclaration>, checker: ts.TypeChecker | null): MethodParam[] {
    return params.map((p) => {
        const name = ts.isIdentifier(p.name) ? p.name.text : p.name.getText();
        const optional = p.questionToken !== undefined || p.initializer !== undefined;
        let type: string | undefined;
        if (p.type) {
            type = p.type.getText();
        } else if (checker) {
            try {
                const symbol = checker.getSymbolAtLocation(p.name);
                if (symbol) {
                    const t = checker.getTypeOfSymbolAtLocation(symbol, p);
                    type = checker.typeToString(t);
                }
            } catch {
                // Type inference failure is non-fatal
            }
        }
        return {name, type, optional: optional || undefined};
    });
}

function extractReturnType(method: ts.MethodDeclaration, checker: ts.TypeChecker | null): string | null {
    if (method.type) {
        return method.type.getText();
    }
    if (checker) {
        try {
            const signature = checker.getSignatureFromDeclaration(method);
            if (signature) {
                const returnType = checker.getReturnTypeOfSignature(signature);
                const typeStr = checker.typeToString(returnType);
                // Skip overly verbose inferred types
                if (typeStr.length < 100) {
                    return typeStr;
                }
            }
        } catch {
            // Type inference failure is non-fatal
        }
    }
    return null;
}

/**
 * Extract page objects using the TypeScript Compiler API.
 * Falls back to regex if compilation fails.
 */
function extractWithAST(files: string[]): PageObjectSurface[] {
    if (files.length === 0) {
        return [];
    }

    // Find the nearest tsconfig.json
    const firstDir = join(files[0], '..');
    const tsconfigPath = ts.findConfigFile(firstDir, ts.sys.fileExists, 'tsconfig.json');

    let program: ts.Program;
    if (tsconfigPath) {
        const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
        const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, join(tsconfigPath, '..'));
        // Only compile the files we care about, using the config's compiler options
        program = ts.createProgram(files, parsedConfig.options);
    } else {
        program = ts.createProgram(files, {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            strict: true,
            allowJs: false,
            noEmit: true,
        });
    }

    const checker = program.getTypeChecker();
    const surfaces: PageObjectSurface[] = [];

    for (const filePath of files) {
        const sourceFile = program.getSourceFile(filePath);
        if (!sourceFile) {
            continue;
        }
        surfaces.push(...extractMethodsFromAST(sourceFile, checker));
    }

    // Resolve inherited methods: if class extends another class in the catalog,
    // merge parent methods that the child doesn't override
    resolveInheritance(surfaces);

    return surfaces;
}

/**
 * Merge parent class methods into child classes that extend them.
 */
function resolveInheritance(surfaces: PageObjectSurface[]): void {
    const byName = new Map(surfaces.map((s) => [s.className, s]));

    for (const surface of surfaces) {
        if (!surface.extends) {
            continue;
        }
        const parent = byName.get(surface.extends);
        if (!parent) {
            continue;
        }
        const childMethodNames = new Set(surface.methods.map((m) => m.name));
        for (const parentMethod of parent.methods) {
            if (!childMethodNames.has(parentMethod.name)) {
                surface.methods.push({...parentMethod});
            }
        }
    }
}

// ── Regex-based extraction (fallback) ──────────────────────

const RESERVED_WORDS = new Set([
    'private', 'protected', 'static', 'abstract', 'override',
    'if', 'for', 'while', 'switch', 'return',
    'const', 'let', 'var', 'import', 'export',
    'class', 'type', 'interface', 'constructor',
]);

function extractMethodsFromRegex(content: string): MethodSignature[] {
    const methods: MethodSignature[] = [];
    const seen = new Set<string>();

    const asyncMethodRe = /(?:async\s+)([a-zA-Z_]\w*)\s*\(/g;
    let match;
    while ((match = asyncMethodRe.exec(content)) !== null) {
        const name = match[1];
        if (!RESERVED_WORDS.has(name) && !seen.has(name)) {
            seen.add(name);
            methods.push({name, kind: 'method', async: true});
        }
    }

    const methodRe = /^\s+(?:readonly\s+)?([a-zA-Z_]\w*)\s*(?:\(|=\s*(?:async\s*)?\()/gm;
    while ((match = methodRe.exec(content)) !== null) {
        const name = match[1];
        if (!RESERVED_WORDS.has(name) && !seen.has(name)) {
            seen.add(name);
            const isAsync = match[0].includes('async');
            methods.push({name, kind: 'method', async: isAsync ? true : undefined});
        }
    }

    const arrowRe = /^\s+([a-zA-Z_]\w*)\s*=\s*(async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/gm;
    while ((match = arrowRe.exec(content)) !== null) {
        const name = match[1];
        if (!RESERVED_WORDS.has(name) && !seen.has(name)) {
            seen.add(name);
            methods.push({name, kind: 'method', async: match[2] ? true : undefined});
        }
    }

    const getterRe = /\bget\s+([a-zA-Z_]\w*)\s*\(\)/g;
    while ((match = getterRe.exec(content)) !== null) {
        const name = match[1];
        if (!seen.has(name)) {
            seen.add(name);
            methods.push({name, kind: 'getter'});
        }
    }

    const propRe = /^\s+(?:readonly\s+)?([a-zA-Z_]\w*)\s*[:=]/gm;
    while ((match = propRe.exec(content)) !== null) {
        const name = match[1];
        if (!RESERVED_WORDS.has(name) && !seen.has(name)) {
            seen.add(name);
            methods.push({name, kind: 'property'});
        }
    }

    return methods;
}

function extractClassName(content: string): string | null {
    const match = content.match(/(?:export\s+)?class\s+(\w+)/);
    return match ? match[1] : null;
}

// ── Directory scanning ─────────────────────────────────────

function collectTypeScriptFiles(dir: string): string[] {
    const files: string[] = [];
    if (!existsSync(dir)) {
        return files;
    }

    const entries = readdirSync(dir, {withFileTypes: true});
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectTypeScriptFiles(fullPath));
            continue;
        }
        const ext = extname(entry.name);
        if (ext === '.ts' || ext === '.tsx') {
            files.push(fullPath);
        }
    }
    return files;
}

function scanDirectoryWithRegex(dir: string): PageObjectSurface[] {
    const surfaces: PageObjectSurface[] = [];
    if (!existsSync(dir)) {
        return surfaces;
    }

    const entries = readdirSync(dir, {withFileTypes: true});
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            surfaces.push(...scanDirectoryWithRegex(fullPath));
            continue;
        }
        const ext = extname(entry.name);
        if (ext !== '.ts' && ext !== '.tsx') {
            continue;
        }
        try {
            const content = readFileSync(fullPath, 'utf-8');
            const className = extractClassName(content);
            if (!className) {
                continue;
            }
            const extractedMethods = extractMethodsFromRegex(content);
            if (extractedMethods.length > 0) {
                surfaces.push({className, file: fullPath, methods: extractedMethods});
            }
        } catch {
            continue;
        }
    }
    return surfaces;
}

// ── Public API ──────────────────────────────────────────────

export function buildApiSurface(testsRoot: string, config?: ApiSurfaceConfig): ApiSurfaceCatalog {
    const pageObjectsDir = config?.pageObjectsDir
        ? join(testsRoot, config.pageObjectsDir)
        : join(testsRoot, 'lib', 'src', 'ui', 'pages');
    const componentsDir = config?.componentsDir
        ? join(testsRoot, config.componentsDir)
        : join(testsRoot, 'lib', 'src', 'ui', 'components');

    let pageObjects: PageObjectSurface[];

    if (config?.useRegexFallback) {
        pageObjects = [
            ...scanDirectoryWithRegex(pageObjectsDir),
            ...scanDirectoryWithRegex(componentsDir),
        ];
    } else {
        // Use TypeScript AST — full type info, inheritance, params
        const allFiles = [
            ...collectTypeScriptFiles(pageObjectsDir),
            ...collectTypeScriptFiles(componentsDir),
        ];

        try {
            pageObjects = extractWithAST(allFiles);
        } catch {
            // Fall back to regex if AST extraction fails
            pageObjects = [
                ...scanDirectoryWithRegex(pageObjectsDir),
                ...scanDirectoryWithRegex(componentsDir),
            ];
        }
    }

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
                const prefix = m.async ? 'async ' : '';
                const paramStr = m.params
                    ? m.params.map((p) => `${p.name}${p.optional ? '?' : ''}${p.type ? `: ${p.type}` : ''}`).join(', ')
                    : '';
                const retStr = m.returnType ? `: ${m.returnType}` : '';
                return `  ${prefix}${m.name}(${paramStr})${retStr}`;
            })
            .join('\n');
        sections.push(`${name}:\n${methodList}`);
    }
    return sections.join('\n\n');
}

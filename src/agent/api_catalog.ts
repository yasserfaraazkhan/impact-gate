// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {existsSync, readFileSync, readdirSync} from 'fs';
import {join} from 'path';
import type {ApiSurfaceCatalog, InitSetupBinding} from './pipeline_types.js';

export function createDefaultApiSurfaceCatalog(): ApiSurfaceCatalog {
    const pwNestedMethods = new Map<string, Set<string>>();
    pwNestedMethods.set('apiClient', new Set([
        'createPost',
        'createDirectChannel',
        'createChannel',
        'getChannels',
        'getChannelByName',
        'getPostsSince',
    ]));
    return {
        pwProps: new Set([
            'initSetup',
            'testBrowser',
            'apiInitSetup',
            'apiAdminSetup',
            'apiCreateChannel',
            'apiCreateUser',
            'apiLogin',
            'apiClient',
        ]),
        pwNestedMethods,
        initSetupKeys: new Set([
            'user',
            'team',
            'adminClient',
            'adminUser',
            'adminConfig',
            'userClient',
            'offTopicUrl',
            'townSquareUrl',
        ]),
        initSetupVariableMethods: new Map<string, Set<string>>(),
        testBrowserMethods: new Set([
            'login',
            'openNewBrowserContext',
            'newContext',
        ]),
        channelsPageMembers: new Set([
            'goto',
            'page',
            'postMessage',
            'getLastPost',
            'sidebarRight',
            'openChannelSettings',
            'newChannel',
            'globalHeader',
            'searchBox',
        ]),
        sidebarRightMembers: new Set([
            'openThreadForPost',
            'postMessage',
            'getLastPost',
        ]),
    };
}

export function collectMatches(content: string, pattern: RegExp): Set<string> {
    const out = new Set<string>();
    for (const match of content.matchAll(pattern)) {
        const value = match[1];
        if (value) {
            out.add(value);
        }
    }
    return out;
}

export function addNestedMethod(catalog: ApiSurfaceCatalog, objectName: string, methodName: string): void {
    const methods = catalog.pwNestedMethods.get(objectName) || new Set<string>();
    methods.add(methodName);
    catalog.pwNestedMethods.set(objectName, methods);
}

export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseInitSetupBindings(content: string): InitSetupBinding[] {
    const bindings: InitSetupBinding[] = [];
    for (const match of content.matchAll(/(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*await\s+pw\.initSetup\s*\(/g)) {
        const raw = match[1];
        if (!raw) {
            continue;
        }
        for (const part of raw.split(',')) {
            const cleaned = part.trim();
            if (!cleaned) {
                continue;
            }
            const [leftRaw, rightRaw] = cleaned.split(':');
            const key = (leftRaw || '').trim();
            const variableCandidate = (rightRaw || leftRaw || '').trim().split('=')[0]?.trim();
            if (!key || !variableCandidate) {
                continue;
            }
            bindings.push({key, variable: variableCandidate});
        }
    }
    return bindings;
}

export function collectDestructuredInitSetupKeys(content: string): Set<string> {
    return new Set(parseInitSetupBindings(content).map((binding) => binding.key));
}

export function addInitSetupVariableMethod(
    catalog: ApiSurfaceCatalog,
    variable: string,
    methodName: string,
): void {
    const methods = catalog.initSetupVariableMethods.get(variable) || new Set<string>();
    methods.add(methodName);
    catalog.initSetupVariableMethods.set(variable, methods);
}

export function collectApiSurfaceFromContent(content: string, catalog: ApiSurfaceCatalog): void {
    for (const prop of collectMatches(content, /\bpw\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        catalog.pwProps.add(prop);
    }
    for (const match of content.matchAll(/\bpw\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        const objectName = match[1];
        const methodName = match[2];
        if (!objectName || !methodName) {
            continue;
        }
        addNestedMethod(catalog, objectName, methodName);
    }
    for (const method of collectMatches(content, /\bpw\.testBrowser\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        catalog.testBrowserMethods.add(method);
    }
    for (const member of collectMatches(content, /\bchannelsPage\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        catalog.channelsPageMembers.add(member);
    }
    for (const member of collectMatches(content, /\bchannelsPage\.sidebarRight\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        catalog.sidebarRightMembers.add(member);
    }
    for (const binding of parseInitSetupBindings(content)) {
        catalog.initSetupKeys.add(binding.key);
        const methodPattern = new RegExp(`\\b${escapeRegExp(binding.variable)}\\.([A-Za-z_][A-Za-z0-9_]*)\\b`, 'g');
        for (const method of collectMatches(content, methodPattern)) {
            addInitSetupVariableMethod(catalog, binding.variable, method);
        }
    }
}

export function buildApiSurfaceCatalog(testsRoot: string, seedFile: string): ApiSurfaceCatalog {
    const catalog = createDefaultApiSurfaceCatalog();
    const candidateRoots = [
        join(testsRoot, 'specs'),
        join(testsRoot, 'tests'),
    ];

    const files: string[] = [];
    for (const root of candidateRoots) {
        if (!existsSync(root)) {
            continue;
        }
        const stack = [root];
        while (stack.length > 0) {
            const current = stack.pop()!;
            let entries: import('fs').Dirent[];
            try {
                entries = readdirSync(current, {withFileTypes: true});
            } catch {
                continue;
            }
            for (const entry of entries) {
                const full = join(current, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
                        continue;
                    }
                    stack.push(full);
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }
                if (!/\.(spec|test)\.[jt]sx?$/.test(entry.name)) {
                    continue;
                }
                files.push(full);
            }
        }
    }

    const uniqueFiles = Array.from(new Set(files)).slice(0, 2500);
    for (const filePath of uniqueFiles) {
        try {
            const content = readFileSync(filePath, 'utf-8');
            collectApiSurfaceFromContent(content, catalog);
        } catch {
            continue;
        }
    }

    const absoluteSeed = join(testsRoot, seedFile);
    if (existsSync(absoluteSeed)) {
        try {
            collectApiSurfaceFromContent(readFileSync(absoluteSeed, 'utf-8'), catalog);
        } catch {
            // ignore seed read failures; defaults + catalog scan still apply
        }
    }
    return catalog;
}

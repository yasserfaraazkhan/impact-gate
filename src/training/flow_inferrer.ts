// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * User Flow Inferrer
 *
 * Extracts human-readable user flow descriptions from three sources:
 *   1. Playwright/Cypress test scenario titles (highest quality)
 *   2. Go API handler function names (server-side flows)
 *   3. Webapp component directory names (fallback)
 *
 * All deterministic — no LLM, no network, no cost.
 *
 * These flow descriptions serve two purposes:
 *   - Humans read them in review output to understand what's tested/untested
 *   - AI test generators read them as specifications for E2E test generation
 */

import {existsSync, readdirSync, readFileSync, lstatSync} from 'fs';
import {join, basename, resolve} from 'path';

import {extractScenarios} from '../engine/impact_engine.js';
import type {ScannedFamily} from './types.js';

/** Maximum user flows per family to keep output scannable */
const MAX_FLOWS_PER_FAMILY = 8;

// ─── Source 1: Test Scenario Titles ───

/**
 * Extract user flows from Playwright/Cypress spec files.
 * These are the highest-quality flow descriptions because test authors
 * write them in human-readable language.
 */
function inferFlowsFromSpecs(specDirs: string[], testsRoot: string): string[] {
    const flows: string[] = [];
    const resolved = resolve(testsRoot);

    for (const dir of specDirs) {
        const fullDir = join(resolved, dir);
        if (!existsSync(fullDir)) continue;

        const specFiles = findSpecFiles(fullDir);
        for (const specFile of specFiles) {
            let scenarios = extractScenarios(specFile, 'playwright');
            if (scenarios.length === 0) {
                scenarios = extractScenarios(specFile, 'cypress');
            }

            for (const scenario of scenarios) {
                const cleaned = cleanScenarioTitle(scenario);
                if (cleaned && cleaned.length > 5) {
                    flows.push(cleaned);
                }
            }
        }
    }

    return deduplicateFlows(flows);
}

/** Recursively find spec files */
function findSpecFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        const entries = readdirSync(dir, {withFileTypes: true});
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                files.push(...findSpecFiles(full));
            } else if (entry.isFile() && /\.(spec|test)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
                files.push(full);
            }
        }
    } catch {
        // Directory not readable
    }
    return files;
}

/**
 * Clean a test scenario title into a user flow description.
 *
 * "MM-T5424 Find channel search returns only 50 results" → "Find channel search returns only 50 results"
 * "Should be able to change threads with arrow keys" → "Change threads with arrow keys"
 */
function cleanScenarioTitle(title: string): string {
    let cleaned = title
        .replace(/^MM[-_]T?\d+[_\s]*/i, '')
        .replace(/^\d+[_\s]+/, '')
        .replace(/^should\s+be\s+able\s+to\s+/i, '')
        .replace(/^should\s+/i, '')
        .replace(/^(?:verify|check|ensure|confirm|validate)\s+(?:that\s+)?/i, '')
        .replace(/^it\s+/i, '')
        .trim();

    if (cleaned.length > 0) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    return cleaned;
}

// ─── Source 2: Go API Handler Function Names ───

/**
 * Extract user flows from Go API handler function names.
 * Go handlers follow verbNoun naming (e.g., createChannel, pinPost).
 */
function inferFlowsFromHandlers(serverPaths: string[], projectRoot: string): string[] {
    const flows: string[] = [];
    const resolved = resolve(projectRoot);

    for (const serverPath of serverPaths) {
        // Server paths may contain globs (e.g., "server/channels/api4/channel*.go")
        // Strip glob characters to get the directory, then scan for matching Go files
        const cleanPath = serverPath.replace(/\*+/g, '').replace(/\/+$/g, '');
        const fullPath = join(resolved, cleanPath);

        // If it's an exact file path (no glob was present and file exists)
        if (serverPath === cleanPath && existsSync(fullPath)) {
            let stat;
            try {
                stat = lstatSync(fullPath);
            } catch {
                continue;
            }
            if (stat.isDirectory()) {
                const goFiles = findGoHandlerFiles(fullPath);
                for (const goFile of goFiles) {
                    flows.push(...extractGoHandlerFlows(goFile));
                }
            } else if (fullPath.endsWith('.go') && !fullPath.endsWith('_test.go')) {
                flows.push(...extractGoHandlerFlows(fullPath));
            }
        } else {
            // Glob path — extract the directory and find matching Go files
            const dirPath = fullPath.replace(/[^/]*$/, '').replace(/\/+$/, '');
            if (!existsSync(dirPath)) continue;
            const prefix = cleanPath.split('/').pop() || '';
            const goFiles = findGoHandlerFiles(dirPath)
                .filter((f) => !prefix || basename(f).startsWith(prefix));
            for (const goFile of goFiles.slice(0, 3)) {
                flows.push(...extractGoHandlerFlows(goFile));
            }
        }
    }

    return deduplicateFlows(flows);
}

/** Find Go handler files (not tests, not local variants) */
function findGoHandlerFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        const entries = readdirSync(dir, {withFileTypes: true});
        for (const entry of entries) {
            if (entry.isFile()
                && entry.name.endsWith('.go')
                && !entry.name.endsWith('_test.go')
                && !entry.name.endsWith('_local.go')) {
                files.push(join(dir, entry.name));
            }
        }
    } catch {
        // Not readable
    }
    return files;
}

/** Extract handler function names from a Go file and convert to flow descriptions */
function extractGoHandlerFlows(filePath: string): string[] {
    let content: string;
    try {
        content = readFileSync(filePath, 'utf-8');
    } catch {
        return [];
    }

    const flows: string[] = [];
    const handlerRe = /func\s+\([^)]+\)\s+([a-z][a-zA-Z0-9]+)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = handlerRe.exec(content)) !== null) {
        const funcName = match[1];
        if (SKIP_HANDLER_NAMES.has(funcName)) continue;
        if (funcName.startsWith('init') || funcName.startsWith('setup')) continue;

        const flow = camelCaseToFlow(funcName);
        if (flow && flow.length > 3) {
            flows.push(flow);
        }
    }

    return flows;
}

const SKIP_HANDLER_NAMES = new Set([
    'ServeHTTP', 'init', 'close', 'start', 'stop', 'shutdown',
    'handleError', 'writeJSON', 'readJSON', 'parseRequest',
    'checkPermission', 'requireAuth', 'checkAuth',
    'logError', 'logDebug', 'logInfo', 'logWarn',
    'sanitize', 'validate', 'normalize',
]);

/**
 * Convert camelCase function name to human-readable flow.
 * createChannel → "Create a channel"
 * getChannelMembers → "Get channel members"
 * pinPost → "Pin a post"
 */
function camelCaseToFlow(name: string): string {
    const words = name
        .replace(/([A-Z])/g, ' $1')
        .trim()
        .toLowerCase()
        .split(/\s+/);

    if (words.length === 0) return '';

    words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);

    const verb = words[0].toLowerCase();
    if (words.length === 2 && VERBS_NEEDING_ARTICLE.has(verb)) {
        const noun = words[1];
        const article = /^[aeiou]/i.test(noun) ? 'an' : 'a';
        return `${words[0]} ${article} ${noun}`;
    }

    return words.join(' ');
}

const VERBS_NEEDING_ARTICLE = new Set([
    'create', 'delete', 'remove', 'add', 'get', 'pin', 'unpin',
    'archive', 'restore', 'move', 'burn', 'reveal',
]);

// ─── Source 3: Webapp Component Names ───

/**
 * Extract user flows from webapp component directory names.
 * Lowest quality but useful as fallback when no tests or handlers exist.
 */
function inferFlowsFromComponents(webappPaths: string[]): string[] {
    const flows: string[] = [];
    const seen = new Set<string>();

    for (const webappPath of webappPaths) {
        const componentName = extractComponentName(webappPath);
        if (!componentName || seen.has(componentName)) continue;
        seen.add(componentName);

        if (SKIP_COMPONENT_NAMES.has(componentName)) continue;

        const flow = componentNameToFlow(componentName);
        if (flow && flow.length > 5) {
            flows.push(flow);
        }
    }

    return deduplicateFlows(flows);
}

/** Extract the meaningful component directory name from a path/glob */
function extractComponentName(path: string): string | null {
    const clean = path.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\/+$/g, '');
    const parts = clean.split('/').filter(Boolean);

    for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        // Skip file names (anything with a file extension) — only use directory names
        if (/\.\w+$/.test(part)) continue;
        if (!STRUCTURAL_PATH_SEGMENTS.has(part) && part.length > 2) {
            return part;
        }
    }
    return null;
}

const STRUCTURAL_PATH_SEGMENTS = new Set([
    'src', 'components', 'webapp', 'channels', 'platform', 'packages',
    'actions', 'reducers', 'selectors', 'hooks', 'utils', 'lib',
    'common', 'shared', 'styles',
]);

const SKIP_COMPONENT_NAMES = new Set([
    'root', 'app', 'index', 'main', 'layout', 'wrapper',
    'provider', 'context', 'store', 'theme_provider',
    'error_page', 'loading_screen', 'spinner_button',
    'with_tooltip', 'with_error_boundary', 'async_load',
]);

const COMPONENT_SUFFIX_VERBS: Array<[string, string]> = [
    ['_modal', 'Open'],
    ['_dialog', 'Open'],
    ['_picker', 'Select from'],
    ['_selector', 'Select from'],
    ['_dropdown', 'Select from'],
    ['_rhs', 'View'],
    ['_sidebar', 'Navigate'],
    ['_header', 'View'],
    ['_form', 'Fill out'],
    ['_list', 'View'],
    ['_viewer', 'View'],
    ['_preview', 'Preview'],
    ['_editor', 'Edit'],
    ['_settings', 'Configure'],
];

/**
 * Convert a component directory name to a flow description.
 * channel_settings_modal → "Configure channel settings"
 * emoji_picker → "Select from emoji picker"
 */
function componentNameToFlow(name: string): string {
    for (const [suffix, verb] of COMPONENT_SUFFIX_VERBS) {
        if (name.endsWith(suffix)) {
            const stem = name.slice(0, -suffix.length).replace(/_/g, ' ');
            return `${verb} ${stem}${suffix === '_modal' || suffix === '_dialog' ? ' dialog' : ''}`;
        }
    }

    const humanized = name.replace(/_/g, ' ');
    return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

// ─── Main entry point ───

/**
 * Infer user flow descriptions for a scanned family from all available sources.
 * Priority: specs > handlers > components. Cap at MAX_FLOWS_PER_FAMILY.
 */
export function inferUserFlows(
    family: ScannedFamily,
    projectRoot: string,
    testsRoot: string,
): string[] {
    const allFlows: string[] = [];

    // Source 1: Test scenarios (highest quality)
    const specFlows = inferFlowsFromSpecs(
        [...family.specDirs, ...family.cypressSpecDirs],
        testsRoot,
    );
    allFlows.push(...specFlows);

    // Source 2: Go handler function names
    if (family.serverPaths.length > 0) {
        const handlerFlows = inferFlowsFromHandlers(family.serverPaths, projectRoot);
        for (const flow of handlerFlows) {
            if (!allFlows.some((existing) => isSimilarFlow(existing, flow))) {
                allFlows.push(flow);
            }
        }
    }

    // Source 3: Component names (fallback — only if sparse)
    if (allFlows.length < 3 && family.webappPaths.length > 0) {
        const componentFlows = inferFlowsFromComponents(family.webappPaths);
        for (const flow of componentFlows) {
            if (!allFlows.some((existing) => isSimilarFlow(existing, flow))) {
                allFlows.push(flow);
            }
        }
    }

    return allFlows.slice(0, MAX_FLOWS_PER_FAMILY);
}

// ─── Helpers ───

function deduplicateFlows(flows: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const flow of flows) {
        const key = flow.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(flow);
        }
    }
    return unique;
}

/** Check if two flow descriptions are semantically similar via word overlap */
function isSimilarFlow(a: string, b: string): boolean {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    const trivial = new Set(['a', 'an', 'the', 'to', 'in', 'on', 'for', 'of', 'by', 'with', 'from', 'is', 'be']);
    let overlap = 0;
    let total = 0;

    for (const word of wordsA) {
        if (trivial.has(word) || word.length < 3) continue;
        total++;
        if (wordsB.has(word)) overlap++;
    }

    return total > 0 && overlap / total > 0.6;
}

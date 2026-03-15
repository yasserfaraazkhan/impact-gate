// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {lstatSync, readdirSync, readFileSync} from 'fs';
import {join, relative, resolve} from 'path';

import type {LLMProvider} from '../provider_interface.js';
import type {RouteFamily} from '../knowledge/route_families.js';

import {isGuessedRoute} from './types.js';
import type {EnrichmentResult, ScannedFamily} from './types.js';

const MAX_FILES_PER_FAMILY = 20;
const MAX_LINES_PER_FILE = 50;
const LLM_TIMEOUT_MS = 60_000;
const MAX_PROMPT_CHARS = 100_000;

const SENSITIVE_PATTERNS = [
    /[._]env/, /secret/i, /credential/i, /\.pem$/, /\.key$/, /password/i,
    /config\/secrets/, /fixtures\/.*auth/i, /\.npmrc/, /\.netrc/,
    /id_rsa/, /id_ed25519/, /\.p12$/, /\.pfx$/, /tokens?\.json/i,
];

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage',
]);

function sampleFiles(dir: string, maxFiles: number): Array<{path: string; content: string}> {
    const files: Array<{path: string; content: string}> = [];

    function walk(d: string, depth = 0, maxDepth = 10): void {
        if (files.length >= maxFiles) return;
        if (depth > maxDepth) return;
        try {
            for (const entry of readdirSync(d)) {
                if (files.length >= maxFiles) return;

                // Skip dot-dirs and known heavy directories
                if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;

                const full = join(d, entry);
                try {
                    // Skip symlinks
                    const lstat = lstatSync(full);
                    if (lstat.isSymbolicLink()) continue;

                    // Skip sensitive files (test against relative path from scan root)
                    const relPath = relative(dir, full);
                    if (SENSITIVE_PATTERNS.some((p) => p.test(relPath) || p.test(entry))) continue;

                    if (lstat.isDirectory()) {
                        walk(full, depth + 1, maxDepth);
                    } else if (lstat.isFile() && lstat.size < 50000) {
                        const ext = entry.slice(entry.lastIndexOf('.'));
                        if (['.ts', '.tsx', '.js', '.jsx', '.go', '.py', '.rs'].includes(ext)) {
                            const content = readFileSync(full, 'utf-8');
                            const lines = content.split('\n').slice(0, MAX_LINES_PER_FILE).join('\n');
                            files.push({path: full, content: lines});
                        }
                    }
                } catch { /* skip */ }
            }
        } catch { /* skip */ }
    }

    walk(dir);
    return files;
}

/**
 * Build a shallow directory listing of the source tree (depth 2-3) so the LLM
 * can suggest accurate webappPaths / serverPaths for test-derived families.
 */
function getSourceTreeListing(projectRoot: string, maxDepth = 3): string {
    const lines: string[] = [];
    function walk(dir: string, depth: number, prefix: string): void {
        if (depth > maxDepth || lines.length > 200) return;
        let entries: string[];
        try { entries = readdirSync(dir).sort(); } catch { return; }
        const dirs = entries.filter((e) => {
            if (e.startsWith('.') || SKIP_DIRS.has(e)) return false;
            try {
                const stat = lstatSync(join(dir, e));
                return !stat.isSymbolicLink() && stat.isDirectory();
            } catch { return false; }
        });
        for (const d of dirs) {
            lines.push(`${prefix}${d}/`);
            walk(join(dir, d), depth + 1, prefix + '  ');
        }
    }
    walk(resolve(projectRoot), 0, '');
    return lines.join('\n');
}

function buildEnrichPrompt(families: ScannedFamily[], projectRoot: string, testsRoot?: string): string {
    const sections: string[] = [];
    const hasTestOnlyFamilies = families.some((f) => f.webappPaths.length === 0 && f.serverPaths.length === 0);
    const resolvedTestsRoot = testsRoot ? resolve(testsRoot) : resolve(projectRoot);

    for (const family of families) {
        const isTestOnly = family.webappPaths.length === 0 && family.serverPaths.length === 0;
        const allDirs = [
            ...family.webappPaths.map((p) => p.replace(/\/?\*.*$/, '')),
            ...family.serverPaths.map((p) => p.replace(/\/?\*.*$/, '')),
        ];

        const samples: Array<{path: string; content: string}> = [];
        for (const dir of allDirs) {
            if (!dir) continue;
            const fullDir = join(resolve(projectRoot), dir);
            samples.push(...sampleFiles(fullDir, MAX_FILES_PER_FAMILY - samples.length));
            if (samples.length >= MAX_FILES_PER_FAMILY) break;
        }

        // For test-only families, sample the test files themselves for richer context
        if (isTestOnly) {
            for (const specDir of family.specDirs) {
                if (samples.length >= MAX_FILES_PER_FAMILY) break;
                const fullDir = join(resolvedTestsRoot, specDir);
                samples.push(...sampleFiles(fullDir, MAX_FILES_PER_FAMILY - samples.length));
            }
        }

        // Sample spec descriptions
        const specSamples: string[] = [];
        for (const specDir of family.specDirs) {
            const fullDir = join(resolvedTestsRoot, specDir);
            const specFiles = sampleFiles(fullDir, 5);
            for (const sf of specFiles) {
                const matches = sf.content.match(/(?:test|it|describe)\s*\(\s*['"`]([^'"`]+)/g);
                if (matches) {
                    specSamples.push(...matches.map((m) => m.replace(/(?:test|it|describe)\s*\(\s*['"`]/, '')));
                }
            }
        }

        sections.push(`## Family: ${family.id}${isTestOnly ? ' [TEST-ONLY — needs webappPaths/serverPaths]' : ''}
Routes (guessed): ${JSON.stringify(family.routes)}
Webapp paths: ${JSON.stringify(family.webappPaths)}
Server paths: ${JSON.stringify(family.serverPaths)}
Spec dirs: ${JSON.stringify(family.specDirs)}
Tags: ${JSON.stringify(family.tags)}
Features: ${family.features.map((f) => f.id).join(', ') || 'none'}

Sample files (${samples.length}):
${samples.map((s) => `### ${relative(projectRoot, s.path)}\n\`\`\`\n${s.content}\n\`\`\``).join('\n')}

Test descriptions:
${specSamples.length > 0 ? specSamples.map((d) => `- ${d}`).join('\n') : '(none found)'}
`);
    }

    // Include source tree listing when we have test-only families
    const sourceTreeSection = hasTestOnlyFamilies
        ? `\n## Source Directory Structure\nUse this to suggest accurate webappPaths and serverPaths for test-only families:\n\`\`\`\n${getSourceTreeListing(projectRoot)}\n\`\`\`\n`
        : '';

    return `You are analyzing a codebase to enrich route-family definitions for an E2E test impact analysis tool.

For each family below, provide:
1. **priority**: P0 (critical user flow), P1 (important), or P2 (nice-to-have)
2. **userFlows**: Array of human-readable flow names (e.g., "Create channel", "Search messages")
3. **routes**: Improved URL patterns (e.g., "/{team}/channels/{channel}" instead of "/channels")
4. **pageObjects**: Array of page object class names found in the code
5. **components**: Array of UI component names relevant to this family
6. **webappPaths**: Array of glob patterns for frontend source directories (e.g., "src/components/drafts/**"). REQUIRED for families marked [TEST-ONLY].
7. **serverPaths**: Array of glob patterns for backend source directories. REQUIRED for families marked [TEST-ONLY].

Respond in JSON format:
\`\`\`json
[
  {
    "id": "family_id",
    "priority": "P0",
    "userFlows": ["Flow name 1", "Flow name 2"],
    "routes": ["/improved/route/{param}"],
    "pageObjects": ["PageName"],
    "components": ["ComponentName"],
    "webappPaths": ["src/components/feature_name/**"],
    "serverPaths": ["server/channels/api4/feature.go"]
  }
]
\`\`\`
${sourceTreeSection}
${sections.join('\n---\n')}`;
}

export interface EnrichedEntry {
    id: string;
    priority?: 'P0' | 'P1' | 'P2';
    userFlows?: string[];
    routes?: string[];
    pageObjects?: string[];
    components?: string[];
    webappPaths?: string[];
    serverPaths?: string[];
}

export function validateEntries(parsed: unknown[]): EnrichedEntry[] {
    const filterStrings = (arr: unknown, maxLen: number): string[] | undefined => {
        if (!Array.isArray(arr)) return undefined;
        const filtered = arr.filter((v: unknown) => typeof v === 'string' && v.length < maxLen);
        return filtered.length > 0 ? filtered : undefined;
    };

    return parsed
        .filter((e): e is Record<string, unknown> => !!e && typeof (e as Record<string, unknown>).id === 'string')
        .map((entry): EnrichedEntry => ({
            id: entry.id as string,
            priority: ['P0', 'P1', 'P2'].includes(entry.priority as string) ? entry.priority as 'P0' | 'P1' | 'P2' : undefined,
            routes: filterStrings(entry.routes, 200),
            userFlows: filterStrings(entry.userFlows, 500),
            pageObjects: filterStrings(entry.pageObjects, 200),
            components: filterStrings(entry.components, 200),
            webappPaths: filterStrings(entry.webappPaths, 300),
            serverPaths: filterStrings(entry.serverPaths, 300),
        }));
}

export function parseEnrichResponse(response: string): EnrichedEntry[] {
    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response];
    const jsonStr = jsonMatch[1]?.trim() || response.trim();
    try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
            return validateEntries(parsed);
        }
    } catch {
        // Try to find any JSON array in the response
        const arrayMatch = response.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try {
                const parsed = JSON.parse(arrayMatch[0]);
                if (Array.isArray(parsed)) {
                    return validateEntries(parsed);
                }
            } catch {
                // give up
            }
        }
    }
    return [];
}

function applyEnrichment(family: RouteFamily, enriched: EnrichedEntry): RouteFamily {
    const result = {...family};

    if (enriched.priority && !family.priority) {
        result.priority = enriched.priority;
    }
    if (enriched.userFlows && (!family.userFlows || family.userFlows.length === 0)) {
        result.userFlows = enriched.userFlows;
    }
    if (enriched.routes && enriched.routes.length > 0) {
        // Only replace if current routes look like guesses
        if (isGuessedRoute(family.routes)) {
            result.routes = enriched.routes;
        }
    }
    if (enriched.pageObjects && (!family.pageObjects || family.pageObjects.length === 0)) {
        result.pageObjects = enriched.pageObjects;
    }
    if (enriched.components && (!family.components || family.components.length === 0)) {
        result.components = enriched.components;
    }
    // Only fill source paths when the family has none (test-derived families)
    if (enriched.webappPaths && (!family.webappPaths || family.webappPaths.length === 0)) {
        result.webappPaths = enriched.webappPaths;
    }
    if (enriched.serverPaths && (!family.serverPaths || family.serverPaths.length === 0)) {
        result.serverPaths = enriched.serverPaths;
    }

    return result;
}

export async function enrichFamilies(
    families: RouteFamily[],
    scanned: ScannedFamily[],
    projectRoot: string,
    provider: LLMProvider,
    budgetUSD: number,
    testsRoot?: string,
): Promise<EnrichmentResult> {
    const scannedMap = new Map(scanned.map((s) => [s.id, s]));
    const enriched: RouteFamily[] = [];
    let totalTokens = 0;
    let totalCost = 0;
    let requestCount = 0;
    let totalResponseMs = 0;
    const skipped: string[] = [];

    // Process in chunks of 4 families
    const chunkSize = 4;
    for (let i = 0; i < families.length; i += chunkSize) {
        if (totalCost >= budgetUSD) {
            for (let j = i; j < families.length; j++) {
                skipped.push(families[j].id);
                enriched.push(families[j]);
            }
            break;
        }

        const chunk = families.slice(i, i + chunkSize);
        const scannedChunk = chunk
            .map((f) => scannedMap.get(f.id))
            .filter((s): s is ScannedFamily => s !== undefined);

        if (scannedChunk.length === 0) {
            enriched.push(...chunk);
            continue;
        }

        let prompt = buildEnrichPrompt(scannedChunk, projectRoot, testsRoot);
        if (prompt.length > MAX_PROMPT_CHARS) {
            // Truncate at the last complete section boundary to avoid malformed input
            const lastSectionEnd = prompt.lastIndexOf('\n---\n', MAX_PROMPT_CHARS);
            if (lastSectionEnd > 0) {
                console.warn(`[train] Prompt truncated from ${prompt.length} chars at section boundary`);
                prompt = prompt.slice(0, lastSectionEnd);
            } else {
                console.warn(`[train] Prompt truncated from ${prompt.length} to ${MAX_PROMPT_CHARS} chars`);
                prompt = prompt.slice(0, MAX_PROMPT_CHARS);
            }
        }

        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutTimer = setTimeout(() => reject(new Error('LLM request timed out')), LLM_TIMEOUT_MS);
            });
            const reqStart = performance.now();
            const response = await Promise.race([
                provider.generateText(prompt, {maxTokens: 4096, temperature: 0.3}),
                timeoutPromise,
            ]);
            totalResponseMs += performance.now() - reqStart;
            requestCount++;

            totalTokens += (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);
            totalCost += response.cost ?? 0;

            const entries = parseEnrichResponse(response.text);
            const entryMap = new Map(entries.map((e) => [e.id, e]));

            for (const family of chunk) {
                const entry = entryMap.get(family.id);
                if (entry) {
                    enriched.push(applyEnrichment(family, entry));
                } else {
                    enriched.push(family);
                }
            }
        } catch (error) {
            // On LLM failure, keep families unchanged
            console.warn(`[train] LLM enrichment failed for chunk: ${error instanceof Error ? error.message : String(error)}`);
            enriched.push(...chunk);
        } finally {
            if (timeoutTimer) clearTimeout(timeoutTimer);
        }
    }

    return {
        enrichedFamilies: enriched,
        tokensUsed: totalTokens,
        costUSD: Math.round(totalCost * 100) / 100,
        skippedFamilies: skipped,
        requestCount,
        avgResponseMs: requestCount > 0 ? Math.round(totalResponseMs / requestCount) : 0,
    };
}

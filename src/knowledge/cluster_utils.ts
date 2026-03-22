// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Shared cluster ID derivation for knowledge graph processing.
 * Used by both kg_bridge.ts and kg_scanner.ts.
 */

/** Default directories to skip when deriving cluster IDs from file paths. */
const DEFAULT_SKIP_DIRS = new Set([
    'src', 'app', 'lib', 'packages', 'server', 'api', 'pages',
    'components', 'features', 'modules',
]);

/** Extended skip set that also excludes test directories. */
const SKIP_DIRS_WITH_TESTS = new Set([
    ...DEFAULT_SKIP_DIRS,
    'test', 'tests', 'e2e', 'spec', 'specs',
]);

/**
 * Normalize a name to a snake_case cluster ID.
 * Handles camelCase conversion, then strips non-alphanumeric characters.
 */
export function normalizeToClusterId(name: string): string {
    return name
        .replace(/[A-Z]/g, (c, idx: number) => (idx > 0 ? `_${c.toLowerCase()}` : c.toLowerCase()))
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

/**
 * Derive a cluster ID from a node that has an optional filePath and name.
 * Prefers file path grouping for consistency.
 */
export function deriveClusterId(
    node: {filePath?: string; name: string},
    skipDirs?: Set<string>,
): string | null {
    if (node.filePath) {
        return deriveClusterIdFromPath(node.filePath, skipDirs);
    }
    const name = normalizeToClusterId(node.name);
    return name && name.length > 1 ? name : null;
}

/**
 * Derive a cluster ID from a file path by finding the first meaningful
 * directory segment after skipping common structural prefixes.
 */
export function deriveClusterIdFromPath(
    filePath: string,
    skipDirs: Set<string> = DEFAULT_SKIP_DIRS,
): string | null {
    const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);

    for (const part of parts) {
        if (skipDirs.has(part)) continue;
        if (part.includes('.')) continue; // skip files
        const normalized = part.toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        if (normalized && normalized.length > 1) {
            return normalized;
        }
    }
    return null;
}

export {DEFAULT_SKIP_DIRS, SKIP_DIRS_WITH_TESTS};

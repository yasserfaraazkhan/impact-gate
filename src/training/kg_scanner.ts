// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Converts an Understand-Anything knowledge graph into the same ScanResult
 * format produced by the filesystem scanner. This allows the existing
 * merge/enrich/validate pipeline to work unchanged with KG input.
 */

import type {KnowledgeGraph, KGNode} from '../knowledge/kg_types.js';
import {deriveClusterId, deriveClusterIdFromPath, SKIP_DIRS_WITH_TESTS} from '../knowledge/cluster_utils.js';
import type {ScanResult, ScannedFamily, ScannedFeature} from './types.js';

/**
 * Converts KG nodes/edges into a ScanResult compatible with the filesystem scanner output.
 * Groups nodes by their containing module/directory to form families.
 */
export function scanFromKnowledgeGraph(kg: KnowledgeGraph): ScanResult {
    const clusters = new Map<string, KGNode[]>();

    // Group nodes into clusters by directory/module
    for (const node of kg.nodes) {
        if (node.layer === 'infra') continue; // skip infrastructure nodes

        const clusterId = deriveClusterId(node, SKIP_DIRS_WITH_TESTS);
        if (!clusterId) continue;

        if (!clusters.has(clusterId)) {
            clusters.set(clusterId, []);
        }
        clusters.get(clusterId)!.push(node);
    }

    let totalSourceFiles = 0;
    let totalTestFiles = 0;

    const families: ScannedFamily[] = [];

    for (const [id, nodes] of clusters) {
        const webappPaths: string[] = [];
        const serverPaths: string[] = [];
        const specDirs: string[] = [];
        const tags: string[] = [];
        const seenDirs = new Set<string>();

        for (const node of nodes) {
            if (!node.filePath) continue;

            const normalized = node.filePath.replace(/\\/g, '/');

            if (node.layer === 'test') {
                totalTestFiles++;
                const dir = normalized.split('/').slice(0, -1).join('/');
                if (dir && !seenDirs.has(dir)) {
                    seenDirs.add(dir);
                    specDirs.push(dir + '/');
                }
                continue;
            }

            totalSourceFiles++;
            const glob = buildGlobFromPath(normalized);

            if (node.layer === 'api' || node.layer === 'service' || node.layer === 'data') {
                serverPaths.push(glob);
            } else if (node.layer === 'ui') {
                webappPaths.push(glob);
            } else {
                // Default assignment based on file path heuristics
                if (isLikelyServerPath(normalized)) {
                    serverPaths.push(glob);
                } else {
                    webappPaths.push(glob);
                }
            }

            // Extract tags from node metadata
            if (node.tags) {
                tags.push(...node.tags);
            }
        }

        if (webappPaths.length === 0 && serverPaths.length === 0 && specDirs.length === 0) {
            continue;
        }

        families.push({
            id,
            routes: [`/${id}`],
            webappPaths: [...new Set(webappPaths)],
            serverPaths: [...new Set(serverPaths)],
            specDirs: [...new Set(specDirs)],
            cypressSpecDirs: [],
            tags: [...new Set(tags)],
            features: [],
            routesGuessed: true,
        });
    }

    return {
        families,
        unmatchedSourceDirs: [],
        unmatchedTestDirs: [],
        stats: {
            totalSourceFiles,
            totalTestFiles,
            familyCount: families.length,
        },
    };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// deriveClusterId and deriveClusterIdFromPath imported from cluster_utils.ts

function buildGlobFromPath(filePath: string): string {
    // Reject paths with traversal or null bytes
    if (filePath.includes('..') || filePath.includes('\0')) {
        return '';
    }

    // Convert a file path to a glob pattern matching the directory
    const dir = filePath.split('/').slice(0, -1).join('/');
    return dir ? `${dir}/*` : `${filePath}*`;
}

function isLikelyServerPath(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return lower.includes('/server/') ||
        lower.includes('/api/') ||
        lower.includes('/routes/') ||
        lower.includes('/controllers/') ||
        lower.includes('/services/') ||
        lower.includes('/models/') ||
        lower.endsWith('.go') ||
        lower.endsWith('.py');
}

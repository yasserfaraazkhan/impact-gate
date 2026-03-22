// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Bridge between Understand-Anything's knowledge graph and e2e-agents' route families.
 * Transforms KG nodes/edges into RouteFamilyManifest so existing pipeline works unchanged.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {logger} from '../logger.js';

import type {KnowledgeGraph, KGNode, KGEdge, DiffOverlay, KGLayerName} from './kg_types.js';
import {deriveClusterId, deriveClusterIdFromPath} from './cluster_utils.js';
import type {RouteFamily, RouteFamilyManifest, FeaturePriority} from './route_families.js';

export type ProjectType = 'frontend' | 'backend' | 'fullstack';

const UA_DIR = '.understand-anything';
const KG_FILE = 'knowledge-graph.json';
const DIFF_FILE = 'diff-overlay.json';

const FRONTEND_FRAMEWORKS = new Set([
    'react', 'vue', 'angular', 'svelte', 'next', 'nextjs', 'next.js',
    'nuxt', 'nuxtjs', 'gatsby', 'remix', 'astro', 'solid', 'solidjs',
    'preact', 'lit', 'stencil', 'qwik',
]);

const BACKEND_FRAMEWORKS = new Set([
    'express', 'fastify', 'koa', 'hapi', 'nest', 'nestjs',
    'django', 'flask', 'fastapi', 'rails', 'spring', 'gin', 'echo', 'fiber',
    'actix', 'axum', 'rocket', 'phoenix', 'laravel',
]);

/**
 * Loads the knowledge graph from .understand-anything/knowledge-graph.json
 * or from a custom path when provided.
 */
export function loadKnowledgeGraph(projectRoot: string, customPath?: string): KnowledgeGraph | null {
    const kgPath = customPath || join(projectRoot, UA_DIR, KG_FILE);
    if (!existsSync(kgPath)) {
        return null;
    }

    try {
        const raw = JSON.parse(readFileSync(kgPath, 'utf-8')) as KnowledgeGraph;
        if (!raw.nodes || !Array.isArray(raw.nodes) || !raw.edges || !Array.isArray(raw.edges)) {
            logger.warn('Knowledge graph missing required nodes/edges arrays');
            return null;
        }
        if (!raw.project) {
            logger.warn('Knowledge graph missing project metadata');
            return null;
        }

        // Field-level validation: filter out invalid nodes rather than rejecting the whole graph
        const MAX_STRING_LEN = 1000;
        const validNodes = raw.nodes.filter((node) => {
            if (typeof node.id !== 'string' || typeof node.name !== 'string') {
                logger.warn(`Dropping KG node with missing/invalid id or name: ${JSON.stringify(node).slice(0, 200)}`);
                return false;
            }
            if (node.filePath !== undefined) {
                if (typeof node.filePath !== 'string') {
                    logger.warn(`Dropping KG node "${node.id}": filePath is not a string`);
                    return false;
                }
                if (node.filePath.startsWith('/')) {
                    logger.warn(`Dropping KG node "${node.id}": absolute filePath rejected`);
                    return false;
                }
                if (node.filePath.includes('..')) {
                    logger.warn(`Dropping KG node "${node.id}": path traversal in filePath rejected`);
                    return false;
                }
                if (node.filePath.includes('\0')) {
                    logger.warn(`Dropping KG node "${node.id}": null byte in filePath rejected`);
                    return false;
                }
            }
            return true;
        });

        // Truncate excessively long strings
        for (const node of validNodes) {
            if (node.name.length > MAX_STRING_LEN) {
                node.name = node.name.slice(0, MAX_STRING_LEN);
            }
            if (node.description && node.description.length > MAX_STRING_LEN) {
                node.description = node.description.slice(0, MAX_STRING_LEN);
            }
        }

        raw.nodes = validNodes;
        return raw;
    } catch (error) {
        logger.warn(`Failed to load knowledge graph: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

/**
 * Classifies project type based on KG framework metadata.
 */
export function classifyProjectType(kg: KnowledgeGraph): ProjectType {
    const frameworks = kg.project.frameworks.map((f) => f.toLowerCase());
    const hasFrontend = frameworks.some((f) => FRONTEND_FRAMEWORKS.has(f));
    const hasBackend = frameworks.some((f) => BACKEND_FRAMEWORKS.has(f));

    if (hasFrontend && hasBackend) return 'fullstack';
    if (hasBackend) return 'backend';
    return 'frontend';
}

/**
 * Core bridge: transforms KG into a RouteFamilyManifest.
 *
 * Strategy:
 * - Frontend: cluster UI-layer nodes into families by module/component groups
 * - Backend: cluster API-layer nodes, follow calls edges into Service→Data layers
 * - Priority: P0 = high fan-in nodes, P1 = moderate, P2 = leaf/utility
 * - userFlows: derived from KG tour steps referencing family nodes
 */
export function transformKGToFamilies(kg: KnowledgeGraph): RouteFamilyManifest {
    const projectType = classifyProjectType(kg);
    const nodeMap = new Map(kg.nodes.map((n) => [n.id, n]));
    const edgesByTarget = groupEdges(kg.edges, 'target');

    // Build clusters based on project type
    const clusters = buildClusters(kg, projectType, nodeMap);

    // Transform clusters into route families
    const families: RouteFamily[] = [];
    for (const [clusterId, nodeIds] of clusters) {
        const nodes = nodeIds.map((id) => nodeMap.get(id)).filter((n): n is KGNode => n !== undefined);
        if (nodes.length === 0) continue;

        const family = buildFamilyFromCluster(
            clusterId, nodes, projectType, nodeMap, edgesByTarget,
        );
        if (family) {
            families.push(family);
        }
    }

    // Derive userFlows from KG tour steps
    if (kg.tour && kg.tour.length > 0) {
        assignTourFlows(families, kg.tour, nodeMap);
    }

    // Sort by priority (P0 first) then alphabetically
    families.sort((a, b) => {
        const pOrder = {P0: 0, P1: 1, P2: 2};
        const pa = pOrder[a.priority || 'P2'];
        const pb = pOrder[b.priority || 'P2'];
        if (pa !== pb) return pa - pb;
        return a.id.localeCompare(b.id);
    });

    return {
        families,
        source: 'knowledge-graph',
    };
}

/**
 * Loads the diff overlay from .understand-anything/diff-overlay.json
 */
export function loadDiffOverlay(projectRoot: string): DiffOverlay | null {
    const overlayPath = join(projectRoot, UA_DIR, DIFF_FILE);
    if (!existsSync(overlayPath)) {
        return null;
    }

    try {
        const raw = JSON.parse(readFileSync(overlayPath, 'utf-8')) as DiffOverlay;
        if (!raw.changes || !Array.isArray(raw.changes)) {
            return null;
        }
        return raw;
    } catch {
        return null;
    }
}

/**
 * Maps diff overlay changes to file paths using KG node resolution.
 */
export function diffOverlayToChangedFiles(overlay: DiffOverlay, kg: KnowledgeGraph): string[] {
    const nodeMap = new Map(kg.nodes.map((n) => [n.id, n]));
    const files = new Set<string>();

    for (const change of overlay.changes) {
        // Use filePath from change if available
        if (change.filePath) {
            files.add(change.filePath);
            continue;
        }
        // Fall back to KG node's filePath
        const node = nodeMap.get(change.nodeId);
        if (node?.filePath) {
            files.add(node.filePath);
        }
    }

    return [...files];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function groupEdges(edges: KGEdge[], key: 'source' | 'target'): Map<string, KGEdge[]> {
    const map = new Map<string, KGEdge[]>();
    for (const edge of edges) {
        const val = edge[key];
        if (!map.has(val)) map.set(val, []);
        map.get(val)!.push(edge);
    }
    return map;
}

/**
 * Build clusters of related nodes to become families.
 * Frontend: group by route/page/component modules
 * Backend: group by API endpoint handlers + their service dependencies
 */
function buildClusters(
    kg: KnowledgeGraph,
    projectType: ProjectType,
    nodeMap: Map<string, KGNode>,
): Map<string, string[]> {
    const clusters = new Map<string, string[]>();

    // Strategy 1: Use KG layers to find anchor nodes
    const layerMap = new Map<KGLayerName, Set<string>>();
    if (kg.layers) {
        for (const layer of kg.layers) {
            layerMap.set(layer.name, new Set(layer.nodeIds));
        }
    }

    // Strategy 2: Group by module/component/route nodes
    const anchorKinds = projectType === 'backend'
        ? new Set(['module', 'route', 'class', 'function'])
        : new Set(['component', 'route', 'module', 'class']);

    const anchorLayers: Set<KGLayerName> = projectType === 'backend'
        ? new Set(['api', 'service'])
        : new Set(['ui']);

    for (const node of kg.nodes) {
        // Skip test/infra nodes as cluster anchors
        if (node.layer === 'test' || node.layer === 'infra') continue;

        const isAnchorKind = anchorKinds.has(node.kind);
        const isAnchorLayer = !node.layer || anchorLayers.has(node.layer);

        if (!isAnchorKind || !isAnchorLayer) continue;

        // Derive cluster ID from node path or name
        const clusterId = deriveClusterId(node);
        if (!clusterId) continue;

        if (!clusters.has(clusterId)) {
            clusters.set(clusterId, []);
        }
        clusters.get(clusterId)!.push(node.id);
    }

    // If no clusters found, fall back to file-based grouping
    if (clusters.size === 0) {
        for (const node of kg.nodes) {
            if (!node.filePath || node.layer === 'test' || node.layer === 'infra') continue;
            const clusterId = deriveClusterIdFromPath(node.filePath);
            if (!clusterId) continue;

            if (!clusters.has(clusterId)) {
                clusters.set(clusterId, []);
            }
            clusters.get(clusterId)!.push(node.id);
        }
    }

    return clusters;
}

// deriveClusterId and deriveClusterIdFromPath imported from cluster_utils.ts

function computePriority(nodes: KGNode[]): FeaturePriority {
    const maxFanIn = Math.max(...nodes.map((n) => n.fanIn || 0));
    if (maxFanIn >= 10) return 'P0';
    if (maxFanIn >= 4) return 'P1';
    return 'P2';
}

function buildFamilyFromCluster(
    clusterId: string,
    nodes: KGNode[],
    projectType: ProjectType,
    nodeMap: Map<string, KGNode>,
    edgesByTarget: Map<string, KGEdge[]>,
): RouteFamily | null {
    const webappPaths = new Set<string>();
    const serverPaths = new Set<string>();
    const routes: string[] = [];
    const apiEndpoints: Array<{method: string; path: string; description?: string}> = [];

    for (const node of nodes) {
        if (!node.filePath) continue;

        const layer = node.layer;
        if (layer === 'api' || layer === 'service' || layer === 'data') {
            serverPaths.add(`${node.filePath}*`);
        } else if (layer === 'ui') {
            webappPaths.add(`${node.filePath}*`);
        } else {
            // Auto-assign based on project type
            if (projectType === 'backend') {
                serverPaths.add(`${node.filePath}*`);
            } else {
                webappPaths.add(`${node.filePath}*`);
            }
        }

        // Extract routes from route nodes
        if (node.kind === 'route') {
            const routePath = node.metadata?.path as string | undefined;
            if (routePath) {
                routes.push(routePath);
                // Extract API endpoint info
                const method = (node.metadata?.method as string) || 'GET';
                apiEndpoints.push({method: method.toUpperCase(), path: routePath, description: node.description});
            } else {
                routes.push(`/${clusterId}`);
            }
        }
    }

    // If no routes extracted, generate a default
    if (routes.length === 0) {
        routes.push(`/${clusterId}`);
    }

    // Collect related test file paths by following 'tests' edges
    const specDirs = new Set<string>();
    for (const node of nodes) {
        const testEdges = (edgesByTarget.get(node.id) || []).filter((e) => e.type === 'tests');
        for (const edge of testEdges) {
            const testNode = nodeMap.get(edge.source);
            if (testNode?.filePath) {
                // Use directory of test file
                const dir = testNode.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
                if (dir) specDirs.add(`${dir}/*`);
            }
        }
    }

    const priority = computePriority(nodes);

    // Determine test type based on content
    let testType: 'ui' | 'api' | 'both' | undefined;
    if (webappPaths.size > 0 && serverPaths.size > 0) {
        testType = 'both';
    } else if (serverPaths.size > 0 && apiEndpoints.length > 0) {
        testType = 'api';
    } else if (webappPaths.size > 0) {
        testType = 'ui';
    }

    const family: RouteFamily = {
        id: clusterId,
        routes: [...new Set(routes)],
        priority,
    };

    if (webappPaths.size > 0) family.webappPaths = [...webappPaths];
    if (serverPaths.size > 0) family.serverPaths = [...serverPaths];
    if (specDirs.size > 0) family.specDirs = [...specDirs];
    if (apiEndpoints.length > 0) family.apiEndpoints = apiEndpoints;
    if (testType) family.testType = testType;

    return family;
}

function assignTourFlows(
    families: RouteFamily[],
    tour: KnowledgeGraph['tour'],
    nodeMap: Map<string, KGNode>,
): void {
    if (!tour) return;

    // Build a map of nodeId → family for quick lookup
    const nodeToFamily = new Map<string, RouteFamily>();
    for (const family of families) {
        // Resolve family nodes from paths
        for (const [nodeId, node] of nodeMap) {
            if (!node.filePath) continue;
            const matchesPaths = [
                ...(family.webappPaths || []),
                ...(family.serverPaths || []),
            ];
            for (const pattern of matchesPaths) {
                const prefix = pattern.replace(/\*$/, '');
                if (node.filePath.startsWith(prefix)) {
                    nodeToFamily.set(nodeId, family);
                    break;
                }
            }
        }
    }

    // Assign tour steps as user flows
    for (const step of tour.sort((a, b) => a.order - b.order)) {
        for (const nodeId of step.nodeIds) {
            const family = nodeToFamily.get(nodeId);
            if (family) {
                if (!family.userFlows) family.userFlows = [];
                const flowDesc = `${step.title}: ${step.description}`;
                if (!family.userFlows.includes(flowDesc)) {
                    family.userFlows.push(flowDesc);
                }
            }
        }
    }
}

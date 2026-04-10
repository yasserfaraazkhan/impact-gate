// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Knowledge Graph Impact Expansion
 *
 * Given a set of changed files and a KnowledgeGraph, traces the call chains
 * to find all transitively affected functions, their callers, and the tests
 * that exercise them. Produces function-level impact analysis.
 *
 * This enables output like:
 *   "SetChannelManagedCategory (channel_category.go:288)
 *    → called by: patchChannel (channel.go:455)
 *    → tested by: managed_categories.spec.ts"
 */

import type {KnowledgeGraph, KGNode, KGEdge} from '../knowledge/kg_types.js';

/** A function affected by the change, with its call chain and test coverage */
export interface AffectedFunction {
    /** The KG node for this function */
    node: KGNode;

    /** How this function is affected: directly changed or transitively reached */
    impact: 'direct' | 'transitive';

    /** Functions that call this one (callers) */
    calledBy: KGNode[];

    /** Test nodes that exercise this function (directly or transitively) */
    testedBy: KGNode[];

    /** Depth from the changed file (0 = in the changed file, 1 = direct caller, etc.) */
    depth: number;
}

/** Result of KG-based impact expansion */
export interface KGImpactResult {
    /** All files transitively affected (for expandedFiles param) */
    expandedFiles: string[];

    /** Function-level affected analysis */
    affectedFunctions: AffectedFunction[];

    /** Summary stats */
    stats: {
        directFunctions: number;
        transitiveFunctions: number;
        testedFunctions: number;
        untestedFunctions: number;
    };
}

/** Edge types that represent "A depends on B" (forward dependency) */
const DEPENDENCY_EDGE_TYPES = new Set(['calls', 'uses', 'renders', 'handles', 'imports', 'depends_on', 'composed_of']);

/** Edge types that represent "A tests B" */
const TEST_EDGE_TYPES = new Set(['tests']);

/**
 * Expand changed files through the knowledge graph to find all
 * transitively affected functions and their test coverage.
 *
 * @param changedFiles - Files modified in the diff
 * @param kg - The knowledge graph
 * @param maxDepth - Maximum call chain depth to traverse (default: 3)
 */
export function expandChangedFilesViaKG(
    changedFiles: string[],
    kg: KnowledgeGraph,
    maxDepth: number = 3,
): KGImpactResult {
    // Build lookup indexes
    const nodesByFile = buildNodesByFile(kg.nodes);
    const callerEdges = buildReverseEdgeIndex(kg.edges, DEPENDENCY_EDGE_TYPES);
    const testEdges = buildReverseEdgeIndex(kg.edges, TEST_EDGE_TYPES);
    const nodeMap = new Map(kg.nodes.map((n) => [n.id, n]));

    // Find directly affected nodes (in changed files)
    const directNodeIds = new Set<string>();
    for (const file of changedFiles) {
        const nodesInFile = nodesByFile.get(normalizeFilePath(file)) || [];
        for (const node of nodesInFile) {
            directNodeIds.add(node.id);
        }
    }

    // BFS: walk callers up to maxDepth
    const visited = new Map<string, {depth: number; impact: 'direct' | 'transitive'}>();
    const queue: Array<{nodeId: string; depth: number}> = [];

    for (const nodeId of directNodeIds) {
        visited.set(nodeId, {depth: 0, impact: 'direct'});
        queue.push({nodeId, depth: 0});
    }

    while (queue.length > 0) {
        const {nodeId, depth} = queue.shift()!;
        if (depth >= maxDepth) continue;

        // Find callers of this node (reverse edges)
        const callers = callerEdges.get(nodeId) || [];
        for (const callerNodeId of callers) {
            if (!visited.has(callerNodeId)) {
                visited.set(callerNodeId, {depth: depth + 1, impact: 'transitive'});
                queue.push({nodeId: callerNodeId, depth: depth + 1});
            }
        }
    }

    // Build affected functions with test coverage
    const affectedFunctions: AffectedFunction[] = [];
    const expandedFileSet = new Set<string>();

    for (const [nodeId, info] of visited) {
        const node = nodeMap.get(nodeId);
        if (!node) continue;

        // Collect callers
        const callerIds = callerEdges.get(nodeId) || [];
        const calledBy = callerIds
            .map((id) => nodeMap.get(id))
            .filter((n): n is KGNode => n !== undefined);

        // Collect tests (direct + transitive via callers)
        const testedBy = findTestCoverage(nodeId, testEdges, callerEdges, nodeMap, 2);

        affectedFunctions.push({
            node,
            impact: info.impact,
            calledBy,
            testedBy,
            depth: info.depth,
        });

        // Add to expanded files
        if (node.filePath) {
            expandedFileSet.add(node.filePath);
        }
    }

    // Sort: direct first, then by depth
    affectedFunctions.sort((a, b) => {
        if (a.impact !== b.impact) return a.impact === 'direct' ? -1 : 1;
        return a.depth - b.depth;
    });

    const testedCount = affectedFunctions.filter((f) => f.testedBy.length > 0).length;

    return {
        expandedFiles: [...expandedFileSet],
        affectedFunctions,
        stats: {
            directFunctions: affectedFunctions.filter((f) => f.impact === 'direct').length,
            transitiveFunctions: affectedFunctions.filter((f) => f.impact === 'transitive').length,
            testedFunctions: testedCount,
            untestedFunctions: affectedFunctions.length - testedCount,
        },
    };
}

// ─── Index builders ───

/** Group KG nodes by their file path (normalized) */
function buildNodesByFile(nodes: KGNode[]): Map<string, KGNode[]> {
    const map = new Map<string, KGNode[]>();
    for (const node of nodes) {
        if (node.filePath) {
            const key = normalizeFilePath(node.filePath);
            const list = map.get(key) || [];
            list.push(node);
            map.set(key, list);
        }
    }
    return map;
}

/**
 * Build reverse edge index: target → [source nodes]
 * For "calls" edges: if A calls B, reverse index maps B → [A]
 * This lets us find "who calls this function?"
 */
function buildReverseEdgeIndex(edges: KGEdge[], edgeTypes: Set<string>): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const edge of edges) {
        if (edgeTypes.has(edge.type)) {
            const list = map.get(edge.target) || [];
            list.push(edge.source);
            map.set(edge.target, list);
        }
    }
    return map;
}

/** Find test nodes that cover a function (directly or via its callers) */
function findTestCoverage(
    nodeId: string,
    testEdges: Map<string, string[]>,
    callerEdges: Map<string, string[]>,
    nodeMap: Map<string, KGNode>,
    maxDepth: number,
): KGNode[] {
    const tests = new Set<string>();
    const visited = new Set<string>();
    const queue: Array<{id: string; depth: number}> = [{id: nodeId, depth: 0}];

    while (queue.length > 0) {
        const {id, depth} = queue.shift()!;
        if (visited.has(id) || depth > maxDepth) continue;
        visited.add(id);

        // Direct test edges
        const directTests = testEdges.get(id) || [];
        for (const testId of directTests) {
            tests.add(testId);
        }

        // Check callers for test edges too
        if (depth < maxDepth) {
            const callers = callerEdges.get(id) || [];
            for (const callerId of callers) {
                queue.push({id: callerId, depth: depth + 1});
            }
        }
    }

    return [...tests]
        .map((id) => nodeMap.get(id))
        .filter((n): n is KGNode => n !== undefined && n.layer === 'test');
}

/** Normalize file paths for matching (strip leading ./ and trailing whitespace) */
function normalizeFilePath(filePath: string): string {
    return filePath.replace(/^\.\//, '').replace(/\\/g, '/').trim();
}

// ─── Formatting helpers (used by review output) ───

/**
 * Format an affected function for display.
 */
export function formatAffectedFunction(af: AffectedFunction): string {
    const location = af.node.metadata?.source_location ? `:${af.node.metadata.source_location}` : '';
    const file = af.node.filePath ? ` (${shortPath(af.node.filePath)}${location})` : '';
    const callers = af.calledBy.length > 0
        ? `\n       called by: ${af.calledBy.slice(0, 3).map((c) => c.name).join(', ')}${af.calledBy.length > 3 ? ` +${af.calledBy.length - 3} more` : ''}`
        : '';
    const tests = af.testedBy.length > 0
        ? `\n       tested by: ${af.testedBy.slice(0, 2).map((t) => t.name).join(', ')}${af.testedBy.length > 2 ? ` +${af.testedBy.length - 2} more` : ''}`
        : '\n       tested by: (none)';

    return `${af.node.name}${file}${callers}${tests}`;
}

function shortPath(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 3) return path;
    return `.../${parts.slice(-2).join('/')}`;
}

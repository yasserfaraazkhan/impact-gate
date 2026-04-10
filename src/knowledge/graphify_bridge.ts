// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Graphify Bridge
 *
 * Converts Graphify's graph.json output into impact-gate's KnowledgeGraph format.
 * Graphify (https://github.com/safishamsi/graphify) uses tree-sitter for
 * deterministic AST extraction — function calls, imports, class hierarchy —
 * across 20 languages with zero LLM cost.
 *
 * This bridge enables function-level impact analysis: trace changed functions
 * → their callers → the tests that exercise them.
 *
 * Usage:
 *   pip install graphifyy
 *   cd your-repo && graphify .
 *   impact-gate review --path .   # auto-detects .graphify/graph.json
 */

import {existsSync, readFileSync} from 'fs';
import {basename, join} from 'path';

import type {KnowledgeGraph, KGNode, KGNodeKind, KGEdge, KGEdgeType, KGProject} from './kg_types.js';

// ─── Graphify JSON schema ───

/** Graphify node from graph.json (node_link_data format) */
interface GraphifyNode {
    id: string;
    label?: string;
    community?: number;
    file_type?: string;        // 'code' | 'document' | 'paper' | 'image'
    source_file?: string;      // relative path to source file
    source_location?: string;  // line number or range
    [key: string]: unknown;    // additional metadata
}

/** Graphify edge from graph.json (node_link_data format) */
interface GraphifyEdge {
    source: string;
    target: string;
    relation?: string;         // 'calls' | 'imports' | 'imports_from' | 'inherits' | 'method' | 'uses' | 'contains'
    confidence?: string;       // 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'
    confidence_score?: number; // 1.0, 0.8, 0.5, 0.2
    weight?: number;
    [key: string]: unknown;
}

/** Graphify graph.json top-level structure */
interface GraphifyGraph {
    nodes: GraphifyNode[];
    links: GraphifyEdge[];     // Graphify uses "links" per NetworkX convention
    hyperedges?: unknown[];
}

// ─── Search paths ───

const GRAPHIFY_PATHS = [
    '.graphify/graph.json',
    'graphify-output/graph.json',
    'graph.json',
];

// ─── Main entry point ───

/**
 * Load and convert a Graphify graph into impact-gate's KnowledgeGraph format.
 * Searches standard Graphify output locations.
 *
 * @param projectRoot - Root of the project
 * @param customPath - Optional explicit path to graph.json
 * @returns KnowledgeGraph or null if not found
 */
export function loadGraphifyGraph(projectRoot: string, customPath?: string): KnowledgeGraph | null {
    const candidates = customPath ? [customPath] : GRAPHIFY_PATHS.map((p) => join(projectRoot, p));

    for (const candidate of candidates) {
        if (!existsSync(candidate)) continue;

        try {
            const raw = JSON.parse(readFileSync(candidate, 'utf-8')) as GraphifyGraph;
            if (!raw.nodes || !Array.isArray(raw.nodes)) continue;
            if (!raw.links || !Array.isArray(raw.links)) continue;

            return convertGraphifyToKG(raw, projectRoot);
        } catch {
            continue;
        }
    }

    return null;
}

// ─── Conversion ───

function convertGraphifyToKG(graph: GraphifyGraph, projectRoot: string): KnowledgeGraph {
    const nodes: KGNode[] = [];
    const edges: KGEdge[] = [];
    const nodeIds = new Set<string>();

    // Convert nodes
    for (const gNode of graph.nodes) {
        const kgNode = convertNode(gNode);
        if (kgNode && !nodeIds.has(kgNode.id)) {
            nodes.push(kgNode);
            nodeIds.add(kgNode.id);
        }
    }

    // Convert edges (only for known nodes)
    for (const gEdge of graph.links) {
        const kgEdge = convertEdge(gEdge);
        if (kgEdge && nodeIds.has(kgEdge.source) && nodeIds.has(kgEdge.target)) {
            edges.push(kgEdge);
        }
    }

    // Compute fan-in / fan-out
    const fanIn = new Map<string, number>();
    const fanOut = new Map<string, number>();
    for (const edge of edges) {
        fanOut.set(edge.source, (fanOut.get(edge.source) || 0) + 1);
        fanIn.set(edge.target, (fanIn.get(edge.target) || 0) + 1);
    }
    for (const node of nodes) {
        node.fanIn = fanIn.get(node.id) || 0;
        node.fanOut = fanOut.get(node.id) || 0;
    }

    // Infer project metadata from node file types
    const languages = new Set<string>();
    for (const node of nodes) {
        if (node.filePath) {
            const ext = node.filePath.split('.').pop()?.toLowerCase();
            if (ext) {
                const lang = EXT_TO_LANGUAGE[ext];
                if (lang) languages.add(lang);
            }
        }
    }

    const project: KGProject = {
        name: basename(projectRoot) || 'unknown',
        frameworks: [],
        languages: [...languages],
    };

    return {
        version: '1.0.0',
        project,
        nodes,
        edges,
    };
}

// ─── Node conversion ───

function convertNode(gNode: GraphifyNode): KGNode | null {
    if (!gNode.id || typeof gNode.id !== 'string') return null;

    const kind = inferNodeKind(gNode);
    const name = gNode.label || gNode.id;
    const filePath = typeof gNode.source_file === 'string' ? gNode.source_file : undefined;

    return {
        id: gNode.id,
        kind,
        name,
        filePath,
        layer: inferLayer(filePath),
        metadata: {
            community: gNode.community,
            source_location: gNode.source_location,
            file_type: gNode.file_type,
        },
    };
}

/** Infer impact-gate node kind from Graphify node metadata */
function inferNodeKind(gNode: GraphifyNode): KGNodeKind {
    const label = (gNode.label || gNode.id).toLowerCase();
    const sourceFile = (gNode.source_file || '').toLowerCase();

    // If this is a file-level node (no specific function/class info)
    if (gNode.file_type === 'code' && !gNode.source_location) {
        return 'file';
    }

    // Infer from label patterns
    if (label.startsWith('class:') || label.includes('class ')) return 'class';
    if (label.startsWith('fn:') || label.startsWith('func:') || label.includes('()')) return 'function';
    if (label.startsWith('mod:') || label.startsWith('module:')) return 'module';

    // Infer from source file extension + having a location (= function/method)
    if (gNode.source_location) {
        if (sourceFile.endsWith('.tsx') || sourceFile.endsWith('.jsx')) return 'component';
        return 'function';
    }

    // Infer from file type — only .tsx/.jsx are components, plain .ts is a module
    if (sourceFile.endsWith('.tsx') || sourceFile.endsWith('.jsx')) {
        return 'component';
    }

    return 'module';
}

// ─── Edge conversion ───

/** Map Graphify relation types to impact-gate edge types */
const RELATION_MAP: Record<string, KGEdgeType> = {
    calls: 'calls',
    imports: 'imports',
    imports_from: 'imports',
    inherits: 'extends',
    method: 'contains',
    uses: 'uses',
    contains: 'contains',
    renders: 'renders',
    tests: 'tests',
    depends_on: 'depends_on',
};

function convertEdge(gEdge: GraphifyEdge): KGEdge | null {
    if (!gEdge.source || !gEdge.target) return null;

    const relation = gEdge.relation || 'uses';
    const type = RELATION_MAP[relation] || 'uses';

    return {
        source: gEdge.source,
        target: gEdge.target,
        type,
        weight: gEdge.weight ?? gEdge.confidence_score,
        metadata: {
            confidence: gEdge.confidence,
            confidence_score: gEdge.confidence_score,
            original_relation: gEdge.relation,
        },
    };
}

// ─── Utilities ───

/** Infer the architectural layer from a file path */
function inferLayer(filePath?: string): KGNode['layer'] {
    if (!filePath) return undefined;
    const lower = filePath.toLowerCase();

    if (lower.includes('/test/') || lower.includes('/tests/') || lower.includes('.test.') || lower.includes('.spec.') || lower.includes('_test.go')) return 'test';
    if (lower.includes('/api/') || lower.includes('/api4/') || lower.includes('/routes/') || lower.includes('/handlers/')) return 'api';
    if (lower.includes('/store/') || lower.includes('/models/') || lower.includes('/model/') || lower.includes('/database/')) return 'data';
    if (lower.includes('/components/') || lower.includes('/pages/') || lower.includes('/views/') || lower.includes('/ui/')) return 'ui';
    if (lower.includes('/services/') || lower.includes('/app/')) return 'service';
    if (lower.includes('/config/') || lower.includes('.config.')) return 'config';
    if (lower.includes('/infra/') || lower.includes('/deploy/') || lower.includes('.github/')) return 'infra';

    return 'shared';
}

const EXT_TO_LANGUAGE: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    go: 'go', py: 'python', rs: 'rust', java: 'java',
    rb: 'ruby', cs: 'csharp', kt: 'kotlin', scala: 'scala',
    c: 'c', cpp: 'cpp', swift: 'swift', php: 'php',
};

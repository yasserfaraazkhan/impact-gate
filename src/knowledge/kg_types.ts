// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * TypeScript interfaces matching Understand-Anything's knowledge-graph.json schema.
 * These types enable the bridge between UA's knowledge graph and impact-gate' route families.
 */

export type KGNodeKind = 'file' | 'function' | 'class' | 'module' | 'concept' | 'component' | 'route' | 'hook' | 'type' | 'variable';

export type KGEdgeType =
    | 'imports'
    | 'exports'
    | 'calls'
    | 'implements'
    | 'extends'
    | 'uses'
    | 'renders'
    | 'routes_to'
    | 'provides'
    | 'consumes'
    | 'tests'
    | 'configures'
    | 'depends_on'
    | 'contains'
    | 'composed_of'
    | 'handles'
    | 'emits'
    | 'listens_to';

export type KGLayerName = 'ui' | 'api' | 'service' | 'data' | 'config' | 'test' | 'infra' | 'shared';

export interface KGNode {
    id: string;
    kind: KGNodeKind;
    name: string;
    filePath?: string;
    layer?: KGLayerName;
    description?: string;
    tags?: string[];
    /** Fan-in: number of other nodes referencing this one */
    fanIn?: number;
    /** Fan-out: number of nodes this one references */
    fanOut?: number;
    metadata?: Record<string, unknown>;
}

export interface KGEdge {
    source: string;
    target: string;
    type: KGEdgeType;
    weight?: number;
    metadata?: Record<string, unknown>;
}

export interface KGLayer {
    name: KGLayerName;
    nodeIds: string[];
    description?: string;
}

export interface KGTourStep {
    id: string;
    title: string;
    description: string;
    nodeIds: string[];
    order: number;
}

export interface KGProject {
    name: string;
    description?: string;
    frameworks: string[];
    languages: string[];
    entryPoints?: string[];
    rootDir?: string;
}

export interface KnowledgeGraph {
    version: string;
    project: KGProject;
    nodes: KGNode[];
    edges: KGEdge[];
    layers?: KGLayer[];
    tour?: KGTourStep[];
}

export interface DiffOverlayChange {
    nodeId: string;
    changeType: 'added' | 'modified' | 'removed';
    filePath?: string;
    description?: string;
}

export interface DiffOverlay {
    version: string;
    baseSha?: string;
    headSha?: string;
    changes: DiffOverlayChange[];
    affectedEdges?: Array<{
        source: string;
        target: string;
        type: KGEdgeType;
        impact: 'added' | 'modified' | 'removed';
    }>;
}

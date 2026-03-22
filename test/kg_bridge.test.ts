// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
    loadKnowledgeGraph,
    classifyProjectType,
    transformKGToFamilies,
} from '../dist/knowledge/kg_bridge.js';

import type {KnowledgeGraph} from '../dist/knowledge/kg_types.js';

function makeKG(overrides?: Partial<KnowledgeGraph>): KnowledgeGraph {
    return {
        version: '1.0',
        project: {name: 'TestProject', frameworks: ['react'], languages: ['typescript']},
        nodes: [],
        edges: [],
        ...overrides,
    };
}

describe('kg_bridge', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-bridge-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    describe('loadKnowledgeGraph', () => {
        it('loads a valid KG file', () => {
            const kg = makeKG({
                nodes: [{id: 'n1', kind: 'module', name: 'auth', filePath: 'src/auth/index.ts'}],
                edges: [{source: 'n1', target: 'n1', type: 'imports'}],
            });
            const uaDir = path.join(tmpDir, '.understand-anything');
            fs.mkdirSync(uaDir, {recursive: true});
            fs.writeFileSync(path.join(uaDir, 'knowledge-graph.json'), JSON.stringify(kg));

            const loaded = loadKnowledgeGraph(tmpDir);
            assert.ok(loaded);
            assert.equal(loaded.nodes.length, 1);
            assert.equal(loaded.edges.length, 1);
        });

        it('returns null for missing file', () => {
            const result = loadKnowledgeGraph(tmpDir);
            assert.equal(result, null);
        });

        it('returns null for invalid JSON', () => {
            const uaDir = path.join(tmpDir, '.understand-anything');
            fs.mkdirSync(uaDir, {recursive: true});
            fs.writeFileSync(path.join(uaDir, 'knowledge-graph.json'), 'not json');

            const result = loadKnowledgeGraph(tmpDir);
            assert.equal(result, null);
        });

        it('returns null when nodes/edges are missing', () => {
            const uaDir = path.join(tmpDir, '.understand-anything');
            fs.mkdirSync(uaDir, {recursive: true});
            fs.writeFileSync(
                path.join(uaDir, 'knowledge-graph.json'),
                JSON.stringify({version: '1', project: {name: 'X', frameworks: [], languages: []}}),
            );

            const result = loadKnowledgeGraph(tmpDir);
            assert.equal(result, null);
        });

        it('rejects nodes with absolute filePath', () => {
            const kg = makeKG({
                nodes: [
                    {id: 'good', kind: 'module', name: 'good', filePath: 'src/good.ts'},
                    {id: 'bad', kind: 'module', name: 'bad', filePath: '/etc/passwd'},
                ],
                edges: [],
            });
            const uaDir = path.join(tmpDir, '.understand-anything');
            fs.mkdirSync(uaDir, {recursive: true});
            fs.writeFileSync(path.join(uaDir, 'knowledge-graph.json'), JSON.stringify(kg));

            const loaded = loadKnowledgeGraph(tmpDir);
            assert.ok(loaded);
            assert.equal(loaded.nodes.length, 1);
            assert.equal(loaded.nodes[0].id, 'good');
        });

        it('rejects nodes with path traversal (..)', () => {
            const kg = makeKG({
                nodes: [
                    {id: 'bad', kind: 'module', name: 'bad', filePath: 'src/../../etc/passwd'},
                ],
                edges: [],
            });
            const uaDir = path.join(tmpDir, '.understand-anything');
            fs.mkdirSync(uaDir, {recursive: true});
            fs.writeFileSync(path.join(uaDir, 'knowledge-graph.json'), JSON.stringify(kg));

            const loaded = loadKnowledgeGraph(tmpDir);
            assert.ok(loaded);
            assert.equal(loaded.nodes.length, 0);
        });

        it('rejects nodes with null bytes in filePath', () => {
            const kg = makeKG({
                nodes: [
                    {id: 'bad', kind: 'module', name: 'bad', filePath: 'src/bad\0.ts'},
                ],
                edges: [],
            });
            const uaDir = path.join(tmpDir, '.understand-anything');
            fs.mkdirSync(uaDir, {recursive: true});
            fs.writeFileSync(path.join(uaDir, 'knowledge-graph.json'), JSON.stringify(kg));

            const loaded = loadKnowledgeGraph(tmpDir);
            assert.ok(loaded);
            assert.equal(loaded.nodes.length, 0);
        });

        it('truncates excessively long name strings', () => {
            const longName = 'a'.repeat(2000);
            const kg = makeKG({
                nodes: [{id: 'n1', kind: 'module', name: longName, filePath: 'src/auth/index.ts'}],
                edges: [],
            });
            const uaDir = path.join(tmpDir, '.understand-anything');
            fs.mkdirSync(uaDir, {recursive: true});
            fs.writeFileSync(path.join(uaDir, 'knowledge-graph.json'), JSON.stringify(kg));

            const loaded = loadKnowledgeGraph(tmpDir);
            assert.ok(loaded);
            assert.equal(loaded.nodes[0].name.length, 1000);
        });
    });

    describe('classifyProjectType', () => {
        it('detects frontend project', () => {
            const kg = makeKG({project: {name: 'App', frameworks: ['react'], languages: ['typescript']}});
            assert.equal(classifyProjectType(kg), 'frontend');
        });

        it('detects backend project', () => {
            const kg = makeKG({project: {name: 'API', frameworks: ['express'], languages: ['typescript']}});
            assert.equal(classifyProjectType(kg), 'backend');
        });

        it('detects fullstack project', () => {
            const kg = makeKG({project: {name: 'Full', frameworks: ['react', 'express'], languages: ['typescript']}});
            assert.equal(classifyProjectType(kg), 'fullstack');
        });
    });

    describe('transformKGToFamilies', () => {
        it('transforms basic KG into families', () => {
            const kg = makeKG({
                nodes: [
                    {id: 'n1', kind: 'module', name: 'auth', filePath: 'src/auth/login.ts', layer: 'ui'},
                    {id: 'n2', kind: 'module', name: 'auth', filePath: 'src/auth/register.ts', layer: 'ui'},
                ],
                edges: [],
            });
            const manifest = transformKGToFamilies(kg);
            assert.ok(manifest.families.length > 0);
            assert.equal(manifest.source, 'knowledge-graph');
        });

        it('assigns priority based on fanIn', () => {
            const kg = makeKG({
                nodes: [
                    {id: 'n1', kind: 'module', name: 'core', filePath: 'src/core/index.ts', layer: 'ui', fanIn: 15},
                    {id: 'n2', kind: 'module', name: 'util', filePath: 'src/util/index.ts', layer: 'ui', fanIn: 1},
                ],
                edges: [],
            });
            const manifest = transformKGToFamilies(kg);
            const core = manifest.families.find((f) => f.id === 'core');
            const util = manifest.families.find((f) => f.id === 'util');
            assert.ok(core);
            assert.equal(core.priority, 'P0');
            assert.ok(util);
            assert.equal(util.priority, 'P2');
        });

        it('returns empty families for empty KG', () => {
            const kg = makeKG({nodes: [], edges: []});
            const manifest = transformKGToFamilies(kg);
            assert.equal(manifest.families.length, 0);
        });
    });
});

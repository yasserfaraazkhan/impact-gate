// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {scanFromKnowledgeGraph} from '../dist/training/kg_scanner.js';

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

describe('kg_scanner', () => {
    describe('scanFromKnowledgeGraph', () => {
        it('groups nodes into families by cluster', () => {
            const kg = makeKG({
                nodes: [
                    {id: 'n1', kind: 'module', name: 'auth', filePath: 'src/auth/login.ts', layer: 'ui'},
                    {id: 'n2', kind: 'module', name: 'auth', filePath: 'src/auth/register.ts', layer: 'ui'},
                    {id: 'n3', kind: 'module', name: 'settings', filePath: 'src/settings/profile.ts', layer: 'ui'},
                ],
                edges: [],
            });

            const result = scanFromKnowledgeGraph(kg);
            assert.ok(result.families.length >= 2);
            const auth = result.families.find((f) => f.id === 'auth');
            assert.ok(auth);
            assert.ok(auth.webappPaths.length > 0);

            const settings = result.families.find((f) => f.id === 'settings');
            assert.ok(settings);
        });

        it('assigns test layer nodes to specDirs', () => {
            const kg = makeKG({
                nodes: [
                    {id: 'n1', kind: 'module', name: 'auth', filePath: 'src/auth/login.ts', layer: 'ui'},
                    {id: 'n2', kind: 'file', name: 'auth.test', filePath: 'tests/auth/login.test.ts', layer: 'test'},
                ],
                edges: [],
            });

            const result = scanFromKnowledgeGraph(kg);
            const auth = result.families.find((f) => f.id === 'auth');
            assert.ok(auth);
            assert.ok(auth.specDirs.length > 0, 'should have specDirs from test nodes');
        });

        it('assigns api/service/data layers to serverPaths', () => {
            const kg = makeKG({
                nodes: [
                    {id: 'n1', kind: 'module', name: 'users', filePath: 'src/users/api.ts', layer: 'api'},
                    {id: 'n2', kind: 'module', name: 'users', filePath: 'src/users/service.ts', layer: 'service'},
                ],
                edges: [],
            });

            const result = scanFromKnowledgeGraph(kg);
            const users = result.families.find((f) => f.id === 'users');
            assert.ok(users, 'should have users family');
            assert.ok(users.serverPaths.length > 0, 'api/service nodes should produce serverPaths');
        });

        it('skips infra nodes', () => {
            const kg = makeKG({
                nodes: [
                    {id: 'n1', kind: 'module', name: 'docker', filePath: 'infra/docker/setup.ts', layer: 'infra'},
                ],
                edges: [],
            });

            const result = scanFromKnowledgeGraph(kg);
            assert.equal(result.families.length, 0);
        });

        it('paths with .. produce empty families (buildGlobFromPath rejection)', () => {
            const kg = makeKG({
                nodes: [
                    {id: 'n1', kind: 'module', name: 'evil', filePath: 'src/../etc/passwd', layer: 'ui'},
                ],
                edges: [],
            });

            const result = scanFromKnowledgeGraph(kg);
            // The node may cluster but the glob will be empty, so no paths
            // The family might exist with empty paths — or might be filtered out
            for (const fam of result.families) {
                for (const wp of fam.webappPaths) {
                    assert.ok(!wp.includes('..'), 'should not contain path traversal');
                }
                for (const sp of fam.serverPaths) {
                    assert.ok(!sp.includes('..'), 'should not contain path traversal');
                }
            }
        });

        it('returns proper stats', () => {
            const kg = makeKG({
                nodes: [
                    {id: 'n1', kind: 'module', name: 'auth', filePath: 'src/auth/login.ts', layer: 'ui'},
                    {id: 'n2', kind: 'file', name: 'auth.test', filePath: 'tests/auth/login.test.ts', layer: 'test'},
                ],
                edges: [],
            });

            const result = scanFromKnowledgeGraph(kg);
            assert.equal(result.stats.totalSourceFiles, 1);
            assert.equal(result.stats.totalTestFiles, 1);
            assert.ok(result.stats.familyCount >= 1);
        });
    });
});

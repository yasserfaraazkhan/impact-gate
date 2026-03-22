// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {serializeManifest} from '../dist/knowledge/route_families.js';

import type {RouteFamilyManifest} from '../dist/knowledge/route_families.js';

describe('serializeManifest', () => {
    it('strips empty optional arrays', () => {
        const manifest: RouteFamilyManifest = {
            families: [{
                id: 'auth',
                routes: ['/auth'],
                webappPaths: [],
                serverPaths: [],
                specDirs: [],
                tags: [],
                userFlows: [],
                features: [],
            }],
            source: 'test',
        };

        const output = JSON.parse(serializeManifest(manifest));
        const family = output.families[0];
        assert.equal(family.id, 'auth');
        assert.deepEqual(family.routes, ['/auth']);
        assert.equal(family.webappPaths, undefined);
        assert.equal(family.serverPaths, undefined);
        assert.equal(family.specDirs, undefined);
        assert.equal(family.tags, undefined);
        assert.equal(family.userFlows, undefined);
        assert.equal(family.features, undefined);
    });

    it('strips undefined priority and testType', () => {
        const manifest: RouteFamilyManifest = {
            families: [{
                id: 'auth',
                routes: ['/auth'],
            }],
            source: 'test',
        };

        const output = JSON.parse(serializeManifest(manifest));
        const family = output.families[0];
        assert.equal(family.priority, undefined);
        assert.equal(family.testType, undefined);
    });

    it('preserves non-empty fields', () => {
        const manifest: RouteFamilyManifest = {
            families: [{
                id: 'auth',
                routes: ['/auth'],
                priority: 'P0',
                testType: 'both',
                webappPaths: ['src/auth/*'],
                serverPaths: ['server/auth/*'],
                specDirs: ['tests/auth/'],
                tags: ['@smoke'],
                userFlows: ['Login flow'],
                apiEndpoints: [{method: 'POST', path: '/api/login'}],
            }],
            source: 'test',
        };

        const output = JSON.parse(serializeManifest(manifest));
        const family = output.families[0];
        assert.equal(family.priority, 'P0');
        assert.equal(family.testType, 'both');
        assert.deepEqual(family.webappPaths, ['src/auth/*']);
        assert.deepEqual(family.serverPaths, ['server/auth/*']);
        assert.deepEqual(family.specDirs, ['tests/auth/']);
        assert.deepEqual(family.tags, ['@smoke']);
        assert.deepEqual(family.userFlows, ['Login flow']);
        assert.deepEqual(family.apiEndpoints, [{method: 'POST', path: '/api/login'}]);
    });
});

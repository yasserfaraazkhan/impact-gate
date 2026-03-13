// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {mergeFamilies, detectStaleFamilies} from '../dist/training/merger.js';
import type {RouteFamily, RouteFamilyManifest} from '../dist/knowledge/route_families.js';
import type {ScannedFamily} from '../dist/training/types.js';

function makeManifest(families: RouteFamily[]): RouteFamilyManifest {
    return {families, source: 'test'};
}

function makeScanned(overrides: Partial<ScannedFamily> & {id: string}): ScannedFamily {
    return {
        routes: [`/${overrides.id}`],
        webappPaths: [],
        serverPaths: [],
        specDirs: [],
        cypressSpecDirs: [],
        tags: [],
        features: [],
        routesGuessed: true,
        ...overrides,
    };
}

describe('merger', () => {
    describe('mergeFamilies', () => {
        it('should add new families from scan', () => {
            const existing = makeManifest([]);
            const scanned = [makeScanned({id: 'channels', webappPaths: ['src/channels/*']})];
            const result = mergeFamilies(existing, scanned);
            assert.equal(result.newFamilies.length, 1);
            assert.equal(result.newFamilies[0], 'channels');
            assert.equal(result.manifest.families.length, 1);
        });

        it('should merge paths into existing families', () => {
            const existing = makeManifest([{
                id: 'channels',
                routes: ['/channels'],
                webappPaths: ['src/channels/*'],
            }]);
            const scanned = [makeScanned({
                id: 'channels',
                webappPaths: ['src/channels/*', 'webapp/channels/*'],
                serverPaths: ['server/channels/*'],
            })];
            const result = mergeFamilies(existing, scanned);
            assert.equal(result.updatedFamilies.length, 1);
            const family = result.manifest.families.find((f) => f.id === 'channels')!;
            assert.ok(family.webappPaths!.includes('webapp/channels/*'));
            assert.ok(family.serverPaths!.includes('server/channels/*'));
        });

        it('should not overwrite human-curated priority', () => {
            const existing = makeManifest([{
                id: 'channels',
                routes: ['/channels'],
                priority: 'P0',
            }]);
            const scanned = [makeScanned({id: 'channels'})];
            const result = mergeFamilies(existing, scanned);
            const family = result.manifest.families.find((f) => f.id === 'channels')!;
            assert.equal(family.priority, 'P0');
        });

        it('should not overwrite human-curated routes', () => {
            const existing = makeManifest([{
                id: 'channels',
                routes: ['/{team}/channels/{channel}'],
            }]);
            const scanned = [makeScanned({id: 'channels', routes: ['/channels']})];
            const result = mergeFamilies(existing, scanned);
            const family = result.manifest.families.find((f) => f.id === 'channels')!;
            assert.equal(family.routes[0], '/{team}/channels/{channel}');
        });

        it('should preserve existing families not found by scanner', () => {
            const existing = makeManifest([{
                id: 'custom',
                routes: ['/custom'],
                userFlows: ['Custom flow'],
            }]);
            const scanned = [makeScanned({id: 'channels'})];
            const result = mergeFamilies(existing, scanned);
            assert.ok(result.manifest.families.find((f) => f.id === 'custom'));
            assert.ok(result.manifest.families.find((f) => f.id === 'channels'));
        });
    });

    describe('detectStaleFamilies', () => {
        it('should detect families with no existing paths', () => {
            const manifest = makeManifest([{
                id: 'gone',
                routes: ['/gone'],
                webappPaths: ['nonexistent/path/*'],
                specDirs: ['nonexistent/tests/'],
            }]);
            const stale = detectStaleFamilies(manifest, '/tmp/no-such-project');
            assert.ok(stale.includes('gone'));
        });
    });
});

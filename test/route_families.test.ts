// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
    loadRouteFamilyManifest,
    bindFilesToFamilies,
    getFamilyById,
    getFeatureById,
    getSpecDirsForBinding,
    getRoutesForBinding,
    clearManifestCache,
} from '../dist/knowledge/route_families.js';

describe('route_families', () => {
    let tmpDir: string;

    beforeEach(() => {
        clearManifestCache();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-test-'));
        fs.mkdirSync(path.join(tmpDir, '.e2e-ai-agents'), {recursive: true});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    function writeManifest(data: any) {
        const filePath = path.join(tmpDir, '.e2e-ai-agents', 'route-families.json');
        fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    }

    describe('loadRouteFamilyManifest', () => {
        it('should load a valid manifest', () => {
            writeManifest({
                families: [{
                    id: 'channels',
                    routes: ['/{team}/channels/{channel}'],
                    pageObjects: ['ChannelsPage'],
                    webappPaths: ['webapp/channels/*'],
                    specDirs: ['specs/functional/channels/'],
                }],
            });
            const manifest = loadRouteFamilyManifest(tmpDir);
            assert.ok(manifest);
            assert.equal(manifest.families.length, 1);
            assert.equal(manifest.families[0].id, 'channels');
        });

        it('should return null for missing manifest', () => {
            const manifest = loadRouteFamilyManifest(tmpDir);
            assert.equal(manifest, null);
        });

        it('should warn (not throw) in strict mode when manifest is missing', () => {
            // strict mode now warns via logger.warn → console.error
            const warnMessages: string[] = [];
            const origError = console.error;
            console.error = (...args: any[]) => { warnMessages.push(args.join(' ')); };
            let result;
            try {
                result = loadRouteFamilyManifest(tmpDir, {strict: true});
            } finally {
                console.error = origError;
            }
            assert.equal(result, null);
            assert.ok(warnMessages.some((m) => m.includes('Route family manifest not found')));
        });

        it('should skip invalid families', () => {
            writeManifest({
                families: [
                    {id: 'valid', routes: ['/test']},
                    {id: '', routes: ['/bad']},
                    {routes: ['/no-id']},
                    {id: 'no_routes'},
                ],
            });
            const manifest = loadRouteFamilyManifest(tmpDir);
            assert.ok(manifest);
            assert.equal(manifest.families.length, 1);
            assert.equal(manifest.families[0].id, 'valid');
        });

        it('should load nested features', () => {
            writeManifest({
                families: [{
                    id: 'system_console',
                    routes: ['/admin_console'],
                    features: [
                        {
                            id: 'system_console/permissions',
                            routes: ['/admin_console/user_management/permissions'],
                            webappPaths: ['webapp/admin_console/permission*'],
                            specDirs: ['specs/functional/system_console/permissions/'],
                        },
                        {
                            id: 'system_console/users',
                            webappPaths: ['webapp/admin_console/system_users*'],
                        },
                    ],
                }],
            });
            const manifest = loadRouteFamilyManifest(tmpDir);
            assert.ok(manifest);
            assert.equal(manifest.families[0].features.length, 2);
            assert.equal(manifest.families[0].features[0].id, 'system_console/permissions');
        });

        it('should use cache on repeated loads', () => {
            writeManifest({families: [{id: 'test', routes: ['/t']}]});
            const m1 = loadRouteFamilyManifest(tmpDir);
            const m2 = loadRouteFamilyManifest(tmpDir);
            assert.ok(m1);
            assert.ok(m2);
            assert.deepEqual(m1, m2);
        });
    });

    describe('bindFilesToFamilies', () => {
        it('should bind files to families via webappPaths', () => {
            writeManifest({
                families: [{
                    id: 'channels',
                    routes: ['/'],
                    webappPaths: ['webapp/channels/*'],
                }],
            });
            const manifest = loadRouteFamilyManifest(tmpDir);
            const bindings = bindFilesToFamilies(
                ['webapp/channels/post.tsx', 'webapp/other/foo.ts'],
                manifest,
            );
            assert.equal(bindings.length, 2);
            assert.equal(bindings[0].bindings.length, 1);
            assert.equal(bindings[0].bindings[0].family, 'channels');
            assert.equal(bindings[1].bindings.length, 0);
        });

        it('should bind files to features preferring feature over family', () => {
            writeManifest({
                families: [{
                    id: 'system_console',
                    routes: ['/admin_console'],
                    webappPaths: ['webapp/admin_console/*'],
                    features: [{
                        id: 'system_console/permissions',
                        webappPaths: ['webapp/admin_console/permission*'],
                    }],
                }],
            });
            const manifest = loadRouteFamilyManifest(tmpDir);
            const bindings = bindFilesToFamilies(
                ['webapp/admin_console/permissions_editor.tsx', 'webapp/admin_console/general.tsx'],
                manifest,
            );
            // permissions file should bind to feature
            assert.equal(bindings[0].bindings.length, 1);
            assert.equal(bindings[0].bindings[0].family, 'system_console');
            assert.equal(bindings[0].bindings[0].feature, 'system_console/permissions');
            // general file should bind to family level
            assert.equal(bindings[1].bindings.length, 1);
            assert.equal(bindings[1].bindings[0].family, 'system_console');
            assert.equal(bindings[1].bindings[0].feature, undefined);
        });

        it('should bind server files to multiple families', () => {
            writeManifest({
                families: [
                    {
                        id: 'channels',
                        routes: ['/'],
                        serverPaths: ['server/app/limit*'],
                    },
                    {
                        id: 'system_console',
                        routes: ['/admin_console'],
                        serverPaths: ['server/app/limit*'],
                    },
                ],
            });
            const manifest = loadRouteFamilyManifest(tmpDir);
            const bindings = bindFilesToFamilies(['server/app/limits.go'], manifest);
            assert.equal(bindings[0].bindings.length, 2);
            const families = bindings[0].bindings.map((b: any) => b.family).sort();
            assert.deepEqual(families, ['channels', 'system_console']);
        });
    });

    describe('helper functions', () => {
        it('getFamilyById should find family', () => {
            writeManifest({families: [{id: 'test', routes: ['/']}]});
            const manifest = loadRouteFamilyManifest(tmpDir);
            assert.ok(getFamilyById(manifest, 'test'));
            assert.equal(getFamilyById(manifest, 'missing'), undefined);
        });

        it('getFeatureById should find feature', () => {
            const family = {
                id: 'sc',
                routes: ['/admin'],
                features: [{id: 'sc/perms', routes: ['/admin/perms']}],
            };
            assert.ok(getFeatureById(family, 'sc/perms'));
            assert.equal(getFeatureById(family, 'missing'), undefined);
        });

        it('getSpecDirsForBinding should return feature specDirs when available', () => {
            writeManifest({
                families: [{
                    id: 'sc',
                    routes: ['/admin'],
                    specDirs: ['specs/sc/'],
                    features: [{
                        id: 'sc/perms',
                        specDirs: ['specs/sc/permissions/'],
                    }],
                }],
            });
            const manifest = loadRouteFamilyManifest(tmpDir);
            const featureDirs = getSpecDirsForBinding(manifest, {family: 'sc', feature: 'sc/perms'});
            assert.deepEqual(featureDirs, ['specs/sc/permissions/']);
            const familyDirs = getSpecDirsForBinding(manifest, {family: 'sc'});
            assert.deepEqual(familyDirs, ['specs/sc/']);
        });

        it('getRoutesForBinding should return feature routes when available', () => {
            writeManifest({
                families: [{
                    id: 'sc',
                    routes: ['/admin'],
                    features: [{
                        id: 'sc/perms',
                        routes: ['/admin/perms'],
                    }],
                }],
            });
            const manifest = loadRouteFamilyManifest(tmpDir);
            const featureRoutes = getRoutesForBinding(manifest, {family: 'sc', feature: 'sc/perms'});
            assert.deepEqual(featureRoutes, ['/admin/perms']);
            const familyRoutes = getRoutesForBinding(manifest, {family: 'sc'});
            assert.deepEqual(familyRoutes, ['/admin']);
        });
    });
});

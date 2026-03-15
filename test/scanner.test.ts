// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {discoverSourceDirs, discoverTestDirs, discoverTestDerivedFamilies, discoverServerDerivedFamilies, discoverTestLibPaths, discoverNameMatchedPaths, scanProject} from '../dist/training/scanner.js';

describe('scanner', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'train-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    function mkdirs(...dirs: string[]) {
        for (const d of dirs) {
            fs.mkdirSync(path.join(tmpDir, d), {recursive: true});
        }
    }

    function touch(...files: string[]) {
        for (const f of files) {
            const full = path.join(tmpDir, f);
            fs.mkdirSync(path.dirname(full), {recursive: true});
            fs.writeFileSync(full, '// stub', 'utf-8');
        }
    }

    describe('discoverSourceDirs', () => {
        it('should discover frontend source directories', () => {
            touch('src/channels/index.ts', 'src/messaging/list.tsx');
            const dirs = discoverSourceDirs(tmpDir);
            const hints = dirs.map((d) => d.familyHint);
            assert.ok(hints.includes('channels'));
            assert.ok(hints.includes('messaging'));
        });

        it('should discover backend server directories', () => {
            touch('server/channels/handler.go');
            const dirs = discoverSourceDirs(tmpDir);
            const serverDirs = dirs.filter((d) => d.category === 'server');
            assert.ok(serverDirs.length > 0);
        });

        it('should skip node_modules and hidden directories', () => {
            mkdirs('node_modules/pkg/src', '.git/objects');
            touch('src/auth/login.ts');
            const dirs = discoverSourceDirs(tmpDir);
            assert.ok(dirs.every((d) => !d.path.includes('node_modules')));
            assert.ok(dirs.every((d) => !d.path.includes('.git')));
        });
    });

    describe('discoverTestDirs', () => {
        it('should discover Playwright spec directories', () => {
            touch(
                'tests/e2e/channels/channel.spec.ts',
                'tests/e2e/messaging/dm.spec.ts',
            );
            const dirs = discoverTestDirs(tmpDir);
            const hints = dirs.map((d) => d.familyHint);
            assert.ok(hints.includes('channels'));
            assert.ok(hints.includes('messaging'));
        });

        it('should discover Cypress test directories', () => {
            touch('cypress/e2e/channels/channel.spec.js');
            const dirs = discoverTestDirs(tmpDir);
            assert.ok(dirs.some((d) => d.category === 'cypress'));
        });

        it('should discover Go test files', () => {
            touch('server/channels/handler_test.go');
            const dirs = discoverTestDirs(tmpDir);
            assert.ok(dirs.some((d) => d.familyHint === 'channels'));
        });
    });

    describe('scanProject', () => {
        it('should match source and test dirs into families', () => {
            touch(
                'src/channels/index.ts',
                'server/channels/handler.go',
                'tests/e2e/channels/channel.spec.ts',
            );
            const result = scanProject(tmpDir);
            assert.ok(result.families.length >= 1);
            const channels = result.families.find((f) => f.id === 'channels');
            assert.ok(channels, 'should have channels family');
            assert.ok(channels.webappPaths.length > 0);
            assert.ok(channels.serverPaths.length > 0);
            assert.ok(channels.specDirs.length > 0);
        });

        it('should detect nested features', () => {
            touch(
                'src/channels/index.ts',
                'src/channels/search/search.tsx',
                'tests/e2e/channels/channel.spec.ts',
                'tests/e2e/channels/search/search.spec.ts',
            );
            const result = scanProject(tmpDir);
            const channels = result.families.find((f) => f.id === 'channels');
            assert.ok(channels);
            assert.ok(channels.features.length > 0);
            const searchFeature = channels.features.find((f) => f.id === 'channels/search');
            assert.ok(searchFeature, 'should have channels/search feature');
        });

        it('should create families with incomplete coverage', () => {
            touch(
                'src/analytics/helpers.ts',
                'tests/e2e/channels/channel.spec.ts',
            );
            const result = scanProject(tmpDir);
            // analytics has source but no tests
            const analytics = result.families.find((f) => f.id === 'analytics');
            assert.ok(analytics, 'should discover analytics family');
            assert.equal(analytics.specDirs.length, 0, 'analytics should have no test dirs');
            // channels has tests but no source
            const channels = result.families.find((f) => f.id === 'channels');
            assert.ok(channels, 'should discover channels family');
            assert.equal(channels.webappPaths.length, 0, 'channels should have no webapp paths');
        });

        it('should generate valid route strings', () => {
            touch(
                'src/channels/index.ts',
                'tests/e2e/channels/channel.spec.ts',
            );
            const result = scanProject(tmpDir);
            const channels = result.families.find((f) => f.id === 'channels');
            assert.ok(channels);
            assert.ok(channels.routes.length > 0);
            assert.ok(typeof channels.routes[0] === 'string');
            assert.ok(channels.routes[0].startsWith('/'));
        });

        it('should discover test-derived families from separate testsRoot', () => {
            // Create a project with feature-organized tests
            const testsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tests-root-'));
            try {
                // Source dir (code-type organized)
                touch('src/components/index.ts');
                // Tests (feature-organized) in separate root
                const specFiles = [
                    'specs/functional/channels/drafts/draft.spec.ts',
                    'specs/functional/channels/search/search.spec.ts',
                    'specs/functional/system_console/permissions/perm.spec.ts',
                ];
                for (const f of specFiles) {
                    const full = path.join(testsDir, f);
                    fs.mkdirSync(path.dirname(full), {recursive: true});
                    fs.writeFileSync(full, '// stub', 'utf-8');
                }

                const result = scanProject(tmpDir, testsDir);
                const drafts = result.families.find((f) => f.id === 'drafts');
                assert.ok(drafts, 'should discover drafts family from test dirs');
                assert.ok(drafts.specDirs.length > 0, 'drafts should have specDirs');
                assert.equal(drafts.webappPaths.length, 0, 'drafts should have no webapp paths (test-derived)');

                const search = result.families.find((f) => f.id === 'search');
                assert.ok(search, 'should discover search family from test dirs');
            } finally {
                fs.rmSync(testsDir, {recursive: true, force: true});
            }
        });

        it('should handle name collisions in test-derived families', () => {
            const testsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tests-coll-'));
            try {
                const specFiles = [
                    'specs/functional/channels/settings/notif.spec.ts',
                    'specs/functional/system_console/settings/notif.spec.ts',
                ];
                for (const f of specFiles) {
                    const full = path.join(testsDir, f);
                    fs.mkdirSync(path.dirname(full), {recursive: true});
                    fs.writeFileSync(full, '// stub', 'utf-8');
                }

                const families = discoverTestDerivedFamilies(testsDir);
                // "settings" appears under both channels and system_console — should be prefixed
                assert.ok(families.length >= 2, 'should have at least 2 families');
                const ids = families.map((f) => f.id);
                assert.ok(
                    ids.includes('channels_settings') || ids.includes('system_console_settings'),
                    'should prefix colliding names with parent',
                );
            } finally {
                fs.rmSync(testsDir, {recursive: true, force: true});
            }
        });

        it('should discover server-derived families from Go files', () => {
            const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-'));
            try {
                // Create a multi-tier server structure
                const goFiles = [
                    'channels/api4/draft.go',
                    'channels/app/draft.go',
                    'channels/store/sqlstore/draft_store.go',
                    'channels/api4/webhook.go',
                    'channels/app/webhook.go',
                ];
                for (const f of goFiles) {
                    const full = path.join(serverDir, f);
                    fs.mkdirSync(path.dirname(full), {recursive: true});
                    fs.writeFileSync(full, 'package main', 'utf-8');
                }

                const {multiTierFamilies} = discoverServerDerivedFamilies(serverDir);
                const draft = multiTierFamilies.find((f) => f.id === 'draft');
                assert.ok(draft, 'should discover draft family');
                assert.ok(draft.serverPaths.length >= 2, 'draft should span multiple tiers');

                const webhook = multiTierFamilies.find((f) => f.id === 'webhook');
                assert.ok(webhook, 'should discover webhook family');
            } finally {
                fs.rmSync(serverDir, {recursive: true, force: true});
            }
        });

        it('should group related server files under parent domain', () => {
            const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-grp-'));
            try {
                const goFiles = [
                    'channels/api4/channel.go',
                    'channels/api4/channel_bookmark.go',
                    'channels/api4/channel_category.go',
                    'channels/app/channel.go',
                ];
                for (const f of goFiles) {
                    const full = path.join(serverDir, f);
                    fs.mkdirSync(path.dirname(full), {recursive: true});
                    fs.writeFileSync(full, 'package main', 'utf-8');
                }

                const {multiTierFamilies} = discoverServerDerivedFamilies(serverDir);
                // channel_bookmark and channel_category should be grouped under "channel"
                const channel = multiTierFamilies.find((f) => f.id === 'channel');
                assert.ok(channel, 'should group under channel family');
                assert.ok(channel.serverPaths.length >= 3, 'channel should include all related files');
                assert.ok(!multiTierFamilies.find((f) => f.id === 'channel_bookmark'), 'channel_bookmark should not be separate');
            } finally {
                fs.rmSync(serverDir, {recursive: true, force: true});
            }
        });

        it('should filter single-tier server families', () => {
            const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-filt-'));
            try {
                // Only one tier — should be filtered out
                const full = path.join(serverDir, 'channels/api4/trivial.go');
                fs.mkdirSync(path.dirname(full), {recursive: true});
                fs.writeFileSync(full, 'package main', 'utf-8');

                const {multiTierFamilies, singleTierFamilies} = discoverServerDerivedFamilies(serverDir);
                assert.ok(!multiTierFamilies.find((f) => f.id === 'trivial'), 'single-tier family should not be in multi-tier');
                assert.ok(singleTierFamilies.find((f) => f.id === 'trivial'), 'single-tier family should be in singleTierFamilies');
            } finally {
                fs.rmSync(serverDir, {recursive: true, force: true});
            }
        });

        it('should merge server families into scan via scanProject', () => {
            // Create server root
            const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-scan-'));
            try {
                const goFiles = [
                    'channels/api4/draft.go',
                    'channels/app/draft.go',
                ];
                for (const f of goFiles) {
                    const full = path.join(serverDir, f);
                    fs.mkdirSync(path.dirname(full), {recursive: true});
                    fs.writeFileSync(full, 'package main', 'utf-8');
                }

                // Source with matching family
                touch('src/channels/index.ts', 'tests/e2e/channels/channel.spec.ts');

                const result = scanProject(tmpDir, undefined, serverDir);
                const draft = result.families.find((f) => f.id === 'draft');
                assert.ok(draft, 'should have draft family from server');
                assert.ok(draft.serverPaths.length > 0, 'draft should have server paths');
            } finally {
                fs.rmSync(serverDir, {recursive: true, force: true});
            }
        });

        it('should merge single-tier server files into existing families', () => {
            const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-single-'));
            try {
                // Create channel family in source + tests
                touch('src/channels/index.ts', 'tests/e2e/channels/channel.spec.ts');
                // Single-tier server file for channel (only model, no api4/app)
                const full = path.join(serverDir, 'public/model/channel.go');
                fs.mkdirSync(path.dirname(full), {recursive: true});
                fs.writeFileSync(full, 'package model', 'utf-8');

                const result = scanProject(tmpDir, undefined, serverDir);
                const channels = result.families.find((f) => f.id === 'channels');
                assert.ok(channels, 'should have channels family');
                // The single-tier "channel" server family should merge into "channels" (plural match)
                assert.ok(
                    channels.serverPaths.some((p) => p.includes('model/channel')),
                    'channels family should include model/channel server paths',
                );
            } finally {
                fs.rmSync(serverDir, {recursive: true, force: true});
            }
        });

        it('should discover test lib paths and merge into families', () => {
            const testsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tests-lib-'));
            try {
                // Create test lib structure
                const libFiles = [
                    'lib/src/ui/components/channels/channel_page.ts',
                    'lib/src/ui/components/system_console/console_page.ts',
                ];
                for (const f of libFiles) {
                    const full = path.join(testsDir, f);
                    fs.mkdirSync(path.dirname(full), {recursive: true});
                    fs.writeFileSync(full, '// page object', 'utf-8');
                }

                const paths = discoverTestLibPaths(testsDir);
                assert.ok(paths.has('channels'), 'should discover channels lib path');
                assert.ok(paths.has('system_console'), 'should discover system_console lib path');
            } finally {
                fs.rmSync(testsDir, {recursive: true, force: true});
            }
        });

        it('should discover name-matched type/util files', () => {
            touch('src/utils/channels.ts', 'src/utils/drafts.ts', 'src/types/posts.ts');
            const paths = discoverNameMatchedPaths(tmpDir);
            assert.ok(paths.has('channels'), 'should discover channels from utils');
            assert.ok(paths.has('drafts'), 'should discover drafts from utils');
            assert.ok(paths.has('posts'), 'should discover posts from types');
        });

        it('should extract tags from spec files', () => {
            const specContent = `
import {test} from '@playwright/test';
test.describe('Channel @channels', () => {
    test('should create channel @smoke', async () => {});
});`;
            const specPath = path.join(tmpDir, 'tests/e2e/channels/channel.spec.ts');
            fs.mkdirSync(path.dirname(specPath), {recursive: true});
            fs.writeFileSync(specPath, specContent, 'utf-8');
            touch('src/channels/index.ts');
            const result = scanProject(tmpDir);
            const channels = result.families.find((f) => f.id === 'channels');
            assert.ok(channels);
            assert.ok(channels.tags.includes('@channels') || channels.tags.includes('@smoke'));
        });
    });
});

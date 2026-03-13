// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {discoverSourceDirs, discoverTestDirs, scanProject} from '../dist/training/scanner.js';

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
                'src/utils/helpers.ts',
                'tests/e2e/channels/channel.spec.ts',
            );
            const result = scanProject(tmpDir);
            // utils has source but no tests
            const utils = result.families.find((f) => f.id === 'utils');
            assert.ok(utils, 'should discover utils family');
            assert.equal(utils.specDirs.length, 0, 'utils should have no test dirs');
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

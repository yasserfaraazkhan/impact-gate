// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {buildValidationReport, formatValidationReport, parseGitLog, isInfraFile} from '../dist/training/validator.js';
import type {RouteFamilyManifest} from '../dist/knowledge/route_families.js';
import type {CommitValidation} from '../dist/training/types.js';

describe('validator', () => {
    describe('buildValidationReport', () => {
        it('should calculate coverage from commit validations', () => {
            const commits: CommitValidation[] = [
                {
                    hash: 'abc123',
                    message: 'fix channels',
                    changedFiles: ['src/channels/index.ts', 'src/utils/helpers.ts'],
                    boundFiles: 1,
                    unboundFiles: ['src/utils/helpers.ts'],
                    familiesHit: ['channels'],
                },
                {
                    hash: 'def456',
                    message: 'update auth',
                    changedFiles: ['src/auth/login.ts'],
                    boundFiles: 1,
                    unboundFiles: [],
                    familiesHit: ['auth'],
                },
            ];
            const manifest: RouteFamilyManifest = {
                families: [
                    {id: 'channels', routes: ['/channels']},
                    {id: 'auth', routes: ['/auth']},
                    {id: 'search', routes: ['/search']},
                ],
                source: 'test',
            };
            const report = buildValidationReport(commits, manifest);
            assert.equal(report.totalCommits, 2);
            assert.equal(report.totalFiles, 3);
            assert.equal(report.boundFiles, 2);
            assert.equal(report.unboundFiles, 1);
            assert.ok(report.coveragePercent > 60);
            assert.ok(report.neverHitFamilies.includes('search'));
        });
    });

    describe('parseGitLog', () => {
        it('should parse standard git log output with two commits', () => {
            const log = 'abc1234|fix: channels bug\nsrc/channels/index.ts\nsrc/channels/list.tsx\n\ndef5678|feat: add auth\nsrc/auth/login.ts';
            const result = parseGitLog(log);
            assert.equal(result.length, 2);
            assert.equal(result[0].hash, 'abc1234');
            assert.equal(result[0].message, 'fix: channels bug');
            assert.deepEqual(result[0].files, ['src/channels/index.ts', 'src/channels/list.tsx']);
            assert.equal(result[1].hash, 'def5678');
            assert.equal(result[1].message, 'feat: add auth');
            assert.deepEqual(result[1].files, ['src/auth/login.ts']);
        });

        it('should handle commit message containing pipe character', () => {
            const log = 'abc1234|fix: use a|b pattern\nfile.ts';
            const result = parseGitLog(log);
            assert.equal(result.length, 1);
            assert.equal(result[0].hash, 'abc1234');
            assert.equal(result[0].message, 'fix: use a|b pattern');
            assert.deepEqual(result[0].files, ['file.ts']);
        });

        it('should return empty array for empty log', () => {
            const result = parseGitLog('');
            assert.deepEqual(result, []);
        });

        it('should handle single commit with no trailing newline', () => {
            const log = 'abc1234|feat: something\nfile.ts';
            const result = parseGitLog(log);
            assert.equal(result.length, 1);
            assert.equal(result[0].hash, 'abc1234');
            assert.equal(result[0].message, 'feat: something');
            assert.deepEqual(result[0].files, ['file.ts']);
        });

        it('should not create empty commits from consecutive blank lines', () => {
            const log = 'abc1234|fix: first\nfile1.ts\n\n\n\ndef5678|fix: second\nfile2.ts\n\n\n';
            const result = parseGitLog(log);
            assert.equal(result.length, 2);
            assert.equal(result[0].hash, 'abc1234');
            assert.equal(result[1].hash, 'def5678');
        });
    });

    describe('isInfraFile', () => {
        it('should match infrastructure files', () => {
            assert.ok(isInfraFile('Makefile'));
            assert.ok(isInfraFile('go.mod'));
            assert.ok(isInfraFile('go.sum'));
            assert.ok(isInfraFile('package-lock.lock'));
            assert.ok(isInfraFile('server/mocks/store.go'));
            assert.ok(isInfraFile('server/channels/storetest/helper.go'));
            assert.ok(isInfraFile('server/testlib/helper.go'));
            assert.ok(isInfraFile('webapp/i18n/en.json'));
            assert.ok(isInfraFile('.github/workflows/ci.yml'));
            assert.ok(isInfraFile('scripts/deploy.sh'));
            assert.ok(isInfraFile('docker-compose.yml'));
            assert.ok(isInfraFile('path/to/docker-compose.override.yml'));
            assert.ok(isInfraFile('test/__fixtures__/sample.ts'));
            assert.ok(isInfraFile('e2e/test_templates/basic.ts'));
        });

        it('should not match regular source files', () => {
            assert.ok(!isInfraFile('src/channels/index.ts'));
            assert.ok(!isInfraFile('server/channels/api4/channel.go'));
            assert.ok(!isInfraFile('webapp/src/utils/helpers.ts'));
        });
    });

    describe('formatValidationReport', () => {
        it('should produce readable output', () => {
            const commits: CommitValidation[] = [{
                hash: 'abc123',
                message: 'fix channels',
                changedFiles: ['src/channels/index.ts'],
                boundFiles: 1,
                unboundFiles: [],
                familiesHit: ['channels'],
            }];
            const manifest: RouteFamilyManifest = {
                families: [{id: 'channels', routes: ['/channels']}],
                source: 'test',
            };
            const report = buildValidationReport(commits, manifest);
            const output = formatValidationReport(report);
            assert.ok(output.includes('Coverage:'));
            assert.ok(output.includes('100%'));
        });
    });
});

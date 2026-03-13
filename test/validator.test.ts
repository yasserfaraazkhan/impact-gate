// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {buildValidationReport, formatValidationReport} from '../dist/training/validator.js';
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

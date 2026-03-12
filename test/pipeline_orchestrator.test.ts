// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {preprocess} from '../dist/pipeline/stage0_preprocess.js';
import {buildSummary, validateFlowDecision} from '../dist/validation/output_schema.js';
import {computeConfidence, shouldForceCannotDetermine, computeCannotDetermineRatio, computeOverallConfidence} from '../dist/validation/guardrails.js';
import {clearManifestCache} from '../dist/knowledge/route_families.js';

describe('stage0_preprocess', () => {
    let tmpDir: string;

    beforeEach(() => {
        clearManifestCache();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-test-'));
        fs.mkdirSync(path.join(tmpDir, '.e2e-ai-agents'), {recursive: true});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    it('should produce warnings when no manifest is found', () => {
        const result = preprocess(['webapp/channels/post.tsx'], {
            appPath: tmpDir,
            testsRoot: tmpDir,
        });
        assert.ok(result.warnings.some((w: string) => w.includes('Route family manifest not found')));
        assert.equal(result.manifest, null);
        assert.equal(result.familyGroups.length, 0);
        assert.equal(result.unboundFiles.length, 1);
    });

    it('should group files by family when manifest exists', () => {
        fs.writeFileSync(
            path.join(tmpDir, '.e2e-ai-agents', 'route-families.json'),
            JSON.stringify({
                families: [
                    {id: 'channels', routes: ['/'], webappPaths: ['webapp/channels/*']},
                    {id: 'auth', routes: ['/login'], webappPaths: ['webapp/login/*']},
                ],
            }),
        );
        const result = preprocess(
            ['webapp/channels/post.tsx', 'webapp/channels/sidebar.tsx', 'webapp/login/form.tsx', 'webapp/other/x.ts'],
            {appPath: tmpDir, testsRoot: tmpDir},
        );
        assert.ok(result.manifest);
        assert.equal(result.familyGroups.length, 2);
        const channelsGroup = result.familyGroups.find((g: any) => g.familyId === 'channels');
        assert.ok(channelsGroup);
        assert.equal(channelsGroup.files.length, 2);
        assert.equal(result.unboundFiles.length, 1);
    });

    it('should create feature-level groups', () => {
        fs.writeFileSync(
            path.join(tmpDir, '.e2e-ai-agents', 'route-families.json'),
            JSON.stringify({
                families: [{
                    id: 'system_console',
                    routes: ['/admin_console'],
                    webappPaths: ['webapp/admin/*'],
                    features: [{
                        id: 'sc/perms',
                        webappPaths: ['webapp/admin/perm*'],
                    }],
                }],
            }),
        );
        const result = preprocess(
            ['webapp/admin/permissions.tsx', 'webapp/admin/general.tsx'],
            {appPath: tmpDir, testsRoot: tmpDir},
        );
        assert.equal(result.familyGroups.length, 2);
        const featureGroup = result.familyGroups.find((g: any) => g.featureId === 'sc/perms');
        assert.ok(featureGroup);
        assert.equal(featureGroup.files.length, 1);
    });
});

describe('output_schema', () => {
    describe('validateFlowDecision', () => {
        it('should validate a correct decision', () => {
            const decision = {
                flowId: 'posting',
                flowName: 'Message posting',
                routeFamily: 'channels',
                changedFiles: ['post.tsx'],
                evidence: 'Changed posting code',
                evidenceSource: 'ai',
                confidence: 75,
                action: 'run_existing',
                priority: 'P0',
                existingSpecs: [],
                userActions: ['post a message'],
            };
            const result = validateFlowDecision(decision);
            assert.equal(result.valid, true);
            assert.equal(result.errors.length, 0);
        });

        it('should reject missing required fields', () => {
            const result = validateFlowDecision({});
            assert.equal(result.valid, false);
            assert.ok(result.errors.length > 0);
        });

        it('should require blockingReason for cannot_determine', () => {
            const decision = {
                flowId: 'x',
                flowName: 'x',
                routeFamily: 'x',
                changedFiles: [],
                evidence: 'x',
                evidenceSource: 'ai',
                confidence: 10,
                action: 'cannot_determine',
                priority: 'P2',
            };
            const result = validateFlowDecision(decision);
            assert.ok(result.errors.some((e: string) => e.includes('blockingReason')));
        });

        it('should require scenariosToAdd for add_scenarios', () => {
            const decision = {
                flowId: 'x',
                flowName: 'x',
                routeFamily: 'x',
                changedFiles: [],
                evidence: 'x',
                evidenceSource: 'ai',
                confidence: 60,
                action: 'add_scenarios',
                priority: 'P1',
            };
            const result = validateFlowDecision(decision);
            assert.ok(result.errors.some((e: string) => e.includes('scenariosToAdd')));
        });
    });

    describe('buildSummary', () => {
        it('should compute correct summary', () => {
            const decisions = [
                {flowId: 'a', routeFamily: 'channels', action: 'run_existing', confidence: 80, changedFiles: ['a.ts']},
                {flowId: 'b', routeFamily: 'channels', action: 'add_scenarios', confidence: 60, changedFiles: ['b.ts']},
                {flowId: 'c', routeFamily: 'auth', action: 'create_spec', confidence: 70, changedFiles: ['c.ts']},
                {flowId: 'd', routeFamily: 'auth', action: 'cannot_determine', confidence: 10, changedFiles: ['d.ts']},
            ];
            const summary = buildSummary(decisions);
            assert.equal(summary.flowsIdentified, 4);
            assert.equal(summary.flowsCovered, 1);
            assert.equal(summary.flowsPartial, 1);
            assert.equal(summary.flowsUncovered, 1);
            assert.equal(summary.actionsRequired.cannot_determine, 1);
            assert.deepEqual(summary.routeFamiliesImpacted, ['auth', 'channels']);
        });

        it('should return low confidence for empty decisions', () => {
            const summary = buildSummary([]);
            assert.equal(summary.overallConfidence, 'low');
        });
    });
});

describe('guardrails', () => {
    it('computeConfidence should sum evidence scores', () => {
        const score = computeConfidence({
            hasRouteFamily: true,
            hasSpecificRoute: true,
            hasPageObject: true,
            hasUserAction: true,
            hasExistingSpecCited: true,
        });
        assert.equal(score, 100);

        const low = computeConfidence({
            hasRouteFamily: false,
            hasSpecificRoute: false,
            hasPageObject: false,
            hasUserAction: false,
            hasExistingSpecCited: false,
        });
        assert.equal(low, 0);
    });

    it('shouldForceCannotDetermine should be true below threshold', () => {
        assert.equal(shouldForceCannotDetermine(10), true);
        assert.equal(shouldForceCannotDetermine(50), false);
    });

    it('computeCannotDetermineRatio should calculate correctly', () => {
        assert.equal(computeCannotDetermineRatio([]), 0);
        assert.equal(computeCannotDetermineRatio([
            {action: 'cannot_determine'},
            {action: 'run_existing'},
        ]), 0.5);
    });

    it('computeOverallConfidence should classify correctly', () => {
        assert.equal(computeOverallConfidence([]), 'low');
        assert.equal(computeOverallConfidence([
            {confidence: 90, action: 'run_existing'},
            {confidence: 80, action: 'add_scenarios'},
        ]), 'high');
        assert.equal(computeOverallConfidence([
            {confidence: 20, action: 'run_existing'},
        ]), 'low');
    });
});

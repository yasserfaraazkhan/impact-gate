// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {buildHealPrompt, buildQualityFixPrompt} from '../dist/prompts/heal.js';
import {resolveHealTargets, renderHealMarkdown} from '../dist/pipeline/stage4_heal.js';

const MOCK_DECISION = {
    flowId: 'search_find_channels',
    flowName: 'Find channels via search',
    routeFamily: 'channels',
    featureId: 'channels/search',
    specificRoute: '/{team}/channels/{channel}',
    changedFiles: ['webapp/channels/src/components/search/search_box.tsx'],
    evidence: 'Changed search box component',
    evidenceSource: 'ai',
    confidence: 80,
    existingSpecs: [{path: 'specs/functional/channels/search/find_channels.spec.ts', testTitles: ['user can find a channel'], coverageLevel: 'partial'}],
    action: 'add_scenarios',
    targetSpec: 'specs/functional/channels/search/find_channels.spec.ts',
    priority: 'P1',
    userActions: ['search for a channel by name', 'select the channel from results'],
    scenariosToAdd: ['search for channel by partial name match'],
};

describe('heal prompts', () => {
    describe('buildHealPrompt', () => {
        it('should include spec path and status', () => {
            const prompt = buildHealPrompt({
                specPath: 'specs/functional/channels/search/find_channels.spec.ts',
                status: 'failed',
            });
            assert.ok(prompt.includes('find_channels.spec.ts'));
            assert.ok(prompt.includes('FAILING'));
        });

        it('should distinguish flaky vs failed', () => {
            const failedPrompt = buildHealPrompt({
                specPath: 'specs/test.spec.ts',
                status: 'failed',
            });
            const flakyPrompt = buildHealPrompt({
                specPath: 'specs/test.spec.ts',
                status: 'flaky',
            });
            assert.ok(failedPrompt.includes('FAILING'));
            assert.ok(flakyPrompt.includes('FLAKY'));
            assert.ok(flakyPrompt.includes('race conditions') || flakyPrompt.includes('waits'));
        });

        it('should include flow context when decision is provided', () => {
            const prompt = buildHealPrompt({
                specPath: 'specs/test.spec.ts',
                status: 'failed',
                decision: MOCK_DECISION,
            });
            assert.ok(prompt.includes('Find channels via search'));
            assert.ok(prompt.includes('channels/search'));
            assert.ok(prompt.includes('search for a channel by name'));
        });

        it('should include failure detail when provided', () => {
            const prompt = buildHealPrompt({
                specPath: 'specs/test.spec.ts',
                status: 'failed',
                failureDetail: 'TimeoutError: locator.click() timed out after 30000ms',
            });
            assert.ok(prompt.includes('TimeoutError'));
        });

        it('should enforce playwright-lib constraint', () => {
            const prompt = buildHealPrompt({
                specPath: 'specs/test.spec.ts',
                status: 'flaky',
            });
            assert.ok(prompt.includes('@mattermost/playwright-lib'));
            assert.ok(prompt.includes('test.describe'));
        });
    });

    describe('buildQualityFixPrompt', () => {
        it('should include spec path and issues', () => {
            const prompt = buildQualityFixPrompt('specs/test.spec.ts', [
                'Found test.describe wrapper',
                'Missing tag string',
            ]);
            assert.ok(prompt.includes('specs/test.spec.ts'));
            assert.ok(prompt.includes('test.describe wrapper'));
            assert.ok(prompt.includes('Missing tag string'));
        });
    });
});

describe('resolveHealTargets', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    it('should return empty when no sources provided', () => {
        const targets = resolveHealTargets(tmpDir, {}, []);
        assert.equal(targets.length, 0);
    });

    it('should parse Playwright JSON report and return unstable specs', () => {
        const report = {
            suites: [{
                suites: [{
                    specs: [{
                        file: path.join(tmpDir, 'specs/functional/channels/search.spec.ts'),
                        tests: [{
                            outcome: 'unexpected',
                            results: [{status: 'failed'}],
                        }],
                    }],
                }],
            }],
        };
        const reportPath = path.join(tmpDir, 'report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report));

        const targets = resolveHealTargets(tmpDir, {playwrightReportPath: reportPath}, []);
        assert.equal(targets.length, 1);
        assert.equal(targets[0].status, 'failed');
    });

    it('should include generated specs as heal targets', () => {
        const specPath = path.join(tmpDir, 'specs/functional/ai-assisted/test.spec.ts');
        const targets = resolveHealTargets(
            tmpDir,
            {
                generatedSpecs: [{
                    flowId: 'test_flow',
                    specPath,
                    mode: 'create_spec',
                    written: true,
                    hallucinationWarnings: [],
                }],
            },
            [],
        );
        assert.equal(targets.length, 1);
        assert.equal(targets[0].specPath.replace(/\\/g, '/'), specPath.replace(/\\/g, '/'));
    });

    it('should not include unwritten generated specs', () => {
        const targets = resolveHealTargets(
            tmpDir,
            {
                generatedSpecs: [{
                    flowId: 'test_flow',
                    specPath: '/specs/test.spec.ts',
                    mode: 'create_spec',
                    written: false,
                    hallucinationWarnings: [],
                }],
            },
            [],
        );
        assert.equal(targets.length, 0);
    });

    it('should deduplicate targets from multiple sources', () => {
        const specPath = path.join(tmpDir, 'specs/test.spec.ts');
        const report = {
            suites: [{
                specs: [{
                    file: specPath,
                    tests: [{outcome: 'unexpected', results: [{status: 'failed'}]}],
                }],
            }],
        };
        const reportPath = path.join(tmpDir, 'report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report));

        const targets = resolveHealTargets(
            tmpDir,
            {
                playwrightReportPath: reportPath,
                generatedSpecs: [{
                    flowId: 'f',
                    specPath,
                    mode: 'create_spec',
                    written: true,
                    hallucinationWarnings: [],
                }],
            },
            [],
        );
        // Same spec from two sources — should appear only once
        assert.equal(targets.length, 1);
    });

    it('should match decisions to targets by targetSpec', () => {
        const decision = {...MOCK_DECISION, targetSpec: 'specs/functional/channels/search/find_channels.spec.ts'};
        const targets = resolveHealTargets(
            tmpDir,
            {
                generatedSpecs: [{
                    flowId: 'search_find_channels',
                    specPath: path.join(tmpDir, 'specs/functional/channels/search/find_channels.spec.ts'),
                    mode: 'add_scenarios',
                    written: true,
                    hallucinationWarnings: [],
                }],
            },
            [decision],
        );
        assert.equal(targets.length, 1);
        assert.ok(targets[0].decision);
        assert.equal(targets[0].decision.flowId, 'search_find_channels');
    });
});

describe('renderHealMarkdown', () => {
    it('should render heal summary table', () => {
        const result = {
            targets: [{specPath: 'specs/test.spec.ts', status: 'failed'}],
            summary: {
                runner: 'package-native',
                results: [
                    {flowId: 'flow_1', flowName: 'Flow 1', generatedDir: '', generateStatus: 'success', healStatus: 'success'},
                    {flowId: 'flow_2', flowName: 'Flow 2', generatedDir: '', generateStatus: 'failed', healStatus: 'failed', error: 'timeout'},
                ],
                warnings: [],
            },
            warnings: ['test warning'],
        };

        const md = renderHealMarkdown(result);
        assert.ok(md.includes('Heal Results'));
        assert.ok(md.includes('Targets'));
        assert.ok(md.includes('Healed'));
        assert.ok(md.includes('flow_1'));
        assert.ok(md.includes('flow_2'));
        assert.ok(md.includes('timeout'));
        assert.ok(md.includes('test warning'));
    });
});

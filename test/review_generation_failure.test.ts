import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildScenariosFromReview, runReviewCommand} from '../dist/cli/commands/review.js';
import {resolveConfig} from '../dist/agent/config.js';
import {LLMProviderFactory} from '../dist/provider_factory.js';

const runner = require('../dist/agentic/runner.js');

function fixture(t, enforcePlan = false) {
    const root = mkdtempSync(join(tmpdir(), 'review-generation-failure-'));
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    t.after(() => {
        process.exitCode = previousExitCode;
        rmSync(root, {recursive: true, force: true});
    });
    const report = {
        impactedFlows: [{id: 'profile', name: 'Profile', status: 'uncovered', priority: 'P1', changedFiles: ['src/profile.ts'], existingTests: [], gaps: ['Missing scenario: saved name persists'], userFlows: ['Save a profile']}],
        coverageGaps: [{id: 'profile', name: 'Profile', priority: 'P1', reason: 'Missing persistence test', files: ['src/profile.ts']}],
        riskAssessment: {score: 0.2, level: 'low', topFactors: [], recommendation: 'Review profile persistence'},
        decision: {action: 'review-recommended', summary: 'Review profile changes', details: []},
        metrics: {changedFiles: 1, impactedFlows: 1, coveredFlows: 0, uncoveredFlows: 1, partialFlows: 0, coverageGaps: 1, defectRiskScore: 0.2, confidence: 50},
    };
    t.mock.method(require('../dist/agent/git.js'), 'getChangedFiles', () => ({files: ['src/profile.ts'], filteredTestFiles: [], repositoryRoot: root}));
    t.mock.method(require('../dist/engine/impact_engine.js'), 'analyzeImpact', () => ({}));
    t.mock.method(require('../dist/engine/diff_loader.js'), 'loadDiffs', () => new Map());
    t.mock.method(require('../dist/engine/plan_builder.js'), 'buildPlanFromImpact', () => ({enforcement: {shouldFail: enforcePlan}}));
    t.mock.method(require('../dist/prediction/index.js'), 'predict', async () => ({score: 0.2}));
    const synthesize = t.mock.method(require('../dist/engine/review_synthesizer.js'), 'synthesizeReview', () => report);
    const stdout: string[] = [];
    const stderr: string[] = [];
    t.mock.method(console, 'log', (text) => stdout.push(String(text)));
    t.mock.method(console, 'error', (text) => stderr.push(String(text)));
    t.mock.method(console, 'warn', (text) => stderr.push(String(text)));
    return {root, report, stdout, stderr, synthesize, config: resolveConfig(root).config};
}

describe('optional review generation failures', () => {
    it('retains known gaps in associated flows without proposing tests for association or PR bookkeeping alone', (t) => {
        const f = fixture(t);
        const flow = {...f.report.impactedFlows[0], status: 'associated', existingTests: ['profile.cy.ts']};
        const report = {...f.report, impactedFlows: [
            {...flow, id: 'missing', gaps: ['Missing scenario: saved name remains visible after reload']},
            {...flow, id: 'partial', gaps: ['Profile has associated Cypress specs and no associated Playwright specs — consider adding Playwright tests']},
            {...flow, id: 'association-only', gaps: []},
            {...flow, id: 'bookkeeping-only', gaps: ['No new scenario added in this PR']},
        ]};

        const scenarios = buildScenariosFromReview(report);

        assert.deepEqual(scenarios.map((scenario) => scenario.id), ['missing', 'partial']);
        assert.deepEqual(scenarios[0].scenarios, ['saved name remains visible after reload']);
        assert.deepEqual(scenarios[1].scenarios, ['Verify Save a profile']);
    });

    it('preserves the static JSON review and requested artifacts when the provider is unavailable', async (t) => {
        const f = fixture(t);
        t.mock.method(LLMProviderFactory, 'createFromEnv', async () => {throw new Error('No provider configured');});
        const generate = t.mock.method(runner, 'runAgenticGeneration', async () => {throw new Error('must not generate');});
        const scenariosOutput = join(f.root, 'scenarios.json');
        const ciCommentPath = join(f.root, 'comment.md');

        await runReviewCommand({analyzeGenerate: true, jsonOutput: true, scenariosOutput, ciCommentPath}, f.config);

        assert.equal(f.stdout.length, 1, 'stdout must contain one complete JSON document');
        const {generation, ...review} = JSON.parse(f.stdout[0]);
        assert.deepEqual(review, f.report);
        assert.equal(generation.status, 'failed');
        assert.match(generation.error, /No provider configured/);
        assert.equal(process.exitCode, 3);
        assert.equal(f.synthesize.mock.callCount(), 1, 'static analysis must finish despite unavailable generation');
        assert.equal(generate.mock.callCount(), 0);
        assert.equal(JSON.parse(readFileSync(scenariosOutput, 'utf8'))[0].id, 'profile');
        assert.match(readFileSync(ciCommentPath, 'utf8'), /Profile/);
    });

    it('preserves the review when generation throws after provider resolution', async (t) => {
        const f = fixture(t);
        t.mock.method(LLMProviderFactory, 'createFromEnv', async () => ({name: 'fixture'}));
        t.mock.method(runner, 'runAgenticGeneration', async () => {throw new Error('Cannot create output directory');});

        await runReviewCommand({analyzeGenerate: true, jsonOutput: true}, f.config);

        assert.equal(f.stdout.length, 1);
        const {generation, ...review} = JSON.parse(f.stdout[0]);
        assert.deepEqual(review, f.report);
        assert.deepEqual(generation, {status: 'failed', error: 'Cannot create output directory'});
        assert.equal(process.exitCode, 1);
    });

    it('retains the classified provider exit code when static plan enforcement would also fail', async (t) => {
        const f = fixture(t, true);
        t.mock.method(LLMProviderFactory, 'createFromEnv', async () => {throw new Error('No provider configured');});

        await runReviewCommand({analyzeGenerate: true, jsonOutput: true}, f.config);

        assert.equal(f.stdout.length, 1);
        const {generation, ...review} = JSON.parse(f.stdout[0]);
        assert.deepEqual(review, f.report);
        assert.equal(generation.status, 'failed');
        assert.match(generation.error, /No provider configured/);
        assert.equal(process.exitCode, 3, 'provider failure must not be replaced by plan enforcement exit 2');
    });

    it('includes a failed generation summary without replacing static review fields', async (t) => {
        const f = fixture(t);
        t.mock.method(LLMProviderFactory, 'createFromEnv', async () => ({name: 'fixture'}));
        t.mock.method(runner, 'runAgenticGeneration', async () => ({
            results: [{specPath: 'profile.ts.unverified', scenarioSource: 'profile', status: 'unverified', attempts: 1, warnings: ['Missing verification evidence']}],
            totalGenerated: 1, totalPassed: 0, totalFailed: 1, totalAttempts: 1, durationMs: 1, warnings: [],
        }));

        await runReviewCommand({analyzeGenerate: true, jsonOutput: true}, f.config);

        const {generation, ...review} = JSON.parse(f.stdout[0]);
        assert.deepEqual(review, f.report);
        assert.equal(generation.status, 'failed');
        assert.equal(generation.totalFailed, 1);
        assert.equal(JSON.parse(readFileSync(generation.summaryPath, 'utf8')).results[0].status, 'unverified');
        assert.equal(process.exitCode, 1);
    });
});

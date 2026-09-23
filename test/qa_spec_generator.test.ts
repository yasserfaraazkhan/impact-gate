// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, resolve} from 'node:path';

import {generateSpecsForFindings} from '../dist/qa-agent/phase3/spec_generator.js';
import {runGenerateCommand} from '../dist/cli/commands/generate.js';
import {resolveConfig} from '../dist/agent/config.js';
import {LLMProviderFactory} from '../dist/provider_factory.js';
import {logger} from '../dist/logger.js';
import type {Finding, QAConfig} from '../dist/qa-agent/types.js';

const runner = require('../dist/agentic/runner.js');
const verification = require('../dist/pipeline/mutation_verification.js');

function finding(overrides: Partial<Finding> = {}): Finding {
    return {
        id: 'save-profile',
        type: 'functional',
        severity: 'high',
        summary: 'Profile changes are lost',
        flow: 'settings.profile',
        evidence: {
            url: 'http://localhost:3000/settings',
            reproSteps: ['Change the display name', 'Save the profile', 'Reload the page'],
            expectedBehavior: 'The saved display name remains visible after reload',
            actualBehavior: 'The previous display name is shown after reload',
        },
        timestamp: 1,
        ...overrides,
    };
}

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'qa-handoff-'));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const sourceRoot = join(root, 'source');
    const testsRoot = join(root, 'test workspace');
    const outputDir = join(root, 'reports ; $ qa');
    mkdirSync(sourceRoot);
    mkdirSync(testsRoot);
    const configPath = join(root, 'impact-gate.config.json');
    writeFileSync(configPath, JSON.stringify({
        path: './source',
        testsRoot: './test workspace',
        llm: {provider: 'ollama:fixture'},
        git: {since: 'release-base'},
    }));
    const config: QAConfig = {
        mode: 'hunt',
        baseUrl: 'http://localhost:3000',
        testsRoot: relative(process.cwd(), testsRoot),
        outputDir: relative(process.cwd(), outputDir),
        timeLimitMinutes: 15,
        budgetUSD: 2,
    };
    t.mock.method(logger, 'info', () => {});
    const warnings = t.mock.method(logger, 'warn', () => {});
    return {root, sourceRoot, testsRoot, outputDir, configPath, config, warnings};
}

function summary(results = []) {
    return {
        results,
        totalGenerated: results.length,
        totalPassed: results.filter((result) => result.status === 'passed').length,
        totalFailed: results.filter((result) => result.status !== 'passed').length,
        totalAttempts: results.length,
        durationMs: 1,
        warnings: results.flatMap((result) => result.warnings),
    };
}

describe('browser findings to generated specs', () => {
    it('preserves complete reproductions and exports scenarios accepted by the generate CLI', async (t) => {
        const f = fixture(t);
        const provider = t.mock.method(LLMProviderFactory, 'createFromPreference', async () => ({name: 'fixture'}));
        const generate = t.mock.method(runner, 'runAgenticGeneration', async () => summary());
        const findings = [
            finding(),
            finding({id: 'legacy-bug', type: 'bug', severity: 'critical'}),
            finding({id: 'missing-coverage', type: 'gap', severity: 'medium'}),
            finding({id: 'visual-only', type: 'visual'}),
        ];

        await generateSpecsForFindings(findings, {...f.config, project: 'desktop', since: 'feature-base'});

        const options = generate.mock.calls[0].arguments[0];
        assert.equal(provider.mock.calls[0].arguments[0], 'ollama:fixture');
        assert.deepEqual(options.config, {
            maxAttempts: 3,
            project: 'desktop',
            baseUrl: f.config.baseUrl,
            testTimeoutMs: 120000,
            testsRoot: resolve(f.testsRoot),
            repositoryRoot: resolve(f.sourceRoot),
            baseRef: 'feature-base',
        });
        assert.equal(options.generationProfile.importStatement, '@playwright/test');
        assert.equal(options.scenarios.length, 3);
        assert.deepEqual(options.scenarios.map((scenario) => scenario.priority), ['P0', 'P0', 'P1']);
        const first = options.scenarios.find((scenario) => scenario.id === 'qa-save-profile');
        assert.equal(first.id, 'qa-save-profile');
        assert.equal(first.routeFamily, 'settings.profile');
        assert.equal(first.scenarios.length, 1, 'individual reproduction steps must not become separate tests');
        for (const step of findings[0].evidence.reproSteps) assert.ok(first.scenarios[0].includes(step));
        assert.ok(first.scenarios[0].includes(findings[0].evidence.expectedBehavior));
        assert.ok(first.scenarios[0].includes(findings[0].evidence.url));
        assert.equal(first.evidence, findings[0].evidence.actualBehavior);

        const scenariosPath = join(f.outputDir, 'qa-findings-scenarios.json');
        const savedScenarios = JSON.parse(readFileSync(scenariosPath, 'utf8'));
        assert.deepEqual(savedScenarios.map((scenario) => scenario.id), ['qa-save-profile', 'qa-legacy-bug', 'qa-missing-coverage']);
        assert.deepEqual(savedScenarios[0], first);
        t.mock.method(console, 'log', () => {});
        t.mock.method(process, 'exit', (code) => {throw new Error(`Unexpected CLI validation exit: ${code}`);});
        const {config} = resolveConfig(f.root, f.configPath);
        await runGenerateCommand({generateScenarios: scenariosPath}, config);
        assert.deepEqual(generate.mock.calls[1].arguments[0].scenarios, savedScenarios);
    });

    it('generates at most five findings in severity order and retains every scenario for manual retry', async (t) => {
        const f = fixture(t);
        t.mock.method(LLMProviderFactory, 'createFromPreference', async () => ({name: 'fixture'}));
        const generate = t.mock.method(runner, 'runAgenticGeneration', async () => summary());
        const findings = [
            finding({id: 'low-first', severity: 'low'}),
            finding({id: 'high-first', severity: 'high'}),
            finding({id: 'critical-first', severity: 'critical'}),
            finding({id: 'medium-first', severity: 'medium'}),
            finding({id: 'high-second', severity: 'high'}),
            finding({id: 'critical-second', severity: 'critical'}),
            finding({id: 'high-third', severity: 'high'}),
            finding({id: 'medium-second', severity: 'medium'}),
            finding({id: 'info-last', severity: 'info'}),
        ];

        await generateSpecsForFindings(findings, f.config);

        assert.equal(generate.mock.callCount(), 1);
        assert.deepEqual(generate.mock.calls[0].arguments[0].scenarios.map((scenario) => scenario.id), [
            'qa-critical-first', 'qa-critical-second', 'qa-high-first', 'qa-high-second', 'qa-high-third',
        ]);
        const savedScenarios = JSON.parse(readFileSync(join(f.outputDir, 'qa-findings-scenarios.json'), 'utf8'));
        assert.deepEqual(savedScenarios.map((scenario) => scenario.id), findings.map((item) => `qa-${item.id}`));
        const report = JSON.parse(readFileSync(join(f.outputDir, 'qa-generation-summary.json'), 'utf8'));
        assert.equal(report.deferredCount, 4);
        assert.deepEqual(report.deferredScenarioIds, ['qa-medium-first', 'qa-medium-second', 'qa-low-first', 'qa-info-last']);
        assert.equal(f.warnings.mock.calls[0].arguments[1].deferredCount, 4);
        assert.match(f.warnings.mock.calls[0].arguments[0], /limited to five findings/);
    });

    it('uses configured profiles and project names when QA does not override them', async (t) => {
        const f = fixture(t);
        writeFileSync(f.configPath, JSON.stringify({
            path: './source', profile: 'mattermost', pipeline: {project: 'chromium'},
        }));
        t.mock.method(LLMProviderFactory, 'createFromPreference', async () => ({name: 'fixture'}));
        const generate = t.mock.method(runner, 'runAgenticGeneration', async () => summary());
        await generateSpecsForFindings([finding()], f.config);
        const options = generate.mock.calls[0].arguments[0];
        assert.equal(options.generationProfile.importStatement, '@mattermost/playwright-lib');
        assert.equal(options.config.project, 'chromium');
        assert.equal(options.config.testsRoot, resolve(f.testsRoot));
    });

    it('does not require a named browser project and supplies valid fallback flow context', async (t) => {
        const f = fixture(t);
        mkdirSync(join(f.sourceRoot, '.understand-anything'));
        writeFileSync(join(f.sourceRoot, '.understand-anything/knowledge-graph.json'), JSON.stringify({
            version: '1.0', project: {name: 'Profile Service', frameworks: ['express'], languages: ['typescript']},
            nodes: [], edges: [],
        }));
        t.mock.method(LLMProviderFactory, 'createFromPreference', async () => ({name: 'fixture'}));
        const generate = t.mock.method(runner, 'runAgenticGeneration', async () => summary());
        await generateSpecsForFindings([finding({flow: '', evidence: {url: '', reproSteps: []}})], f.config);
        const options = generate.mock.calls[0].arguments[0];
        assert.equal(options.config.project, '');
        assert.equal(options.generationProfile.importStatement, '@playwright/test');
        assert.equal(options.generationProfile.projectName, 'Profile Service');
        assert.equal(options.scenarios[0].routeFamily, 'qa');
        assert.ok(options.scenarios[0].scenarios[0].includes(f.config.baseUrl));
        assert.ok(options.scenarios[0].scenarios[0].includes('should not occur'));
    });

    it('uses an external tests root as the project when it has no configuration', async (t) => {
        const f = fixture(t);
        rmSync(f.configPath);
        t.mock.method(LLMProviderFactory, 'createFromPreference', async () => ({name: 'fixture'}));
        const generate = t.mock.method(runner, 'runAgenticGeneration', async () => summary());
        await generateSpecsForFindings([finding()], {...f.config, since: 'target-base'});
        const options = generate.mock.calls[0].arguments[0];
        assert.equal(options.config.testsRoot, resolve(f.testsRoot));
        assert.equal(options.config.repositoryRoot, resolve(f.testsRoot), 'must not verify against the calling process repository');
        assert.equal(options.config.baseRef, 'target-base');
    });

    it('does no provider or filesystem work for nonfunctional findings', async (t) => {
        const f = fixture(t);
        const provider = t.mock.method(LLMProviderFactory, 'createFromPreference', async () => {throw new Error('must not run');});
        assert.deepEqual(await generateSpecsForFindings([
            finding({type: 'visual'}), finding({type: 'ux-issue'}), finding({type: 'verified-ok'}),
        ], f.config), []);
        assert.equal(provider.mock.callCount(), 0);
        assert.equal(existsSync(f.outputDir), false);
    });

    it('returns only verified specs and preserves all failed or quarantined outcomes for review', async (t) => {
        const f = fixture(t);
        t.mock.method(LLMProviderFactory, 'createFromPreference', async () => ({name: 'fixture'}));
        const results = ['passed', 'unverified', 'failed', 'skipped'].map((status, index) => ({
            scenarioSource: `qa-${index}`,
            specPath: join(f.testsRoot, status === 'passed' ? 'verified.spec.ts' : `${status}.ts.unverified`),
            status,
            attempts: 1,
            warnings: status === 'passed' ? [] : ['No mutation evidence'],
        }));
        t.mock.method(runner, 'runAgenticGeneration', async () => summary(results));

        assert.deepEqual(await generateSpecsForFindings([finding()], f.config), [results[0].specPath]);
        const report = JSON.parse(readFileSync(join(f.outputDir, 'qa-generation-summary.json'), 'utf8'));
        assert.deepEqual(report.results, results);
        assert.equal(report.scenariosPath, join(f.outputDir, 'qa-findings-scenarios.json'));
        assert.deepEqual(f.warnings.mock.calls.map((call) => call.arguments[1].status), ['unverified', 'failed', 'skipped']);
    });

    it('records provider failures without losing replayable findings or claiming coverage', async (t) => {
        const f = fixture(t);
        t.mock.method(LLMProviderFactory, 'createFromPreference', async () => {throw new Error('Provider unavailable');});
        const generate = t.mock.method(runner, 'runAgenticGeneration', async () => {throw new Error('must not run');});
        const findings = Array.from({length: 6}, (_, index) => finding({id: `provider-failure-${index}`}));
        assert.deepEqual(await generateSpecsForFindings(findings, f.config), []);
        assert.equal(generate.mock.callCount(), 0);
        const report = JSON.parse(readFileSync(join(f.outputDir, 'qa-generation-summary.json'), 'utf8'));
        assert.equal(report.error, 'Provider unavailable');
        assert.deepEqual(report.results, []);
        assert.equal(JSON.parse(readFileSync(report.scenariosPath, 'utf8')).length, 6);
        assert.equal(report.deferredCount, 1);
        assert.deepEqual(report.deferredScenarioIds, ['qa-provider-failure-5']);
        assert.match(f.warnings.mock.calls.at(-1).arguments[0], /generation failed/);
    });

    it('keeps a real generated but unverified proposal quarantined outside discovered specs', async (t) => {
        const f = fixture(t);
        const code = "import {test, expect} from '@playwright/test';\ntest('saved profile persists', async ({page}) => { await page.goto('/settings'); await expect(page.getByRole('textbox')).toHaveValue('Updated'); });";
        t.mock.method(LLMProviderFactory, 'createFromPreference', async () => ({
            name: 'fixture', generateText: async () => ({text: code}),
        }));
        t.mock.method(verification, 'verifyGeneratedSpec', () => ({
            verified: false, reason: 'No changed source candidate is available for verification',
        }));

        assert.deepEqual(await generateSpecsForFindings([finding()], f.config), []);
        const report = JSON.parse(readFileSync(join(f.outputDir, 'qa-generation-summary.json'), 'utf8'));
        assert.equal(report.results[0].status, 'unverified');
        assert.ok(report.results[0].specPath.endsWith('.ts.unverified'));
        assert.equal(readFileSync(report.results[0].specPath, 'utf8'), code);
        assert.equal(existsSync(join(f.testsRoot, 'specs/functional/ai-assisted/qa-save-profile.spec.ts')), false);
    });
});

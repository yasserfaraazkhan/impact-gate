// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {describe, it, mock} from 'node:test';
import assert from 'node:assert/strict';
import {runAgenticGeneration} from '../dist/agentic/runner.js';
import {resolveGenerationProfile} from '../dist/prompts/generation_profile.js';

// Mock provider
function createMockProvider(responses) {
    let callIndex = 0;
    return {
        name: 'mock',
        generateText: mock.fn(async () => {
            const resp = responses[callIndex] || responses[responses.length - 1];
            callIndex++;
            return {text: resp, usage: {inputTokens: 100, outputTokens: 50}};
        }),
    };
}

describe('runAgenticGeneration', () => {
    it('returns summary with results for dry run', async () => {
        const provider = createMockProvider([
            "import {test} from '@playwright/test';\ntest('my test', async ({page}) => { await page.goto('/'); });",
        ]);

        const summary = await runAgenticGeneration({
            scenarios: [{
                id: 'test-flow',
                name: 'Test Flow',
                scenarios: ['Verify user can post a message'],
                routeFamily: 'channels',
                priority: 'P0',
            }],
            config: {
                maxAttempts: 3,
                project: 'chrome',
                testTimeoutMs: 120000,
                testsRoot: '/tmp/e2e-agentic-test-' + Date.now(),
                dryRun: true,
            },
            provider,
            apiSurfaceHint: 'ChannelsPage: goto(), toBeVisible()',
        });

        assert.ok(summary.totalGenerated >= 1);
        assert.ok(summary.results.length >= 1);
        // Dry run skips execution
        assert.equal(summary.results[0].status, 'skipped');
        assert.match(provider.generateText.mock.calls[0].arguments[0], /async \(\{page\}\)/);
        assert.doesNotMatch(provider.generateText.mock.calls[0].arguments[0], /Mattermost|pw\.initSetup/);
        assert.doesNotMatch(readFileSync(summary.results[0].specPath, 'utf8'), /@mattermost\/playwright-lib/);
    });

    it('handles LLM returning invalid code', async () => {
        const provider = createMockProvider(['This is not valid test code at all.']);

        const summary = await runAgenticGeneration({
            scenarios: [{
                id: 'bad-flow',
                name: 'Bad Flow',
                scenarios: ['Something'],
                routeFamily: 'channels',
                priority: 'P1',
            }],
            config: {
                maxAttempts: 3,
                project: 'chrome',
                testTimeoutMs: 120000,
                testsRoot: '/tmp/e2e-agentic-test-' + Date.now(),
                dryRun: true,
            },
            provider,
            apiSurfaceHint: '',
        });

        assert.equal(summary.results[0].status, 'failed');
        assert.ok(summary.warnings.length > 0);
    });

    it('preserves Mattermost imports and conventions when the profile is explicit', async () => {
        const testsRoot = mkdtempSync(join(tmpdir(), 'impact-profile-'));
        try {
            const provider = createMockProvider(["import {test, expect} from '@mattermost/playwright-lib';\ntest('profile', async ({pw}) => { await pw.initSetup(); });"]);
            const summary = await runAgenticGeneration({
                scenarios: [{id: 'profile', name: 'Profile', scenarios: ['Check profile'], routeFamily: 'profile', priority: 'P1'}],
                config: {testsRoot, maxAttempts: 1, testTimeoutMs: 1000, dryRun: true},
                generationProfile: resolveGenerationProfile({profile: 'mattermost'}),
                provider,
            });
            const code = readFileSync(summary.results[0].specPath, 'utf8');
            assert.equal(summary.results[0].status, 'skipped');
            assert.match(provider.generateText.mock.calls[0].arguments[0], /pw\.initSetup/);
            assert.doesNotMatch(code, /@playwright\/test/);
            assert.equal(code.match(/import /g).length, 1);
        } finally {rmSync(testsRoot, {recursive: true, force: true});}
    });

    it('rejects unsupported framework profiles before asking the provider for code', async () => {
        const testsRoot = mkdtempSync(join(tmpdir(), 'impact-unsupported-profile-'));
        try {
            for (const testFramework of ['Cypress', 'Selenium', 'vitest + supertest', 'pytest']) {
                const provider = createMockProvider(["test('unused', () => {});"]);
                const summary = await runAgenticGeneration({
                    scenarios: [{id: 'profile', name: 'Profile', scenarios: ['Check profile'], routeFamily: 'profile', priority: 'P1'}],
                    config: {testsRoot, maxAttempts: 1, testTimeoutMs: 1000, dryRun: true},
                    generationProfile: {...resolveGenerationProfile(), testFramework},
                    provider,
                });
                assert.equal(summary.results[0].status, 'failed');
                assert.equal(provider.generateText.mock.callCount(), 0);
                assert.match(summary.warnings.join('\n'), /supports Playwright profiles only/);
                assert.equal(existsSync(summary.results[0].specPath), false);
            }
        } finally {rmSync(testsRoot, {recursive: true, force: true});}
    });
});

import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

// Deterministic provider acceptance fixture; Playwright execution is real, without a browser or a server.
function generationFixture() {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'impact-mutation-fixture-')));
    const testsRoot = join(repo, 'tests');
    mkdirSync(testsRoot);
    symlinkSync(realpathSync(resolve('node_modules')), join(repo, 'node_modules'), 'dir');
    writeFileSync(join(testsRoot, 'playwright.config.ts'), `export default {testDir: '.', projects: [{name: 'chrome'}], retries: 0};`);
    writeFileSync(join(repo, 'eligibility.ts'), 'export function eligible(age: number) {\n    return age > 18;\n}\n');
    const git = (...args) => execFileSync('git', args, {cwd: repo, encoding: 'utf8'}).trim();
    git('init', '-q');
    git('add', 'eligibility.ts', 'tests/playwright.config.ts');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base');
    const baseRef = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'eligibility.ts'), 'export function eligible(age: number) {\n    return age >= 18;\n}\n');
    return {repo, testsRoot, baseRef};
}
const goodSpec = `import {test, expect} from '@playwright/test';
import {eligible} from '../../../../eligibility';
test('accepts the changed boundary', () => {
    expect(eligible(18)).toBe(true);
    expect(eligible(17)).toBe(false);
});`;
const emptySpec = `import {test} from '@playwright/test';\ntest('assertion-free control', async () => {});`;
async function generateFixture(fixture, code, extra = {}) {
    return runAgenticGeneration({
        scenarios: [{id: 'boundary', name: 'Boundary', scenarios: ['Check age boundary'], routeFamily: 'fixture', priority: 'P1', changedFiles: ['eligibility.ts']}],
        config: {testsRoot: fixture.testsRoot, repositoryRoot: fixture.repo, baseRef: fixture.baseRef, maxAttempts: 1, project: 'chrome', testTimeoutMs: 30000, ...extra},
        provider: createMockProvider([code]),
    });
}

describe('real generated-test mutation acceptance', () => {
    it('requires clean pass, assertion kill, and restored pass with real Playwright', async () => {
        const fixture = generationFixture();
        const summary = await generateFixture(fixture, goodSpec);
        writeFileSync(join(fixture.repo, 'good-summary.json'), JSON.stringify(summary, null, 2));
        console.log(`REAL_PLAYWRIGHT_GOOD_FIXTURE=${fixture.repo}`);
        assert.equal(summary.results[0].status, 'passed');
        const evidence = summary.results[0].verification;
        assert.equal(evidence?.verified, true);
        assert.ok(evidence.baseline.passed > 0);
        assert.ok(evidence.mutant.assertionFailures > 0);
        assert.ok(evidence.restored.passed > 0);
        assert.equal(readFileSync(join(fixture.repo, 'eligibility.ts'), 'utf8'), 'export function eligible(age: number) {\n    return age >= 18;\n}\n');
    });
    it('does not trust a clean assertion-free generated test and quarantines it', async () => {
        const fixture = generationFixture();
        const summary = await generateFixture(fixture, emptySpec);
        writeFileSync(join(fixture.repo, 'empty-summary.json'), JSON.stringify(summary, null, 2));
        console.log(`REAL_PLAYWRIGHT_EMPTY_FIXTURE=${fixture.repo}`);
        assert.equal(summary.results[0].status, 'unverified');
        assert.ok(summary.results[0].verification.baseline.passed > 0);
        assert.ok(summary.results[0].verification.mutant.passed > 0);
        assert.equal(existsSync(join(fixture.testsRoot, 'specs/functional/ai-assisted/boundary.spec.ts')), false);
        assert.ok(summary.results[0].specPath.endsWith('.unverified'));
    });
    it('preserves a preexisting spec when source context is missing', async () => {
        const fixture = generationFixture();
        const path = join(fixture.testsRoot, 'specs/functional/ai-assisted/boundary.spec.ts');
        mkdirSync(join(fixture.testsRoot, 'specs/functional/ai-assisted'), {recursive: true});
        writeFileSync(path, '// preexisting bytes\n');
        const summary = await generateFixture(fixture, emptySpec, {baseRef: undefined});
        assert.equal(summary.results[0].status, 'unverified');
        assert.equal(readFileSync(path, 'utf8'), '// preexisting bytes\n');
    });
    it('does not replace existing coverage even when replacement would pass verification', async () => {
        const fixture = generationFixture();
        const path = join(fixture.testsRoot, 'specs/functional/ai-assisted/boundary.spec.ts');
        mkdirSync(join(fixture.testsRoot, 'specs/functional/ai-assisted'), {recursive: true});
        const original = `${goodSpec}\n// Existing coverage must survive generation.\n`;
        writeFileSync(path, original);
        const provider = createMockProvider([goodSpec]);
        const summary = await runAgenticGeneration({
            scenarios: [{id: 'boundary', name: 'Boundary', scenarios: ['Check boundary'], routeFamily: 'fixture', priority: 'P1', targetSpec: 'specs/functional/ai-assisted/boundary.spec.ts'}],
            config: {testsRoot: fixture.testsRoot, repositoryRoot: fixture.repo, baseRef: fixture.baseRef, maxAttempts: 1, project: 'chrome', testTimeoutMs: 30000},
            provider,
        });
        assert.equal(summary.results[0].status, 'unverified');
        assert.equal(provider.generateText.mock.callCount(), 0);
        assert.equal(readFileSync(path, 'utf8'), original);
        assert.match(summary.warnings.join('\n'), /Existing spec preserved/);
    });
    it('repairs a generic Playwright test without introducing Mattermost fixtures', async () => {
        const fixture = generationFixture();
        const provider = createMockProvider([goodSpec.replace('expect(eligible(18)).toBe(true)', 'expect(eligible(18)).toBe(false)'), goodSpec]);
        const summary = await runAgenticGeneration({
            scenarios: [{id: 'boundary', name: 'Boundary', scenarios: ['Check boundary'], routeFamily: 'fixture', priority: 'P1'}],
            config: {testsRoot: fixture.testsRoot, repositoryRoot: fixture.repo, baseRef: fixture.baseRef, maxAttempts: 2, project: 'chrome', testTimeoutMs: 30000},
            provider,
        });
        assert.equal(summary.results[0].status, 'passed', summary.warnings.join('\n'));
        assert.equal(summary.results[0].attempts, 2);
        assert.equal(provider.generateText.mock.callCount(), 2);
        assert.doesNotMatch(provider.generateText.mock.calls[1].arguments[0], /Mattermost|pw\.initSetup/);
        assert.doesNotMatch(readFileSync(summary.results[0].specPath, 'utf8'), /@mattermost\/playwright-lib/);
    });
});

import {runGenerationStage} from '../dist/pipeline/stage3_generation.js';
import {LLMProviderFactory} from '../dist/provider_factory.js';
import {ExecutorAgent} from '../dist/agents/executor.js';

describe('shared verification and preservation boundaries', () => {
    it('stage 3 never replaces an existing create_spec destination', async () => {
        const fixture = generationFixture();
        const path = join(fixture.testsRoot, 'existing.spec.ts');
        const original = '// preserve this existing suite\n';
        writeFileSync(path, original);
        const provider = createMockProvider([goodSpec]);
        const factory = mock.method(LLMProviderFactory, 'createFromEnv', async () => provider);
        try {
            const result = await runGenerationStage([{flowId: 'boundary', flowName: 'Boundary', userActions: [], evidence: 'fixture', routeFamily: 'fixture', existingSpecs: [], action: 'create_spec', newSpecPath: 'existing.spec.ts'}], {pageObjects: []}, fixture.testsRoot, {repositoryRoot: fixture.repo, baseRef: fixture.baseRef});
            assert.equal(provider.generateText.mock.callCount(), 0);
            assert.equal(result.generatedCount, 0);
            assert.equal(result.generated[0].written, false);
            assert.equal(result.generated[0].verified, false);
            assert.match(result.generated[0].verificationError, /Existing spec preserved/);
            assert.equal(readFileSync(path, 'utf8'), original);
        } finally {factory.mock.restore();}
    });

    it('stage 3 preserves the selected framework while parsing generated code', async () => {
        const fixture = generationFixture();
        const code = "import {test, expect} from '@mattermost/playwright-lib';\ntest('profile', () => { expect(true).toBe(true); });";
        const factory = mock.method(LLMProviderFactory, 'createFromEnv', async () => createMockProvider([code]));
        try {
            const result = await runGenerationStage([{flowId: 'profile', flowName: 'Profile', userActions: [], evidence: 'fixture', routeFamily: 'fixture', existingSpecs: [], action: 'create_spec'}], {pageObjects: []}, fixture.testsRoot, {profile: resolveGenerationProfile({profile: 'mattermost'})});
            assert.equal(result.generated.length, 1);
            const generated = readFileSync(result.generated[0].specPath, 'utf8');
            assert.match(generated, /@mattermost\/playwright-lib/);
            assert.doesNotMatch(generated, /@playwright\/test/);
        } finally {factory.mock.restore();}
    });

    it('stage 3 verifies its actual generated artifact, and crew executes it without a provider', async () => {
        const fixture = generationFixture();
        const provider = createMockProvider([goodSpec]);
        const factory = mock.method(LLMProviderFactory, 'createFromEnv', async () => provider);
        try {
            const result = await runGenerationStage([{flowId: 'boundary', flowName: 'Boundary', userActions: ['Check boundary'], evidence: 'fixture', existingSpecs: [], action: 'create_spec', scenariosToAdd: ['boundary'], routeFamily: 'fixture', changedFiles: ['eligibility.ts']}], {pageObjects: []}, fixture.testsRoot, {repositoryRoot: fixture.repo, baseRef: fixture.baseRef});
            writeFileSync(join(fixture.repo, 'stage3-summary.json'), JSON.stringify(result, null, 2));
            console.log(`REAL_PLAYWRIGHT_STAGE3_FIXTURE=${fixture.repo}`);
            assert.equal(result.verifiedCount, 1);
            const artifact = readFileSync(result.generated[0].specPath);
            const execution = await new ExecutorAgent().execute({}, {generatedSpecs: result.generated, testsRoot: fixture.testsRoot, appPath: fixture.repo, gitSince: fixture.baseRef});
            assert.equal(execution.output.totalPassed, 1);
            assert.equal(provider.generateText.mock.callCount(), 1);
            assert.deepEqual(readFileSync(result.generated[0].specPath), artifact);
            writeFileSync(result.generated[0].specPath, emptySpec);
            const stale = await new ExecutorAgent().execute({}, {generatedSpecs: result.generated, testsRoot: fixture.testsRoot, appPath: fixture.repo, gitSince: fixture.baseRef});
            assert.equal(stale.output.results[0].status, 'unverified');
        } finally { factory.mock.restore(); }
    });
    it('stage 3 preserves a complete existing spec beyond 12KB when verification fails', async () => {
        const fixture = generationFixture();
        const original = `${goodSpec}\n// ${'original'.repeat(2500)}\n`;
        const path = join(fixture.testsRoot, 'existing.spec.ts');
        writeFileSync(path, original);
        const factory = mock.method(LLMProviderFactory, 'createFromEnv', async () => createMockProvider([emptySpec]));
        try {
            const result = await runGenerationStage([{flowId: 'boundary', flowName: 'Boundary', userActions: ['Check boundary'], evidence: 'fixture', existingSpecs: [], action: 'add_scenarios', targetSpec: 'existing.spec.ts', scenariosToAdd: ['boundary']}], {pageObjects: []}, fixture.testsRoot, {});
            assert.equal(result.verifiedCount, 0);
            assert.equal(result.generated[0].verified, false);
            assert.equal(readFileSync(path, 'utf8'), original);
            assert.ok(result.generated[0].specPath.endsWith('.unverified'));
        } finally { factory.mock.restore(); }
    });
    it('rejects missing source/base, unsupported source, and remote/prebuilt server context', async () => {
        const fixture = generationFixture();
        for (const config of [{repositoryRoot: undefined}, {baseRef: 'missing-base'}, {baseUrl: 'http://127.0.0.1:9999'}]) {
            const summary = await generateFixture(fixture, goodSpec, config);
            assert.equal(summary.results[0].status, 'unverified');
        }
        writeFileSync(join(fixture.repo, 'eligibility.ts'), 'export const eligible = true;\n');
        assert.equal((await generateFixture(fixture, goodSpec)).results[0].status, 'unverified');
    });
    it('does not overwrite a spec created while awaiting generation', async () => {
        const fixture = generationFixture();
        const path = join(fixture.testsRoot, 'specs/functional/ai-assisted/boundary.spec.ts');
        mkdirSync(join(fixture.testsRoot, 'specs/functional/ai-assisted'), {recursive: true});
        const provider = createMockProvider([goodSpec]);
        provider.generateText = async () => {writeFileSync(path, '// concurrent edit\n'); return {text: goodSpec};};
        const result = await runAgenticGeneration({scenarios: [{id: 'boundary', name: 'Boundary', scenarios: [], routeFamily: 'fixture', priority: 'P1'}], config: {testsRoot: fixture.testsRoot, repositoryRoot: fixture.repo, baseRef: fixture.baseRef, maxAttempts: 1, project: 'chrome', testTimeoutMs: 30000}, provider});
        assert.equal(result.results[0].status, 'unverified');
        assert.equal(readFileSync(path, 'utf8'), '// concurrent edit\n');
    });
    it('continues the batch when another writer wins the exclusive-create race', async (t) => {
        const fixture = generationFixture();
        const outputDir = join(fixture.testsRoot, 'specs/functional/ai-assisted');
        const contested = join(outputDir, 'first.spec.ts');
        const fs = require('node:fs');
        const mkdir = fs.mkdirSync;
        let raced = false;
        t.mock.method(fs, 'mkdirSync', (path, options) => {
            const result = mkdir(path, options);
            if (!raced && resolve(path) === outputDir) {
                raced = true;
                writeFileSync(contested, '// concurrent spec must survive\n');
            }
            return result;
        });
        const provider = createMockProvider([emptySpec]);
        const summary = await runAgenticGeneration({
            scenarios: ['first', 'second'].map((id) => ({id, name: id, scenarios: ['Check output'], routeFamily: 'fixture', priority: 'P1'})),
            config: {testsRoot: fixture.testsRoot, maxAttempts: 1, testTimeoutMs: 1000, dryRun: true},
            provider,
        });
        assert.equal(summary.results.length, 2);
        assert.equal(summary.results[0].status, 'unverified');
        assert.match(summary.results[0].warnings.join('\n'), /Could not create generated spec/);
        assert.equal(readFileSync(contested, 'utf8'), '// concurrent spec must survive\n');
        assert.equal(summary.results[1].status, 'skipped');
        assert.equal(readFileSync(summary.results[1].specPath, 'utf8'), emptySpec);
        assert.equal(provider.generateText.mock.callCount(), 2);
    });
    it('rejects symlink mutation targets without changing their destination', async () => {
        const fixture = generationFixture();
        const outside = join(fixture.repo, 'outside.ts');
        writeFileSync(outside, 'export const eligible = false;\n');
        rmSync(join(fixture.repo, 'eligibility.ts'));
        symlinkSync(outside, join(fixture.repo, 'eligibility.ts'));
        const result = await generateFixture(fixture, goodSpec);
        assert.equal(result.results[0].status, 'unverified');
        assert.equal(readFileSync(outside, 'utf8'), 'export const eligible = false;\n');
    });
});

    it('rejects dangling generated-target symlinks before writing', async () => {
        const fixture = generationFixture();
        const path = join(fixture.testsRoot, 'specs/functional/ai-assisted/boundary.spec.ts');
        mkdirSync(join(fixture.testsRoot, 'specs/functional/ai-assisted'), {recursive: true});
        const destination = join(fixture.repo, 'must-not-exist.ts');
        symlinkSync(destination, path);
        await assert.rejects(generateFixture(fixture, goodSpec), /Symlink path is unsupported/);
        assert.equal(existsSync(destination), false);
    });

import {verifyGeneratedSpec} from '../dist/pipeline/mutation_verification.js';

describe('W1 independent-review regressions', () => {
    function writeProbe(fixture, hook) {
        const path = join(fixture.testsRoot, 'specs/functional/ai-assisted/boundary.spec.ts');
        mkdirSync(join(fixture.testsRoot, 'specs/functional/ai-assisted'), {recursive: true});
        writeFileSync(path, `${goodSpec}\nimport * as fs from 'fs';\nimport {resolve} from 'path';\n${hook}`);
        return path;
    }
    it('never follows a source symlink installed by the baseline test', () => {
        const fixture = generationFixture();
        const source = join(fixture.repo, 'eligibility.ts');
        const original = readFileSync(source);
        const path = writeProbe(fixture, `test.afterEach(() => {const p=resolve(__dirname,'../../../../eligibility.ts'); if(!fs.lstatSync(p).isSymbolicLink()){fs.unlinkSync(p);fs.symlinkSync(${JSON.stringify(source)},p);}});`);
        const result = verifyGeneratedSpec(path, {repositoryRoot: fixture.repo, baseRef: fixture.baseRef, testsRoot: fixture.testsRoot, project: 'chrome', timeoutMs: 30000});
        assert.deepEqual(readFileSync(source), original);
        assert.equal(result.verified, false);
    });
    it('rejects source bytes changed after the restored assertion', () => {
        const fixture = generationFixture();
        const path = writeProbe(fixture, `test.beforeEach(() => {const p=resolve(__dirname,'counter');fs.writeFileSync(p,String(fs.existsSync(p)?Number(fs.readFileSync(p,'utf8'))+1:1));});
        test.afterEach(() => {if(fs.readFileSync(resolve(__dirname,'counter'),'utf8')==='3') fs.writeFileSync(resolve(__dirname,'../../../../eligibility.ts'),'export function eligible(){return false;}');});`);
        const result = verifyGeneratedSpec(path, {repositoryRoot: fixture.repo, baseRef: fixture.baseRef, testsRoot: fixture.testsRoot, project: 'chrome', timeoutMs: 30000});
        assert.equal(result.verified, false);
    });
    it('quarantine failures preserve existing bytes or remove new specs for both generators', async () => {
        for (const stage3 of [false, true]) for (const existing of [false, true]) {
            const fixture = generationFixture();
            const path = writeProbe(fixture, '');
            const original = readFileSync(path);
            if (!existing) rmSync(path);
            symlinkSync(fixture.repo, join(fixture.testsRoot, '.e2e-ai-agents'));
            if (!stage3) {
                const result = await generateFixture(fixture, emptySpec, {baseRef: undefined});
                assert.equal(result.results[0].status, 'unverified');
            } else {
                const factory = mock.method(LLMProviderFactory, 'createFromEnv', async () => createMockProvider([emptySpec]));
                try {
                    const result = await runGenerationStage([{flowId: 'boundary', flowName: 'Boundary', userActions: [], evidence: 'fixture', routeFamily: 'fixture', existingSpecs: [], action: 'create_spec'}], {pageObjects: []}, fixture.testsRoot, {});
                    assert.equal(result.generated[0].verified, false);
                } finally {factory.mock.restore();}
            }
            assert.equal(existsSync(path), existing);
            if (existing) assert.deepEqual(readFileSync(path), original);
        }
    });
    it('an empty add_scenarios addition cannot borrow an existing test mutation kill', async () => {
        const fixture = generationFixture();
        const path = writeProbe(fixture, '');
        const original = readFileSync(path);
        const factory = mock.method(LLMProviderFactory, 'createFromEnv', async () => createMockProvider([emptySpec]));
        try {
            const result = await runGenerationStage([{flowId: 'boundary', flowName: 'Boundary', userActions: [], evidence: 'fixture', routeFamily: 'fixture', existingSpecs: [], action: 'add_scenarios', targetSpec: 'specs/functional/ai-assisted/boundary.spec.ts'}], {pageObjects: []}, fixture.testsRoot, {repositoryRoot: fixture.repo, baseRef: fixture.baseRef});
            assert.equal(result.generated[0].verified, false);
            assert.deepEqual(readFileSync(path), original);
        } finally {factory.mock.restore();}
    });
    it('crew rejects source changes made by its final passing execution', async () => {
        const fixture = generationFixture();
        const path = writeProbe(fixture, `test.afterEach(() => {if(fs.existsSync(resolve(__dirname,'trigger'))) fs.writeFileSync(resolve(__dirname,'../../../../eligibility.ts'),'export function eligible(){return false;}');});`);
        const verification = verifyGeneratedSpec(path, {repositoryRoot: fixture.repo, baseRef: fixture.baseRef, testsRoot: fixture.testsRoot, project: 'chrome', timeoutMs: 30000});
        assert.equal(verification.verified, true);
        writeFileSync(join(fixture.testsRoot, 'specs/functional/ai-assisted/trigger'), 'trigger');
        const generated = {flowId: 'boundary', specPath: path, written: true, verified: true, verification};
        const result = await new ExecutorAgent().execute({}, {generatedSpecs: [generated], testsRoot: fixture.testsRoot, appPath: fixture.repo});
        assert.equal(result.output.results[0].status, 'unverified');
        assert.equal(generated.verified, false);
        assert.equal(generated.verification.verified, false);
    });
});

import {prepareQuarantine, quarantineSpec} from '../dist/pipeline/mutation_verification.js';

it('restores owned existing bytes even if reserved quarantine storage disappears', () => {
    const fixture = generationFixture();
    const path = join(fixture.testsRoot, 'existing.spec.ts');
    const original = Buffer.from('// original bytes\n');
    const generated = Buffer.from(emptySpec);
    writeFileSync(path, generated);
    const reserved = prepareQuarantine(fixture.testsRoot);
    rmSync(join(fixture.testsRoot, '.e2e-ai-agents'), {recursive: true});
    writeFileSync(join(fixture.testsRoot, '.e2e-ai-agents'), 'not a directory');
    assert.throws(() => quarantineSpec(path, fixture.testsRoot, original, generated, reserved));
    assert.deepEqual(readFileSync(path), original);
});

it('both generators remove rejected new specs when execution destroys quarantine storage', async () => {
    for (const stage3 of [false, true]) {
        const fixture = generationFixture();
        const storage = JSON.stringify(join(fixture.testsRoot, '.e2e-ai-agents'));
        const code = `${emptySpec}\nimport * as fs from 'fs';\ntest.afterEach(() => {fs.rmSync(${storage}, {recursive:true,force:true});fs.writeFileSync(${storage}, 'not a directory');});`;
        if (stage3) {
            const factory = mock.method(LLMProviderFactory, 'createFromEnv', async () => createMockProvider([code]));
            try {
                const result = await runGenerationStage([{flowId: 'boundary', flowName: 'Boundary', userActions: [], evidence: 'fixture', routeFamily: 'fixture', existingSpecs: [], action: 'create_spec'}], {pageObjects: []}, fixture.testsRoot, {repositoryRoot: fixture.repo, baseRef: fixture.baseRef, warnOnHallucinations: true});
                assert.equal(result.generated[0].verified, false);
                assert.ok(result.warnings.some((warning) => warning.includes('after rejected-spec cleanup')));
            } finally {factory.mock.restore();}
        } else {
            const result = await generateFixture(fixture, code);
            assert.equal(result.results[0].status, 'unverified');
            assert.ok(result.warnings.some((warning) => warning.includes('after rejected-spec cleanup')));
        }
        assert.equal(existsSync(join(fixture.testsRoot, 'specs/functional/ai-assisted/boundary.spec.ts')), false);
    }
});

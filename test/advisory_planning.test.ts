// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Acceptance gates: preserve complete Git identities/errors; validate exact spec
// paths; label unavailable/heuristic evidence; retain full-suite fallback; emit
// deterministic JSON without providers, execution, or filesystem/status writes.
import {afterEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';

import {getChangedFiles} from '../dist/agent/git.js';
import {recommendTestsDeterministic} from '../dist/api.js';
import {assessAdvisoryChanges, validateRepositoryPath, type AdvisoryConfig, type MappingKind} from '../dist/engine/advisory.js';

const source = 'webapp/channels/src/components/channel_header.tsx';
const cypressJs = 'e2e-tests/cypress/tests/integration/channels/messaging/post_spec.js';
const cypressTs = 'e2e-tests/cypress/tests/integration/channels/search/search_spec.ts';
const playwrightSpec = 'e2e-tests/playwright/specs/functional/channels/nested/header.spec.ts';
const otherPlaywrightSpec = 'e2e-tests/playwright/specs/functional/channels/search/search.spec.ts';
const fipsSpec = 'e2e-tests/playwright/specs/fips/channels/header.spec.ts';
const cliPath = resolve(__dirname, '../dist/cli.js');
const tempRoots: string[] = [];

afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, {recursive: true, force: true});
});

function write(root: string, file: string, content: string): void {
    mkdirSync(dirname(join(root, file)), {recursive: true});
    writeFileSync(join(root, file), content);
}

function git(root: string, ...args: string[]): string {
    return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0'},
    }).trim();
}

function fixture(changes: Record<string, string> = {[source]: 'export const header = 2;'}, kind: MappingKind = 'human-reviewed-manifest') {
    const tempRoot = mkdtempSync(join(tmpdir(), 'impact-advisory-'));
    tempRoots.push(tempRoot);
    const root = join(tempRoot, 'checkout');
    mkdirSync(root);
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'advisory-fixture@example.invalid');
    git(root, 'config', 'user.name', 'Advisory fixture');
    git(root, 'remote', 'add', 'origin', 'https://github.com/mattermost/mattermost.git');
    const config: AdvisoryConfig = {
        repository: 'mattermost/mattermost',
        sourcePatterns: ['webapp/channels/src/**', 'server/channels/**'],
        crossCuttingPatterns: ['webapp/channels/src/shared/**'],
        suites: [
            {id: 'cypress-chrome-enterprise', framework: 'cypress', root: 'e2e-tests/cypress', configFile: 'e2e-tests/cypress/cypress.config.ts', project: 'channels', browser: 'chrome', variant: 'enterprise', specPattern: 'tests/integration/**/*_spec.{js,ts}'},
            {id: 'playwright-chromium-enterprise', framework: 'playwright', root: 'e2e-tests/playwright', configFile: 'e2e-tests/playwright/playwright.config.ts', project: 'chromium', browser: 'chromium', variant: 'enterprise', specPattern: 'specs/functional/**/*.spec.ts'},
            {id: 'playwright-firefox-fips', framework: 'playwright', root: 'e2e-tests/playwright', configFile: 'e2e-tests/playwright/playwright.fips.config.ts', project: 'firefox-fips', browser: 'firefox', variant: 'fips', specPattern: 'specs/fips/**/*.spec.ts'},
        ],
        mappings: [
            {sourcePattern: source, suite: 'cypress-chrome-enterprise', specs: [cypressJs, cypressTs], provenance: {kind, evidence: 'Fixture mapping reviewed for the header flow'}},
            {sourcePattern: source, suite: 'playwright-chromium-enterprise', specs: [playwrightSpec], provenance: {kind, evidence: 'Fixture mapping reviewed for the header flow'}},
            {sourcePattern: source, suite: 'playwright-firefox-fips', specs: [fipsSpec], provenance: {kind, evidence: 'Separate FIPS fixture mapping'}},
        ],
    };
    for (const suite of config.suites) write(root, suite.configFile, 'throw new Error("Suite configuration must never execute during advisory planning");');
    for (const spec of [cypressJs, cypressTs, playwrightSpec, otherPlaywrightSpec, fipsSpec]) {
        write(root, spec, 'throw new Error("Existing test must never execute during advisory planning");');
    }
    write(root, 'e2e-tests/playwright/specs/functional/channels/helpers.ts', 'export const helper = true;');
    write(root, source, 'export const header = 1;');
    const configPath = join(root, 'impact-gate.config.json');
    writeFileSync(configPath, JSON.stringify({path: '.', testsRoot: 'e2e-tests/playwright', git: {since: 'HEAD', includeUncommitted: false}, advisory: config}));
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'Fixture base');
    const baseSha = git(root, 'rev-parse', 'HEAD');
    if (Object.keys(changes).length) {
        for (const [file, content] of Object.entries(changes)) write(root, file, content);
        git(root, 'add', '.');
        git(root, 'commit', '-qm', 'Fixture change');
    }
    const headSha = git(root, 'rev-parse', 'HEAD');
    return {root, tempRoot, config, configPath, baseSha, headSha};
}

type Fixture = ReturnType<typeof fixture>;
function plan(f: Fixture, suite = 'playwright-chromium-enterprise') {
    return recommendTestsDeterministic({cwd: f.root, path: f.root, configPath: f.configPath, gitSince: f.baseSha, advisory: true, suite});
}

function command(f: Fixture, name = 'plan', extra: string[] = [], environment: NodeJS.ProcessEnv = {}, preload?: string) {
    const isolatedEnv = {
        // Keep platform Git launcher caches in the normal temporary directory;
        // the checkout, isolated home and status sentinel are all snapshotted.
        PATH: process.env.PATH, HOME: join(f.tempRoot, 'home'), TMPDIR: process.env.TMPDIR || tmpdir(),
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', CI: 'true', ...environment,
    };
    return spawnSync(process.execPath, [
        ...(preload ? ['--require', preload] : []), cliPath, name,
        '--path', f.root, '--config', f.configPath, '--since', f.baseSha,
        '--json', ...extra,
    ], {cwd: f.root, env: isolatedEnv, encoding: 'utf8', timeout: 30000});
}

function parseOutput(result: ReturnType<typeof command>) {
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.ok(result.stdout.trim(), `Expected JSON output; stderr: ${result.stderr}`);
    return JSON.parse(result.stdout);
}

function snapshot(root: string, relative = ''): Record<string, string> {
    const result: Record<string, string> = {};
    for (const entry of readdirSync(join(root, relative)).sort()) {
        if (entry === '.git') continue;
        const file = relative ? `${relative}/${entry}` : entry;
        const stat = lstatSync(join(root, file));
        if (stat.isSymbolicLink()) result[file] = `link:${readlinkSync(join(root, file))}`;
        else if (stat.isDirectory()) {
            result[`${file}/`] = 'directory';
            Object.assign(result, snapshot(root, file));
        } else result[file] = readFileSync(join(root, file)).toString('base64');
    }
    return result;
}

describe('advisory Git and conservative selection regressions', () => {
    it('distinguishes an invalid ref from a genuinely empty diff and rejects it through the API', () => {
        const f = fixture({});
        const empty = getChangedFiles(f.root, f.baseSha);
        assert.equal(empty.error, undefined);
        assert.deepEqual(empty.files, []);
        assert.equal(empty.baseRef, f.baseSha);
        const invalid = getChangedFiles(f.root, 'refs/heads/does-not-exist');
        assert.match(invalid.error!, /git .*failed/i);
        assert.throws(() => recommendTestsDeterministic({path: f.root, configPath: f.configPath, gitSince: 'refs/heads/does-not-exist', advisory: true, suite: f.config.suites[0].id}), /git .*failed/i);
        const report = plan(f).plan;
        assert.equal(report.advisory!.diffStatus, 'empty');
        assert.deepEqual(report.advisory!.changedFiles, []);
        assert.deepEqual(report.recommendedTests, []);
        assert.notEqual(report.decision.action, 'safe-to-merge');
        assert.equal(report.advisory!.evidence.coverage, 'unavailable');
    });

    it('preserves CI, dependency, unsupported and unusual filenames in the complete Git diff', () => {
        const files = ['.github/workflows/e2e.yml', 'package-lock.json', 'docs/review notes.md', 'webapp/channels/src/components/line\nbreak.tsx'];
        const f = fixture(Object.fromEntries(files.map((file) => [file, 'changed'])));
        const result = getChangedFiles(join(f.root, 'webapp/channels'), f.baseSha);
        assert.equal(result.error, undefined);
        assert.deepEqual(result.files, [...files].sort());
        assert.equal(result.repositoryRoot, realpathSync(f.root));
        const report = plan(f).plan;
        assert.deepEqual(report.advisory!.changedFiles, [...files].sort());
        assert.equal(report.runSet, 'full');
        assert.equal(report.advisory!.fileAssessments.length, files.length);
        assert.deepEqual(report.recommendedTests, [otherPlaywrightSpec, playwrightSpec].sort());
    });

    for (const [file, status, reason] of [
        ['package-lock.json', 'cross-cutting', 'Dependency change'],
        ['docs/unsupported.md', 'unsupported', 'Unsupported change'],
        ['webapp/channels/src/components/unmapped.tsx', 'unmapped', 'No reviewed mapping'],
        ['.github/workflows/e2e.yml', 'cross-cutting', 'CI/workflow change'],
        ['e2e-tests/playwright/helpers/dispatch.ts', 'cross-cutting', 'E2E/test infrastructure change'],
        ['webapp/channels/src/shared/store.ts', 'cross-cutting', 'Configured cross-cutting change'],
    ]) {
        it(`recommends the complete existing suite for ${file} with its exact reason`, () => {
            const f = fixture({[file]: 'changed'});
            const report = plan(f).plan;
            assert.equal(report.advisory!.diffStatus, 'changed');
            assert.equal(report.runSet, 'full');
            assert.deepEqual(report.recommendedTests, report.advisory!.inventory);
            assert.deepEqual(report.advisory!.fileAssessments.map((value) => value.status), [status]);
            assert.ok(report.advisory!.fullSuiteFallbackReasons[0].startsWith(`${file}: ${reason}`));
            assert.equal(report.advisory!.executionPolicy, 'retain-full-suite');
            assert.notEqual(report.decision.action, 'safe-to-merge');
        });
    }

    it('preserves both old and new paths for a rename', () => {
        const f = fixture({});
        const renamed = 'webapp/channels/src/components/new_header.tsx';
        git(f.root, 'mv', source, renamed);
        git(f.root, 'commit', '-qm', 'Rename source');
        assert.deepEqual(getChangedFiles(f.root, f.baseSha).files, [source, renamed].sort());
        assert.deepEqual(plan(f).plan.advisory!.changedFiles, [source, renamed].sort());
    });

    it('retains all 11 E2E/CI paths from Mattermost PR 38356 and recommends the full suite', () => {
        // Portable replay of the exact reviewed file list at
        // 502cf7e3e5379ce054bee24e279ec1779911aa38..5ed5f7d29ae67d6ecf7864022e37c66792280a45.
        // These fixture commits deliberately have their own identities.
        const files = [
            '.github/scripts/manual-e2e-verification.mjs',
            '.github/scripts/manual-e2e-verification.test.mjs',
            '.github/workflows/e2e-tests-check.yml',
            '.github/workflows/e2e-tests-ci.yml',
            '.github/workflows/e2e-tests-cypress-template.yml',
            '.github/workflows/e2e-tests-override-status.yml',
            '.github/workflows/e2e-tests-playwright-template.yml',
            'e2e-tests/cypress/tests/plugins/index.js',
            'e2e-tests/cypress/tests/plugins/tsio_attempts.js',
            'e2e-tests/cypress/tests/support/index.js',
            'e2e-tests/cypress/tests/support/tsio_attempts.js',
        ];
        const f = fixture(Object.fromEntries(files.map((file) => [file, 'PR path replay'])));
        assert.deepEqual(getChangedFiles(f.root, f.baseSha).files, files);
        for (const suite of ['playwright-chromium-enterprise', 'cypress-chrome-enterprise']) {
            const report = plan(f, suite).plan;
            assert.equal(report.metrics.changedFiles, 11);
            assert.deepEqual(report.advisory!.changedFiles, files);
            assert.equal(report.runSet, 'full');
            assert.deepEqual(report.recommendedTests, report.advisory!.inventory);
            assert.equal(report.advisory!.fullSuiteFallbackReasons.length, 11);
            assert.ok(report.advisory!.fileAssessments.every((assessment) => assessment.status === 'cross-cutting'));
        }
    });
});

describe('advisory exact paths and evidence', () => {
    it('resolves nested Playwright and both Mattermost Cypress spec extensions', () => {
        const f = fixture();
        const playwright = plan(f).plan;
        const cypress = plan(f, 'cypress-chrome-enterprise').plan;
        assert.deepEqual(playwright.recommendedTests, [playwrightSpec]);
        assert.deepEqual(cypress.recommendedTests, [cypressJs, cypressTs].sort());
        for (const spec of [...playwright.recommendedTests, ...cypress.recommendedTests]) {
            assert.equal(validateRepositoryPath(f.root, spec), realpathSync(join(f.root, spec)));
        }
        assert.equal(playwright.advisory!.inventoryStatus, 'static-spec-files');
        assert.ok(playwright.advisory!.inventory.every((file) => file.startsWith('e2e-tests/playwright/specs/functional/')));
    });

    it('binds full Git identities, changed-file hash, configuration and exact suite/project/variant', () => {
        const f = fixture();
        const report = plan(f, 'playwright-firefox-fips').plan;
        const evidence = report.advisory!;
        assert.equal(evidence.repository, 'mattermost/mattermost');
        assert.equal(evidence.baseSha, f.baseSha);
        assert.equal(evidence.requestedBaseSha, f.baseSha);
        assert.equal(evidence.headSha, f.headSha);
        assert.match(evidence.baseSha, /^[0-9a-f]{40}$/);
        assert.match(evidence.headSha, /^[0-9a-f]{40}$/);
        assert.deepEqual(evidence.changedFiles, [source]);
        assert.equal(evidence.changedFilesSha256, createHash('sha256').update(JSON.stringify([source])).digest('hex'));
        assert.equal(evidence.configurationSha256, createHash('sha256').update(JSON.stringify(f.config)).digest('hex'));
        const {configSha256, ...identity} = evidence.suite;
        assert.deepEqual(identity, f.config.suites[2]);
        assert.equal(configSha256, createHash('sha256').update(readFileSync(join(f.root, identity.configFile))).digest('hex'));
        assert.deepEqual(report.recommendedTests, [fipsSpec]);
        assert.deepEqual(evidence.mappings[0].provenance, f.config.mappings[2].provenance);
    });

    for (const kind of ['static-dependency-inference', 'co-change-heuristic'] as const) {
        it(`keeps ${kind} as heuristic provenance and cannot claim targeted or measured coverage`, () => {
            const report = plan(fixture(undefined, kind)).plan;
            assert.equal(report.advisory!.mappings[0].provenance.kind, kind);
            assert.equal(report.advisory!.fileAssessments[0].status, 'unmapped');
            assert.match(report.advisory!.fullSuiteFallbackReasons[0], /Only heuristic mapping evidence/);
            assert.equal(report.runSet, 'full');
            assert.equal(report.advisory!.evidence.measuredCoverageEdges, 0);
            assert.equal(report.advisory!.evidence.coverage, 'unavailable');
            assert.equal(report.confidence, null);
            assert.equal(report.confidenceKind, 'unavailable');
            assert.deepEqual(report.coveredFlows, []);
            assert.deepEqual(report.requiredNewTests, []);
        });
    }

    it('does not turn a reviewed spec presence mapping into measured or release evidence', () => {
        const report = plan(fixture()).plan;
        assert.equal(report.advisory!.fileAssessments[0].status, 'mapped');
        assert.deepEqual(report.advisory!.evidence, {coverage: 'unavailable', execution: 'unavailable', release: 'not-assessed', specPresence: 'verified', measuredCoverageEdges: 0});
        assert.equal(report.confidence, null);
        assert.equal(report.decision.action, 'run-now');
        assert.equal(report.advisory!.executionPolicy, 'retain-full-suite');
    });

    it('rejects absolute, traversal, Windows, empty, missing and escaping symlink paths', () => {
        const f = fixture();
        const outside = join(f.tempRoot, 'outside.spec.ts');
        writeFileSync(outside, 'outside');
        symlinkSync(outside, join(f.root, 'escape.spec.ts'));
        for (const invalid of [join(f.root, playwrightSpec), '../outside.spec.ts', 'e2e-tests/../outside.spec.ts', 'C:/outside.spec.ts', 'e2e-tests\\file.spec.ts', '', 'missing.spec.ts', 'escape.spec.ts']) {
            assert.throws(() => validateRepositoryPath(f.root, invalid), undefined, `Expected rejection: ${invalid}`);
        }
        assert.throws(() => validateRepositoryPath(f.root, 'e2e-tests/playwright'), /Invalid file/);
        assert.throws(() => validateRepositoryPath(f.root, playwrightSpec, true), /Invalid directory/);
    });

    it('rejects a mapped spec outside its suite, a missing mapping and an escaping inventory symlink', () => {
        const f = fixture();
        const changes = getChangedFiles(f.root, f.baseSha);
        const mapping = f.config.mappings[1];
        mapping.specs = [cypressJs];
        assert.throws(() => assessAdvisoryChanges(changes, f.config, 'playwright-chromium-enterprise'), /outside the configured suite inventory/);
        mapping.specs = ['e2e-tests/playwright/specs/functional/missing.spec.ts'];
        assert.throws(() => assessAdvisoryChanges(changes, f.config, 'playwright-chromium-enterprise'), /ENOENT/);
        mapping.specs = [playwrightSpec];
        const outside = join(f.tempRoot, 'outside.spec.ts');
        writeFileSync(outside, 'outside');
        const escape = 'e2e-tests/playwright/specs/functional/escape.spec.ts';
        symlinkSync(outside, join(f.root, escape));
        git(f.root, 'add', escape);
        git(f.root, 'commit', '-qm', 'Escaping inventory symlink');
        assert.throws(() => assessAdvisoryChanges(getChangedFiles(f.root, f.baseSha), f.config, 'playwright-chromium-enterprise'), /escapes checkout|regular file committed/);
    });

    it('rejects mismatched repository identity, unknown suite and dirty tracked specs', () => {
        const f = fixture();
        git(f.root, 'remote', 'set-url', 'origin', 'https://github.com/other/repository.git');
        assert.throws(() => plan(f), /repository|origin/i);
        git(f.root, 'remote', 'set-url', 'origin', 'git@github.com:mattermost/mattermost.git');
        assert.throws(() => plan(f, 'unreviewed-suite'), /Unknown advisory suite/);
        write(f.root, playwrightSpec, 'modified after reported HEAD');
        assert.throws(() => plan(f), /clean tracked checkout/);
    });

    it('does not include untracked spec files in the reported committed inventory', () => {
        const f = fixture();
        write(f.root, 'e2e-tests/playwright/specs/functional/untracked.spec.ts', 'untracked');
        assert.deepEqual(plan(f).plan.advisory!.inventory, [playwrightSpec, otherPlaywrightSpec].sort());
    });

    it('fails on missing or modified skip-worktree specs and missing committed suite configuration', () => {
        const f = fixture();
        const contents = readFileSync(join(f.root, otherPlaywrightSpec), 'utf8');
        git(f.root, 'update-index', '--skip-worktree', otherPlaywrightSpec);
        rmSync(join(f.root, otherPlaywrightSpec));
        assert.equal(git(f.root, 'status', '--porcelain', '--untracked-files=no'), '');
        assert.throws(() => plan(f), /ENOENT/, 'An absent committed spec must not shrink the full inventory');
        write(f.root, otherPlaywrightSpec, 'modified but hidden from git status');
        assert.equal(git(f.root, 'status', '--porcelain', '--untracked-files=no'), '');
        assert.throws(() => plan(f), /differs from reported HEAD/);
        write(f.root, otherPlaywrightSpec, contents);
        const suiteConfig = f.config.suites[1].configFile;
        git(f.root, 'update-index', '--skip-worktree', suiteConfig);
        rmSync(join(f.root, suiteConfig));
        assert.equal(git(f.root, 'status', '--porcelain', '--untracked-files=no'), '');
        assert.throws(() => plan(f), /ENOENT/, 'A missing committed suite configuration cannot produce a report');
    });

    it('reports an unavailable empty static inventory as a full-suite fallback', () => {
        const f = fixture();
        f.config.suites[1].specPattern = 'specs/nonexistent/**/*.spec.ts';
        f.config.mappings = f.config.mappings.filter((mapping) => mapping.suite !== f.config.suites[1].id);
        const report = assessAdvisoryChanges(getChangedFiles(f.root, f.baseSha), f.config, f.config.suites[1].id);
        assert.deepEqual(report.inventory, []);
        assert.ok(report.fullSuiteFallbackReasons.some((reason) => reason.includes('inventory unavailable')));
        assert.equal(report.evidence.coverage, 'unavailable');
    });

    it('produces identical substantive plans for identical inputs', () => {
        const f = fixture();
        const {generatedAt: firstTime, ...first} = plan(f).plan;
        const {generatedAt: secondTime, ...second} = plan(f).plan;
        assert.ok(Number.isFinite(Date.parse(firstTime)));
        assert.ok(Number.isFinite(Date.parse(secondTime)));
        assert.deepEqual(first, second);
    });
});

describe('advisory CLI isolation and coverage gates', () => {
    it('fails the invalid-ref gate with one JSON error instead of an empty-diff pass', () => {
        const f = fixture();
        for (const options of [[], ['--advisory', '--suite', 'playwright-chromium-enterprise']]) {
            const result = command(f, 'gate', [...options, '--since', 'refs/heads/nonexistent']);
            const report = parseOutput(result);
            assert.notEqual(result.status, 0);
            assert.equal(report.passed, false);
            assert.match(report.error, /git .*failed/i);
        }
    });

    it('cannot pass the normal coverage gate for unsupported changes with zero assessed features', () => {
        const result = command(fixture({'docs/unsupported.md': 'changed'}), 'gate');
        const report = parseOutput(result);
        assert.notEqual(result.status, 0);
        assert.equal(report.passed, false);
        assert.notEqual(report.coveragePercent, 100);
    });

    it('never counts partial coverage as full coverage at a 100 percent gate threshold', () => {
        const f = fixture({});
        write(f.root, 'e2e-tests/playwright/.e2e-ai-agents/route-families.json', JSON.stringify({families: [{
            id: 'header', routes: ['/header'], webappPaths: [source], specDirs: [],
            cypressSpecDirs: ['../cypress/tests/integration/channels/messaging/'], priority: 'P1',
        }]}));
        git(f.root, 'add', '.');
        git(f.root, 'commit', '-qm', 'Configure Cypress-only partial coverage');
        f.baseSha = git(f.root, 'rev-parse', 'HEAD');
        write(f.root, source, 'export const header = 2;');
        git(f.root, 'add', source);
        git(f.root, 'commit', '-qm', 'Change header');
        const result = command(f, 'gate', ['--threshold', '100']);
        const report = parseOutput(result);
        assert.equal(report.totalFeatures, 1);
        assert.equal(report.coveredFeatures, 0);
        assert.ok(report.coveragePercent < 100);
        assert.equal(report.passed, false);
        assert.notEqual(result.status, 0);
    });

    it('rejects generative, execution and explicit status-output flags in advisory mode', () => {
        const f = fixture();
        for (const flags of [['--apply'], ['--crew'], ['--pipeline'], ['--generate'], ['--heal'], ['--github-output', join(f.tempRoot, 'status')], ['--ci-comment-path', join(f.tempRoot, 'comment')]]) {
            const result = command(f, 'plan', ['--advisory', '--suite', 'playwright-chromium-enterprise', ...flags]);
            const report = parseOutput(result);
            assert.notEqual(result.status, 0, flags.join(' '));
            assert.equal(report.passed, false);
            assert.match(report.error, /Advisory planning cannot/);
        }
        const result = command(f, 'generate', ['--advisory']);
        assert.notEqual(result.status, 0);
        assert.match(parseOutput(result).error, /supported only/);
    });

    it('runs plan, suggest and advisory gate without credentials, providers, network, test execution or writes', () => {
        const f = fixture({'package-lock.json': 'changed dependency'});
        const statusPath = join(f.tempRoot, 'github-output');
        writeFileSync(statusPath, 'existing-status=untouched\n');
        mkdirSync(join(f.tempRoot, 'home'));
        const preload = join(f.tempRoot, 'deny-side-effects.cjs');
        writeFileSync(preload, `
            const deny = (operation) => () => { process.stderr.write('FORBIDDEN: ' + operation); process.exit(91); };
            const factory = require(${JSON.stringify(resolve(__dirname, '../dist/provider_factory.js'))}).LLMProviderFactory;
            for (const key of Object.getOwnPropertyNames(factory)) if (typeof factory[key] === 'function') factory[key] = deny('provider ' + key);
            global.fetch = deny('fetch');
            for (const [module, methods] of [['http', ['request', 'get']], ['https', ['request', 'get']], ['net', ['connect', 'createConnection']], ['tls', ['connect']]]) {
                const api = require(module); for (const key of methods) api[key] = deny(module + '.' + key);
            }
            const cp = require('child_process');
            for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
                const original = cp[key]; cp[key] = function(command, ...args) { if (command !== 'git') return deny('process ' + command)(); return original.call(this, command, ...args); };
            }
            const fs = require('fs');
            for (const key of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'createWriteStream', 'rename', 'renameSync', 'unlink', 'unlinkSync']) fs[key] = deny('fs.' + key);
        `);
        const before = snapshot(f.tempRoot);
        for (const name of ['plan', 'suggest', 'gate']) {
            const result = command(f, name, ['--advisory', '--suite', 'playwright-chromium-enterprise'], {GITHUB_OUTPUT: statusPath}, preload);
            const report = parseOutput(result);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(report.advisory.mode, 'advisory');
            assert.equal(report.advisory.evidence.coverage, 'unavailable');
            assert.notEqual(report.passed, true);
            assert.equal(report.runSet, 'full');
            assert.deepEqual(report.recommendedTests, [playwrightSpec, otherPlaywrightSpec].sort());
        }
        assert.equal(readFileSync(statusPath, 'utf8'), 'existing-status=untouched\n');
        assert.deepEqual(snapshot(f.tempRoot), before);
    });
});

// Raw --advisory must never be consumed as another flag's missing value.
it('malformed advisory CLI arguments fail closed with one JSON error', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'impact-invalid-args-'));
    try {
        for (const args of [['plan', '--advisory', '--json'], ['plan', '--suite', '--advisory', '--json'], ['plan', '--path', '--advisory', '--json'], ['plan', '--advisory=true', '--json'], ['gate', '--since=nonexistent', '--json'], ['gate', '--threshold', 'NaN', '--json'], ['gate', '--threshold', 'Infinity', '--json'], ['--json']]) {
            const result = spawnSync(process.execPath, [resolve(__dirname, '../dist/cli.js'), ...args], {cwd, encoding: 'utf8', env: {PATH: process.env.PATH}});
            assert.notEqual(result.status, 0);
            const report = JSON.parse(result.stdout);
            assert.equal(report.passed, false);
            assert.equal(typeof report.error, 'string');
        }
    } finally { rmSync(cwd, {recursive: true, force: true}); }
});

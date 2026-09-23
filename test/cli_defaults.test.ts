import assert from 'node:assert/strict';
import {it} from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const cli = resolve('dist/cli.js');

function fixture(t: any) {
    const root = mkdtempSync(join(tmpdir(), 'cli-base-'));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const repo = join(root, 'repo');
    mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', args, {cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
    git('init', '--initial-branch=main');
    git('config', 'user.name', 'CLI regression');
    git('config', 'user.email', 'cli@example.test');
    mkdirSync(join(repo, 'src'));
    mkdirSync(join(repo, 'e2e'));
    mkdirSync(join(repo, 'custom-tests'));
    writeFileSync(join(repo, 'src/base.ts'), 'export const base = true;\n');
    git('add', '.');
    git('commit', '-m', 'base');
    const remote = join(root, 'origin.git');
    execFileSync('git', ['clone', '--quiet', '--bare', repo, remote]);
    git('remote', 'add', 'origin', remote);
    git('fetch', '--quiet', 'origin');
    git('switch', '-c', 'feature');
    for (const name of ['one', 'two']) {
        writeFileSync(join(repo, `src/${name}.ts`), `export const ${name} = true;\n`);
        git('add', '.');
        git('commit', '-m', name);
    }
    const config = join(repo, 'impact-gate.config.json');
    const putConfig = (extra: object = {}) => writeFileSync(config, JSON.stringify({testsRoot: 'custom-tests', ...extra}));
    putConfig();
    const run = (command: string, ...args: string[]) => spawnSync(process.execPath, [cli, command, ...args], {
        cwd: repo, encoding: 'utf8', timeout: 30000, env: {PATH: process.env.PATH},
    });
    const impactFiles = () => JSON.parse(readFileSync(join(repo, 'custom-tests/.e2e-ai-agents/plan.json'), 'utf8')).changedFiles;
    return {root, repo, config, putConfig, run, impactFiles};
}

it('detects the full PR base with a config while retaining its tests root, across repeated runs', (t) => {
    const f = fixture(t);
    for (let i = 0; i < 2; i++) {
        const result = f.run('impact');
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(f.impactFiles(), ['src/one.ts', 'src/two.ts']);
    }
    const review = f.run('review', '--json');
    assert.equal(review.status, 0, review.stderr);
    assert.equal(JSON.parse(review.stdout).metrics.changedFiles, 2);
    const plan = f.run('plan', '--no-ai', '--json');
    assert.equal(plan.status, 0, plan.stderr);
    assert.equal(JSON.parse(plan.stdout).metrics.changedFiles, 2);
    const gate = f.run('gate', '--json');
    assert.equal(gate.status, 1, gate.stderr);
    assert.deepEqual(JSON.parse(gate.stdout).changedFiles, ['src/one.ts', 'src/two.ts']);
});

it('detects a missing base in an empty git config and preserves explicit config/CLI precedence', (t) => {
    const f = fixture(t);
    f.putConfig({git: {includeUncommitted: false}});
    assert.equal(f.run('impact').status, 0);
    assert.deepEqual(f.impactFiles(), ['src/one.ts', 'src/two.ts']);
    f.putConfig({git: {since: 'HEAD~1', includeUncommitted: false}});
    assert.equal(f.run('impact').status, 0);
    assert.deepEqual(f.impactFiles(), ['src/two.ts']);
    assert.equal(f.run('impact', '--since', 'origin/main').status, 0);
    assert.deepEqual(f.impactFiles(), ['src/one.ts', 'src/two.ts']);
});

it('detects the base from a config pointing to a different repository directory', (t) => {
    const f = fixture(t);
    const config = join(f.root, 'external.json');
    writeFileSync(config, JSON.stringify({path: 'repo', testsRoot: 'repo/custom-tests'}));
    const result = spawnSync(process.execPath, [cli, 'impact', '--config', config], {
        cwd: f.root, encoding: 'utf8', timeout: 30000, env: {PATH: process.env.PATH},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.impactFiles(), ['src/one.ts', 'src/two.ts']);
});

it('honors explicit profile overrides while resolving a missing config base', (t) => {
    const f = fixture(t);
    f.putConfig({profile: 'mattermost', llm: {provider: 'ollama:fixture'}});
    const result = f.run('impact', '--profile', 'default');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.impactFiles(), ['src/one.ts', 'src/two.ts']);
});

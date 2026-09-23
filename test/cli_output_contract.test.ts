import assert from 'node:assert/strict';
import {it, type TestContext} from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {writeCiSummary} from '../dist/engine/plan_builder.js';

const cli = resolve(__dirname, '../dist/cli.js');

function fixture(t: TestContext) {
    const root = mkdtempSync(join(tmpdir(), 'impact-gate-output-'));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const repo = join(root, 'repo');
    const testsRoot = join(repo, 'e2e');
    mkdirSync(join(repo, 'src'), {recursive: true});
    mkdirSync(testsRoot);
    const git = (...args: string[]) => execFileSync('git', args, {
        cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    git('init', '--initial-branch=main');
    git('config', 'user.name', 'Output regression');
    git('config', 'user.email', 'output@example.test');
    writeFileSync(join(repo, '.gitignore'), '.e2e-ai-agents/\ne2e/comments/\n');
    writeFileSync(join(repo, 'src/input.ts'), 'export function value(input: string) { return input; }\n');
    git('add', '.');
    git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'src/input.ts'), 'export function value(input: string) {\n    if (!input) throw new Error("Required");\n    return input.trim();\n}\n');
    git('add', '.');
    git('commit', '-m', 'fix input validation');
    const run = (command: string, ...args: string[]) => spawnSync(process.execPath, [
        cli, command, '--path', repo, '--since', base, '--json', ...args,
    ], {cwd: root, encoding: 'utf8', timeout: 30000, env: {PATH: process.env.PATH}});
    return {root, repo, testsRoot, run};
}

it('predict emits one JSON document for normal, provider fallback, and failing threshold runs', (t) => {
    const f = fixture(t);
    for (const mode of [
        {args: [], status: 0, diagnostic: /Analyzing defect risk:/},
        {args: ['--deep', '--llm-provider', 'openai'], status: 0, diagnostic: /Falling back to deterministic analysis/},
        {args: ['--predict-threshold', '0'], status: 1, diagnostic: /GATE FAILED:/},
    ]) {
        const result = f.run('predict', ...mode.args);
        assert.equal(result.status, mode.status, result.stderr || String(result.error));
        const prediction = JSON.parse(result.stdout);
        assert.ok(prediction.score > 0 && prediction.score <= 1);
        assert.equal(prediction.metrics.change.nf, 1);
        assert.match(result.stderr, mode.diagnostic);
    }
});

it('predict argument errors also remain a single JSON document', (t) => {
    const result = fixture(t).run('predict', '--predict-threshold', 'invalid');
    assert.notEqual(result.status, 0);
    const error = JSON.parse(result.stdout);
    assert.equal(error.passed, false);
    assert.match(error.error, /predict-threshold/);
});

it('plan writes relative and absolute CI comments to the declared destination', (t) => {
    const f = fixture(t);
    for (const requested of ['comments/plan.md', join(f.root, 'external-comments/plan.md')]) {
        const githubOutput = join(f.root, 'github-output.txt');
        writeFileSync(githubOutput, '');
        const result = f.run('plan', '--no-ai', '--tests-root', f.testsRoot,
            '--ci-comment-path', requested, '--github-output', githubOutput);
        assert.equal(result.status, 0, result.stderr || String(result.error));
        assert.equal(JSON.parse(result.stdout).metrics.changedFiles, 1);
        const expectedPath = resolve(f.testsRoot, requested);
        assert.equal(
            readFileSync(expectedPath, 'utf8'),
            readFileSync(join(f.testsRoot, '.e2e-ai-agents/ci-summary.md'), 'utf8'),
        );
        const summaryLine = readFileSync(githubOutput, 'utf8').split('\n').find((line) => line.startsWith('summary_path='));
        assert.equal(summaryLine, `summary_path=${expectedPath}`);
        if (requested === expectedPath) {
            assert.equal(existsSync(join(f.testsRoot, requested)), false, 'absolute paths must not be nested under testsRoot');
        }
    }
});

it('CI summaries retain their default location', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'impact-gate-summary-'));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const destination = writeCiSummary(root, 'Review summary\n');
    assert.equal(destination, join(root, '.e2e-ai-agents/ci-summary.md'));
    assert.equal(readFileSync(destination, 'utf8'), 'Review summary\n');
});

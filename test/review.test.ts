import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {execFileSync, spawnSync, spawn} from 'node:child_process';
import {formatReviewJSON, formatReviewMarkdown} from '../dist/engine/review_formatter.js';
import {resolveDefaults, detectTestsRoot} from '../dist/cli/defaults.js';
import {findRelevantTests} from '../dist/engine/behavior_analyzer.js';

const cli = resolve('dist/cli.js');
function fixture(t: any) {
    const root = mkdtempSync(join(tmpdir(), 'review-regression-'));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const repo = join(root, 'repo'); mkdirSync(repo);
    const put = (file: string, data: string) => {mkdirSync(dirname(join(repo, file)), {recursive: true}); writeFileSync(join(repo, file), data);};
    const git = (...args: string[]) => execFileSync('git', args, {cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
    git('init'); git('config', 'user.name', 'Review Test'); git('config', 'user.email', 'review@example.test');
    put('src/widget.ts', 'export function Widget() { return <button disabled>Old</button>; }\n');
    put('e2e-tests/playwright/specs/deleted.spec.ts', "test('deleted title must not appear', async () => {});\n");
    put('e2e-tests/playwright/specs/old.spec.ts', "test('old scenario', async () => {});\n");
    git('add', '.'); git('commit', '-m', 'base'); const base = git('rev-parse', 'HEAD');
    rmSync(join(repo, 'e2e-tests/playwright/specs/deleted.spec.ts'));
    put('src/widget.ts', 'export function Widget() { return <button>New</button>; }\n');
    put('src/widget.test.ts', "test('adjacent unit', () => {});\n");
    put('e2e-tests/playwright/specs/new.spec.ts', "test('actual new scenario title', async () => {});\n");
    git('add', '.'); git('commit', '-m', 'head');
    const inventory = join(root, 'base-inventory');
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', repo, inventory]);
    execFileSync('git', ['checkout', '--quiet', '--detach', base], {cwd: inventory});
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, 'review', '--path', repo, '--since', base, '--tests-root', join(inventory, 'e2e-tests/playwright'), '--json', ...args], {cwd: root, encoding: 'utf8', env: {PATH: process.env.PATH}, timeout: 30000});
    return {root, repo, put, git, base, inventory, run};
}

for (const mode of ['success', 'empty', 'invalid', 'threshold', 'comment-error']) {
    it(`built review emits exactly one JSON object: ${mode}`, (t) => {
        const f = fixture(t);
        const args = mode === 'empty' ? ['--since', 'HEAD'] : mode === 'invalid' ? ['--since', 'nonexistent-ref'] : mode === 'threshold' ? ['--threshold', '-1'] : ['--ci-comment-path', mode === 'comment-error' ? f.root : join(f.root, 'comment.md')];
        const result = f.run(...args);
        assert.equal(result.error, undefined);
        const data = JSON.parse(result.stdout);
        assert.equal(typeof data, 'object');
        assert.equal(result.status === 0, mode === 'success' || mode === 'empty', result.stderr);
        if (mode === 'success') {
            assert.equal(data.prIncludedTestSummary.scenarioCount, 1);
            assert.ok(readFileSync(join(f.root, 'comment.md'), 'utf8').includes('specs/new.spec.ts'));
        }
        if (mode === 'empty') assert.equal(data.metrics.changedFiles, 0);
        if (mode === 'invalid' || mode === 'comment-error') assert.equal(typeof data.error, 'string');
    });
}

it('ordinary reviews neither create nor rewrite calibration artifacts or grow the diff', (t) => {
    const f = fixture(t);
    const file = join(f.repo, '.e2e-ai-agents/prediction-calibration.json');
    const first = f.run(); const second = f.run();
    assert.equal(existsSync(file), false);
    assert.equal(JSON.parse(first.stdout).metrics.changedFiles, JSON.parse(second.stdout).metrics.changedFiles);
    f.put('.e2e-ai-agents/prediction-calibration.json', '{"schemaVersion":"1.0.0","entries":[]}\n');
    const before = readFileSync(file);
    f.run(); assert.deepEqual(readFileSync(file), before);
});

it('nested --path uses Git repository root for PR scenarios, independent of base inventory', (t) => {
    const f = fixture(t);
    for (const inventoryRoot of [f.inventory, join(f.inventory, 'e2e-tests/playwright')]) {
        const data = JSON.parse(f.run('--path', join(f.repo, 'src'), '--tests-root', inventoryRoot).stdout);
        assert.equal(data.prIncludedTestSummary.scenarioCount, 1);
        assert.ok(data.relevantExistingTests.some((test: any) => test.file === 'src/widget.test.ts' && test.matchReason === 'adjacency'));
    }
    const impact: any = {prIncludedTestFiles: [{file: 'e2e-tests/playwright/specs/new.spec.ts', type: 'playwright'}, {file: 'e2e-tests/playwright/specs/deleted.spec.ts', type: 'playwright'}], impactedFeatures: []};
    const found = findRelevantTests([], impact, f.repo);
    assert.deepEqual(found.prIncluded[0].scenarios, ['actual new scenario title']);
    assert.deepEqual(found.prIncluded[1].scenarios, []);
});

it('auto-detected external roots are absolute while explicit roots and init detection remain portable', (t) => {
    const f = fixture(t);
    assert.equal(resolveDefaults({path: f.repo, gitSince: f.base}).testsRoot, join(f.repo, 'e2e-tests/playwright'));
    assert.equal(detectTestsRoot(f.repo), 'e2e-tests/playwright');
    assert.equal(resolveDefaults({path: f.repo, testsRoot: 'explicit/root', gitSince: f.base}).testsRoot, 'explicit/root');
    assert.equal(resolveDefaults({path: f.root, gitSince: f.base}).testsRoot, f.root);
});

it('JSON and Markdown retain computed fields, six recommendations and full paths', () => {
    const report: any = {
        impactedFlows: [{id: 'flow', name: 'Flow', priority: 'P2', status: 'covered', changedFiles: ['src/widget.ts'], existingTests: ['e2e-tests/playwright/specs/existing.spec.ts'], gaps: [], userFlows: []}],
        coverageGaps: [], riskAssessment: {score: 0.2, level: 'low', topFactors: [], recommendation: 'Review'}, decision: {action: 'review-recommended', summary: 'Review', details: []},
        metrics: {changedFiles: 1, impactedFlows: 1, coveredFlows: 1, partialFlows: 0, uncoveredFlows: 0, coverageGaps: 0, confidence: 50},
        behaviorSummary: ['Changed widget behavior'],
        recommendations: Array.from({length: 6}, (_, i) => ({scenario: `Scenario ${i + 1}`, priority: 'P1', rationale: `Rationale ${i + 1}`, ...(i === 5 ? {} : {dimension: 'core-flow', alreadyCoveredBy: 'e2e-tests/playwright/specs/covered.spec.ts'})})),
        relevantExistingTests: [{file: 'e2e-tests/playwright/specs/matched.spec.ts', matchReason: 'manifest'}],
        prIncludedTestSummary: {files: ['e2e-tests/playwright/specs/new.spec.ts'], scenarioCount: 2},
        affectedFunctions: [{node: {id: 'widget', name: 'widget', kind: 'function', filePath: 'src/widget.ts'}, impact: 'direct', calledBy: [{name: 'caller'}], testedBy: [{name: 'test', filePath: 'specs/widget.spec.ts'}], depth: 0}],
    };
    assert.deepEqual(formatReviewJSON(report), report);
    const md = formatReviewMarkdown(report);
    for (const value of ['Changed widget behavior', 'Scenario 6', 'Rationale 6', 'core-flow', 'covered.spec.ts', 'e2e-tests/playwright/specs/matched.spec.ts', 'manifest', 'specs/new.spec.ts', '2', 'widget', 'caller', 'specs/widget.spec.ts']) assert.ok(md.includes(value), value);
    const {behaviorSummary, recommendations, relevantExistingTests, prIncludedTestSummary, affectedFunctions, ...minimal} = report;
    assert.doesNotThrow(() => formatReviewMarkdown(minimal));
    assert.deepEqual(formatReviewJSON(minimal), minimal);
});


for (const mode of ['threshold', 'enforcement']) {
    it(`large piped JSON drains before ${mode} exit`, async (t) => {
        const f = fixture(t);
        for (let i = 0; i < 2000; i++) {
            f.put(`e2e-tests/playwright/specs/${i}-${'long-name-'.repeat(8)}.spec.ts`, "test('large report scenario', async () => {});\n");
        }
        f.git('add', '.'); f.git('commit', '-m', 'large test-only report');
        const extra = mode === 'enforcement' ? ['--policy-enforcement-mode', 'block', '--policy-block-actions', 'run-now,must-add-tests,safe-to-merge'] : [];
        const child = spawn(process.execPath, [cli, 'review', '--path', f.repo, '--since', f.base, '--tests-root', f.inventory, '--json', '--threshold', '-1', '--ci-comment-path', join(f.root, 'large-comment.md'), ...extra], {cwd: f.root, env: {PATH: process.env.PATH}});
        let stdout = ''; let stderr = ''; let resumeScheduled = false;
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {stdout += chunk;});
        // Hold pipe reads until reporting begins, reliably filling the pipe before exit.
        child.stdout.pause();
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
            if (!resumeScheduled && stderr.includes('PR comment written to')) {
                resumeScheduled = true;
                setTimeout(() => child.stdout.resume(), 200);
            }
        });
        const timer = setTimeout(() => {child.stdout.resume(); child.kill();}, 30000);
        const code = await new Promise<number | null>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', resolve);
        }).finally(() => clearTimeout(timer));
        assert.equal(code, mode === 'enforcement' ? 2 : 1, stderr);
        const report = JSON.parse(stdout);
        assert.ok(Buffer.byteLength(stdout) > 200000);
        assert.equal(report.prIncludedTestSummary.scenarioCount, 2001);
        if (mode === 'enforcement') assert.ok(!stderr.includes('GATE FAILED'), 'enforcement retains precedence over threshold');
    });
}

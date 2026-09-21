import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const load = new Function('url', 'return import(url)');
const controller = load(pathToFileURL(resolve('scripts/release-qa-swarm.mjs')).href);
const hash = (data: string) => createHash('sha256').update(data).digest('hex');

async function fixture(t: any, options: any = {}) {
    const api = await controller;
    const root = mkdtempSync(join(tmpdir(), 'release-swarm-test-'));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    let sequence = 0;
    const file = (value: any, raw = false) => {
        const path = join(root, `input-${sequence++}`);
        writeFileSync(path, raw ? value : JSON.stringify(value));
        return path;
    };
    const request = options.request ?? {};
    const init = api.initRun({
        runDir: join(root, 'run'), requestPath: file(request), orchestratorId: 'native-root',
        capabilitiesPath: file({provider: 'cursor-native', dispatchTool: 'native_dispatch_observed', waitTool: 'native_wait_observed', freshContext: true, synchronous: options.synchronous ?? true, rawEvidencePath: file('native_dispatch_observed native_wait_observed', true)}),
    });
    const runDir = init.runDir;
    const plan = () => ({
        schemaVersion: 1, runId: init.runId, id: 'dynamic-plan', version: 1, frozen: true,
        reviewerContractSha256: api.readRun(runDir).init.contracts.reviewer.sha256,
        release: {releaseId: 'candidate-from-input', buildId: 'pinned-build'},
        scenarios: [{id: 'changed-journey', executorKey: 'executor', requiredAssertions: ['saved-value']}],
        assertions: [{id: 'saved-value', executorKey: 'executor', role: 'administrator', screenshotRequired: false, checks: [{id: 'value', kind: 'api', type: 'boolean', expected: false, expectedHttpStatus: 200}]}],
    });
    const receipt = (job: any, overrides: any = {}, planOverride?: any) => {
        const artifacts: any = {};
        for (const key of job.requiredOutputKeys) artifacts[key] = file({testFixtureOnly: true});
        if (job.role === 'planner') {
            const body = JSON.stringify(planOverride ?? plan());
            artifacts.plan = file(body, true);
            artifacts['plan-hash'] = file(hash(body), true);
        }
        const actor = overrides.agentId ?? `native-${job.role}`;
        return {provider: 'cursor-native', dispatchTool: 'native_dispatch_observed', agentId: actor, promptSha256: job.promptSha256, rawReceiptPath: file({nativeActor: actor}), dispatchPromptPath: file(job.prompt, true), status: 'completed', artifacts, ...overrides};
    };
    const record = (job: any, overrides: any = {}, planOverride?: any) => api.recordReceipt(runDir, job.jobId, file(receipt(job, overrides, planOverride)));
    return {api, root, runDir, file, plan, receipt, record};
}

describe('Cursor release QA native handoff controller', () => {
    it('HARNESS_ONLY accepts one complete native-record path through the real gate', async (t) => {
        const f = await fixture(t);
        const planner = f.api.nextJob(f.runDir);
        f.record(planner);
        f.record(f.api.nextJob(f.runDir));
        const executor = f.api.nextJob(f.runDir);
        const frozen = f.api.readRun(f.runDir).jobs[0].completion.artifacts.plan;
        const plan = JSON.parse(readFileSync(frozen.path, 'utf8'));
        const planBinding = {id: plan.id, version: plan.version, sha256: frozen.sha256};
        const apiPath = f.file({status: 200, body: {enabled: false}});
        const setupPath = f.file('HARNESS_ONLY environment identity fixture', true);
        const ref = (path: string) => ({path, sha256: hash(readFileSync(path, 'utf8'))});
        const evidence = {
            schemaVersion: 1, runId: executor.runId, plan: planBinding,
            environment: {worker: {agentId: 'native-environment', runId: 'native-environment'}, ready: true, release: plan.release, evidenceIds: ['setup']},
            artifacts: [{id: 'setup', ...ref(setupPath), kind: 'text'}, {id: 'response', ...ref(apiPath), kind: 'json'}],
            results: [{assertionId: 'saved-value', executor: {agentId: 'native-executor', runId: 'native-executor'}, status: 'PASS', role: 'administrator', release: plan.release,
                checks: [{id: 'value', value: false, evidenceId: 'response', jsonPointer: '/body/enabled'}]}],
        };
        const executorReceipt = f.receipt(executor);
        executorReceipt.artifacts['evidence-manifest'] = f.file(evidence);
        f.api.recordReceipt(f.runDir, executor.jobId, f.file(executorReceipt));
        const reviewer = f.api.nextJob(f.runDir);
        const evidenceRef = f.api.readRun(f.runDir).jobs[2].completion.artifacts['evidence-manifest'];
        const review = {schemaVersion: 1, runId: reviewer.runId, reviewer: {agentId: 'native-reviewer', runId: 'native-reviewer'}, reviewerContractSha256: reviewer.reviewerContractSha256,
            plan: planBinding, evidenceSha256: evidenceRef.sha256, audit: 'ACCEPTED',
            scope: {readiness: true, role: true, build: true, screenshots: true},
            assertions: [{assertionId: 'saved-value', audit: 'ACCEPTED', checkIds: ['value']}],
        };
        const reviewerReceipt = f.receipt(reviewer);
        reviewerReceipt.artifacts.review = f.file(review);
        f.api.recordReceipt(f.runDir, reviewer.jobId, f.file(reviewerReceipt));
        const result = f.api.nextJob(f.runDir);
        assert.equal(result.status, 'GATED');
        assert.equal(result.gate.verdict, 'PASS', JSON.stringify(result.gate));
        assert.equal(result.gate.audit, 'ACCEPTED');
        assert.match(result.provenance, /not independently authenticated/);
    });

    it('issues fixed role contracts in order, waits on outstanding work, then binds its own gate bundle', async (t) => {
        const f = await fixture(t);
        for (const role of ['planner', 'environment', 'executor', 'reviewer']) {
            const job = f.api.nextJob(f.runDir);
            assert.equal(job.role, role);
            assert.equal(job.status, 'DISPATCH_NATIVE');
            assert.equal(job.promptSha256, hash(job.prompt));
            assert.equal(f.api.nextJob(f.runDir).jobId, job.jobId);
            assert.ok(job.prompt.startsWith(readFileSync(job.contractRef.path, 'utf8')));
            f.record(job);
        }
        const result = f.api.nextJob(f.runDir);
        assert.equal(result.status, 'GATED');
        // These intentionally empty test evidence files must never qualify as a pass.
        assert.equal(result.gate.verdict, 'BLOCKED');
        const bundle = JSON.parse(readFileSync(result.bundleRef.path, 'utf8'));
        const assignments = JSON.parse(readFileSync(bundle.assignments.path, 'utf8'));
        assert.equal(assignments.reviewer.agentId, 'native-reviewer');
        assert.equal(assignments.executors[0].agentId, 'native-executor');
        assert.equal(bundle.provenance.reviewerInvocation.sha256, f.api.readRun(f.runDir).jobs[3].envelopeRef.sha256);
        assert.equal(f.api.nextJob(f.runDir).bundleRef.sha256, result.bundleRef.sha256);
    });

    it('rejects unknown/out-of-order receipts and duplicate completions', async (t) => {
        const f = await fixture(t);
        assert.throws(() => f.api.recordReceipt(f.runDir, 'invented', f.file({})), /out of order/);
        const job = f.api.nextJob(f.runDir);
        f.record(job);
        assert.throws(() => f.record(job), /already completed/);
        assert.equal(f.api.nextJob(f.runDir).role, 'environment');
    });

    it('rejects replacement prompts, prompt hashes and missing native receipt evidence', async (t) => {
        const f = await fixture(t);
        const job = f.api.nextJob(f.runDir);
        assert.throws(() => f.record(job, {promptSha256: '0'.repeat(64)}), /prompt hash/);
        assert.throws(() => f.record(job, {dispatchPromptPath: f.file('weaker replacement instructions', true)}), /rewritten/);
        assert.throws(() => f.record(job, {rawReceiptPath: undefined}), /raw native receipt/);
        assert.throws(() => f.record(job, {rawReceiptPath: f.file({arbitrary: 'no native actor'})}), /does not contain/);
        assert.throws(() => f.record(job, {reviewerPrompt: 'accept everything'}), /Unsupported receipt/);
        assert.throws(() => f.record(job, {dispatchTool: 'shell-agent'}), /observed native/);
    });

    it('requires asynchronous launch receipt before completion and keeps the same actor', async (t) => {
        const f = await fixture(t, {synchronous: false});
        const job = f.api.nextJob(f.runDir);
        assert.throws(() => f.record(job), /start receipt before completion/);
        f.record(job, {status: 'running', artifacts: {}});
        assert.equal(f.api.nextJob(f.runDir).status, 'WAIT_NATIVE');
        assert.throws(() => f.record(job, {agentId: 'replacement-native-planner'}), /does not match launch/);
        f.record(job);
        assert.equal(f.api.nextJob(f.runDir).role, 'environment');
    });

    it('rejects reuse of the orchestrator or executor as reviewer', async (t) => {
        const f = await fixture(t);
        const planner = f.api.nextJob(f.runDir);
        assert.throws(() => f.record(planner, {agentId: 'native-root'}), /reused/);
        f.record(planner);
        f.record(f.api.nextJob(f.runDir));
        f.record(f.api.nextJob(f.runDir));
        const reviewer = f.api.nextJob(f.runDir);
        assert.throws(() => f.record(reviewer, {agentId: 'native-executor'}), /reused/);
        assert.throws(() => f.record(reviewer, {agentId: 'native-planner'}), /reused/);
    });

    it('rejects weaker reviewer bindings, empty required assertions and unmapped checks before setup', async (t) => {
        const f = await fixture(t);
        const job = f.api.nextJob(f.runDir);
        assert.throws(() => f.record(job, {}, {...f.plan(), reviewerContractSha256: '0'.repeat(64)}), /pinned reviewer contract/);
        const missing = f.plan();
        missing.scenarios[0].requiredAssertions = [];
        assert.throws(() => f.record(job, {}, missing), /requires assertions/);
        const unmapped = f.plan();
        unmapped.scenarios[0].requiredAssertions = ['unknown'];
        assert.throws(() => f.record(job, {}, unmapped), /uniquely cover/);
        assert.equal(f.api.nextJob(f.runDir).role, 'planner');
    });

    it('preserves failures and empty scope without launching downstream work or returning GO', async (t) => {
        const f = await fixture(t);
        f.record(f.api.nextJob(f.runDir), {status: 'failed', artifacts: {}, reason: 'Native worker failed'});
        assert.equal(f.api.nextJob(f.runDir).status, 'INCOMPLETE');
        assert.equal(f.api.nextJob(f.runDir).qualification, 'INSUFFICIENT_EVIDENCE');
        const empty = await fixture(t);
        empty.record(empty.api.nextJob(empty.runDir), {}, {...empty.plan(), scenarios: [], assertions: []});
        assert.equal(empty.api.nextJob(empty.runDir).status, 'NO_EXECUTABLE_SCOPE');
        assert.equal(empty.api.readRun(empty.runDir).jobs.length, 1);
    });

    it('detects modified frozen artifacts and refuses to reuse an existing run directory', async (t) => {
        const f = await fixture(t);
        const job = f.api.nextJob(f.runDir);
        f.record(job);
        const ref = f.api.readRun(f.runDir).jobs[0].completion.artifacts.plan;
        chmodSync(ref.path, 0o600);
        writeFileSync(ref.path, '{}');
        assert.throws(() => f.api.nextJob(f.runDir), /Artifact changed/);
        assert.throws(() => f.api.initRun({runDir: f.runDir}), /already exists/);
    });

    it('retains audit-existing source provenance without claiming fresh product execution', async (t) => {
        const sourceDir = mkdtempSync(join(tmpdir(), 'swarm-source-test-'));
        t.after(() => rmSync(sourceDir, {recursive: true, force: true}));
        const source = join(sourceDir, 'historical.json');
        writeFileSync(source, '{"historicalRun":"original-native-run"}');
        const f = await fixture(t, {request: {mode: 'audit-existing', sourceArtifactBundle: source, limits: {maxTokens: 500, maxUSD: 1}}});
        const job = f.api.nextJob(f.runDir);
        assert.equal(job.request.mode, 'audit-existing');
        assert.equal(readFileSync(job.sourceArtifactBundleRef.path, 'utf8'), readFileSync(source, 'utf8'));
        assert.match(f.api.readRun(f.runDir).init.budgetEnforcement, /no hard token\/USD enforcement/);
        assert.equal(job.limits.maxScenarios, 3);
    });
});

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const load = new Function('url', 'return import(url)');
const script = resolve('scripts/release-qa-swarm-gate.mjs');
const gate = load(pathToFileURL(script).href);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const id = () => randomUUID();
const actor = () => ({agentId: id(), runId: id()});

// Synthetic test-only native records; these are not a real swarm run or QA proof.
function fixture(t) {
    const dir = mkdtempSync(join(tmpdir(), 'release-qa-gate-'));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    const runId = id(), uiId = id(), apiId = id(), uiCheckId = id(), apiCheckId = id();
    const screenshotId = id(), apiArtifactId = id(), environmentArtifactId = id();
    const executor = {...actor(), key: id()};
    const secondExecutor = {...actor(), key: id()};
    const assignments = {orchestrator: actor(), planner: actor(), environment: actor(),
        executors: [executor, secondExecutor], reviewer: actor()};
    const contract = 'Review all frozen assertions, exact evidence, readiness, roles, and build.\n';
    const contractHash = digest(contract);
    const release = {releaseId: id(), buildId: id()};
    const assertions = [
        {id: uiId, executorKey: executor.key, role: 'role-' + id(), screenshotRequired: true,
            checks: [{id: uiCheckId, kind: 'ui', type: 'string', expected: 'private'}]},
        {id: apiId, executorKey: secondExecutor.key, role: 'role-' + id(), screenshotRequired: false,
            checks: [{id: apiCheckId, kind: 'api', type: 'boolean', expected: false, expectedHttpStatus: 200}]},
    ];
    const plan = {schemaVersion: 1, runId, id: id(), version: 3, frozen: true,
        reviewerContractSha256: contractHash, release, assertions,
        scenarios: assertions.map((a) => ({id: id(), executorKey: a.executorKey, requiredAssertions: [a.id]}))};
    const identity = ({agentId, runId}) => ({agentId, runId});
    const evidence = {schemaVersion: 1, runId, plan: {},
        environment: {worker: assignments.environment, ready: true, release: {...release}, evidenceIds: [environmentArtifactId]},
        artifacts: [], results: [
            {assertionId: uiId, executor: identity(executor), status: 'PASS', role: assertions[0].role,
                release: {...release}, screenshotArtifactId: screenshotId,
                readiness: {domReady: true, targetVisible: true, loadingVisible: false,
                    screenshotInspected: true, screenshotTargetVisible: true, screenshotLoadingVisible: false},
                checks: [{id: uiCheckId, value: 'private', evidenceId: screenshotId}]},
            {assertionId: apiId, executor: identity(secondExecutor), status: 'PASS', role: assertions[1].role,
                release: {...release}, checks: [{id: apiCheckId, value: false, evidenceId: apiArtifactId,
                    jsonPointer: '/body/settings/enabled'}]},
        ]};
    const review = {schemaVersion: 1, runId, reviewer: assignments.reviewer, reviewerContractSha256: contractHash,
        plan: {}, evidenceSha256: '', audit: 'ACCEPTED',
        scope: {readiness: true, role: true, build: true, screenshots: true},
        assertions: assertions.map((a) => ({assertionId: a.id, audit: 'ACCEPTED', checkIds: a.checks.map((c) => c.id)}))};
    const prompt = contract + '\n\n---\nController handoff data {}\n';
    const invocation = {schemaVersion: 1, runId, jobId: id(), role: 'reviewer', reviewerContractSha256: contractHash,
        contractRef: {}, prompt, promptSha256: digest(prompt), prerequisites: []};
    const receipt = {jobId: invocation.jobId, role: 'reviewer', provider: 'test-native-provider', dispatchTool: 'test.spawn',
        ...assignments.reviewer, promptSha256: digest(prompt), status: 'completed', rawReceipt: {}, dispatchedPrompt: {}, artifacts: {}};
    const bundle = {schemaVersion: 1, runId, plan: {}, assignments: {}, evidence: {}, review: {}, provenance: {}};
    const state = {dir, plan, assignments, evidence, review, invocation, receipt, bundle,
        api: {status: 200, body: {settings: {enabled: false}}}, contract, uiId, apiId,
        uiCheckId, apiCheckId, screenshotId, apiArtifactId, environmentArtifactId,
        bundlePath: join(dir, 'bundle.json'), save: () => {}};
    function file(name, value) {
        const data = Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        writeFileSync(join(dir, name), data);
        return {path: name, sha256: digest(data)};
    }
    state.save = () => {
        const contractRef = file('reviewer.md', state.contract);
        bundle.plan = {...file('plan.json', plan), id: plan.id, version: plan.version};
        bundle.assignments = file('assignments.json', assignments);
        evidence.plan = {id: plan.id, version: plan.version, sha256: bundle.plan.sha256};
        evidence.artifacts = [
            {id: screenshotId, ...file('view.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64')), kind: 'screenshot'},
            {id: apiArtifactId, ...file('api.json', state.api), kind: 'json'},
            {id: environmentArtifactId, ...file('build.txt', release.buildId), kind: 'text'},
        ];
        bundle.evidence = file('evidence.json', evidence);
        review.plan = {...evidence.plan};
        review.evidenceSha256 = bundle.evidence.sha256;
        bundle.review = file('review.json', review);
        invocation.contractRef = contractRef;
        invocation.promptSha256 = digest(invocation.prompt);
        invocation.prerequisites = [{artifacts: {plan: {path: bundle.plan.path, sha256: bundle.plan.sha256}}},
            {artifacts: {'evidence-manifest': bundle.evidence}}];
        receipt.promptSha256 = invocation.promptSha256;
        receipt.rawReceipt = file('native-receipt.json', {testFixture: true, agentId: assignments.reviewer.agentId});
        receipt.dispatchedPrompt = file('dispatched-prompt.txt', invocation.prompt);
        receipt.artifacts = {review: bundle.review};
        bundle.provenance = {reviewerContract: contractRef, reviewerInvocation: file('invocation.json', invocation),
            reviewerReceipt: file('receipt.json', receipt)};
        file('bundle.json', bundle);
    };
    state.save();
    return state;
}

async function result(f) {
    return (await gate).validateBundleFile(f.bundlePath);
}
async function blocked(f, code) {
    const output = await result(f);
    assert.equal(output.valid, false, JSON.stringify(output));
    assert.equal(output.verdict, 'BLOCKED');
    assert.notEqual(output.audit, 'ACCEPTED');
    if (code) assert.equal(output.errors[0].code, code, JSON.stringify(output));
}
function rehashJson(f, ref, mutate) {
    const file = join(f.dir, ref.path);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    mutate(data);
    const bytes = JSON.stringify(data, null, 2);
    writeFileSync(file, bytes);
    ref.sha256 = digest(bytes);
    writeFileSync(f.bundlePath, JSON.stringify(f.bundle));
}

describe('release QA swarm evidence gate', () => {
    it('accepts generic dynamic identities and deterministic exact-byte evidence bindings', async (t) => {
        const f = fixture(t);
        const first = await result(f);
        assert.equal(first.verdict, 'PASS', JSON.stringify(first));
        assert.equal(first.valid, true);
        assert.equal(first.audit, 'ACCEPTED');
        assert.deepEqual(first, await result(f));
        assert.match(first.limitations.join(' '), /no external immutable trust anchor/);
        assert.match(first.limitations.join(' '), /does not.*inspect screenshot pixels/);
    });

    it('accepts API-only assertions without screenshots or UI readiness', async (t) => {
        const f = fixture(t);
        f.plan.assertions.shift(); f.plan.scenarios.shift();
        f.evidence.results.shift(); f.review.assertions.shift(); f.save();
        assert.equal((await result(f)).verdict, 'PASS');
    });

    it('keeps an optional UI screenshot optional', async (t) => {
        const f = fixture(t);
        f.plan.assertions[0].screenshotRequired = false;
        delete f.evidence.results[0].screenshotArtifactId;
        f.evidence.results[0].readiness = {domReady: true, targetVisible: true, loadingVisible: false};
        f.evidence.results[0].checks[0].evidenceId = f.environmentArtifactId;
        f.save();
        assert.equal((await result(f)).verdict, 'PASS');
    });

    it('accepts an explicitly planned HTTP 403 permission scenario', async (t) => {
        const f = fixture(t);
        f.plan.assertions[1].checks[0].expectedHttpStatus = 403;
        f.api.status = 403; f.save();
        assert.equal((await result(f)).verdict, 'PASS');
    });

    const cases = [
        ['loading screenshot despite ready DOM', (f) => { f.evidence.results[0].readiness.screenshotLoadingVisible = true; }, 'NOT_READY'],
        ['optional screenshot contradicting readiness', (f) => { f.plan.assertions[0].screenshotRequired = false; f.evidence.results[0].readiness.screenshotTargetVisible = false; }, 'NOT_READY'],
        ['missing readiness field', (f) => { delete f.evidence.results[0].readiness.loadingVisible; }, 'MISSING_FIELD'],
        ['truthy readiness string', (f) => { f.evidence.results[0].readiness.domReady = 'true'; }, 'VALUE_TYPE_MISMATCH'],
        ['missing required screenshot', (f) => { delete f.evidence.results[0].screenshotArtifactId; }, 'SCREENSHOT_REQUIRED'],
        ['wrong role', (f) => { f.evidence.results[0].role = id(); }, 'ROLE_MISMATCH'],
        ['wrong release', (f) => { f.evidence.results[0].release.releaseId = id(); }, 'RELEASE_MISMATCH'],
        ['wrong build', (f) => { f.evidence.environment.release.buildId = id(); }, 'BUILD_MISMATCH'],
        ['unready environment', (f) => { f.evidence.environment.ready = false; }, 'ENVIRONMENT_NOT_READY'],
        ['unassigned executor', (f) => { f.evidence.results[0].executor.agentId = id(); }, 'AGENT_MISMATCH'],
        ['reviewer is an executor', (f) => { f.assignments.reviewer.agentId = f.assignments.executors[0].agentId; }, 'DUPLICATE_ID'],
        ['reviewer shares planner run', (f) => { f.assignments.reviewer.runId = f.assignments.planner.runId; }, 'DUPLICATE_ID'],
        ['plan not frozen', (f) => { f.plan.frozen = false; }, 'PLAN_NOT_FROZEN'],
        ['unknown assertion', (f) => { f.evidence.results[0].assertionId = id(); }, 'UNKNOWN_ID'],
        ['duplicate assertion result', (f) => { f.evidence.results.push({...f.evidence.results[0]}); }, 'DUPLICATE_ID'],
        ['missing assertion result', (f) => { f.evidence.results.pop(); }, 'MISSING_ID'],
        ['unknown check', (f) => { f.evidence.results[0].checks[0].id = id(); }, 'UNKNOWN_ID'],
        ['duplicated check', (f) => { f.evidence.results[0].checks.push({...f.evidence.results[0].checks[0]}); }, 'DUPLICATE_ID'],
        ['omitted observed value', (f) => { delete f.evidence.results[1].checks[0].value; }, 'MISSING_FIELD'],
        ['API undefined coerced to false', (f) => { delete f.api.body.settings.enabled; }, 'MISSING_API_VALUE'],
        ['API null coerced to false', (f) => { f.api.body.settings.enabled = null; }, 'VALUE_TYPE_MISMATCH'],
        ['API string coerced to boolean', (f) => { f.api.body.settings.enabled = 'false'; }, 'VALUE_TYPE_MISMATCH'],
        ['API observation contradicts raw bytes', (f) => { f.api.body.settings.enabled = true; }, 'CONTRADICTORY_EVIDENCE'],
        ['unexpected HTTP response', (f) => { f.api.status = 403; }, 'API_STATUS_MISMATCH'],
        ['missing HTTP status', (f) => { delete f.api.status; }, 'MISSING_FIELD'],
        ['string HTTP status', (f) => { f.api.status = '200'; }, 'HTTP_STATUS_REQUIRED'],
        ['missing planned HTTP status', (f) => { delete f.plan.assertions[1].checks[0].expectedHttpStatus; }, 'MISSING_FIELD'],
        ['missing raw JSON pointer', (f) => { delete f.evidence.results[1].checks[0].jsonPointer; }, 'MISSING_FIELD'],
        ['invalid radio selection called PASS', (f) => { f.evidence.results[0].checks[0].value = 'invalid-radio-value'; }, 'UNSUPPORTED_STATUS'],
        ['invented product failure', (f) => { f.evidence.results[0].status = 'FAIL'; }, 'UNSUPPORTED_STATUS'],
        ['rejected reviewer audit', (f) => { f.review.audit = 'REJECTED'; }, 'REVIEW_NOT_ACCEPTED'],
        ['incomplete reviewer audit', (f) => { f.review.audit = 'INCOMPLETE'; }, 'REVIEW_NOT_ACCEPTED'],
        ['custom reviewer audit enum', (f) => { f.review.audit = 'ACCEPTED_WITH_WARNINGS'; }, 'INVALID_ENUM'],
        ['shortened reviewer scope', (f) => { delete f.review.scope.screenshots; }, 'MISSING_FIELD'],
        ['missing reviewed assertion', (f) => { f.review.assertions.pop(); }, 'MISSING_ID'],
        ['unknown reviewed check', (f) => { f.review.assertions[0].checkIds[0] = id(); }, 'UNKNOWN_ID'],
        ['rejected assertion review', (f) => { f.review.assertions[0].audit = 'REJECTED'; }, 'REVIEW_NOT_ACCEPTED'],
        ['custom reviewer contract hash', (f) => { f.review.reviewerContractSha256 = digest('short contract'); }, 'REVIEW_CONTRACT_MISMATCH'],
        ['shortened invoked reviewer prompt', (f) => { f.invocation.prompt = 'Review just the happy path'; }, 'SHORTENED_REVIEW_CONTRACT'],
        ['wrong receipt actor', (f) => { f.receipt.agentId = id(); }, 'AGENT_MISMATCH'],
        ['receipt not completed', (f) => { f.receipt.status = 'running'; }, 'REVIEW_NOT_COMPLETED'],
        ['scenario omits assertion', (f) => { f.plan.scenarios.pop(); }, 'MISSING_ID'],
        ['scenario links assertion twice', (f) => { f.plan.scenarios.push({...f.plan.scenarios[0], id: id()}); }, 'DUPLICATE_ID'],
        ['scenario executor disagrees', (f) => { f.plan.scenarios[0].executorKey = f.assignments.executors[1].key; }, 'EXECUTOR_MISMATCH'],
    ];
    for (const [name, mutate, code] of cases) {
        it(`blocks ${name}`, async (t) => {
            const f = fixture(t); mutate(f); f.save(); await blocked(f, code);
        });
    }

    it('reports supported product failure only with valid evidence and accepted review', async (t) => {
        const f = fixture(t);
        f.evidence.results[0].checks[0].value = 'invalid-radio-value';
        f.evidence.results[0].status = 'FAIL'; f.save();
        const output = await result(f);
        assert.equal(output.valid, true);
        assert.equal(output.verdict, 'FAIL');
        assert.equal(output.audit, 'ACCEPTED');
        assert.deepEqual(output.failures, [{assertionId: f.uiId, checkId: f.uiCheckId}]);
        f.review.audit = 'INCOMPLETE'; f.save();
        await blocked(f, 'REVIEW_NOT_ACCEPTED');
    });

    it('rejects whitespace-only byte changes in a frozen plan', async (t) => {
        const f = fixture(t);
        writeFileSync(join(f.dir, 'plan.json'), readFileSync(join(f.dir, 'plan.json'), 'utf8') + '\n');
        await blocked(f, 'HASH_MISMATCH');
    });
    it('blocks missing and hash-mismatched evidence files', async (t) => {
        const f = fixture(t);
        rmSync(join(f.dir, 'view.png')); await blocked(f, 'FILE_UNAVAILABLE');
        f.save(); writeFileSync(join(f.dir, 'api.json'), '{}'); await blocked(f, 'HASH_MISMATCH');
    });
    it('blocks missing review rather than treating it as acceptance', async (t) => {
        const f = fixture(t);
        rmSync(join(f.dir, 'review.json')); await blocked(f, 'FILE_UNAVAILABLE');
    });
    it('blocks a stale review binding even when its own file digest is current', async (t) => {
        const f = fixture(t);
        rehashJson(f, f.bundle.review, (review) => { review.evidenceSha256 = digest('older manifest'); });
        await blocked(f, 'REVIEW_HASH_MISMATCH');
    });
    it('blocks a different plan version despite recomputed file digests', async (t) => {
        const f = fixture(t);
        rehashJson(f, f.bundle.plan, (plan) => { plan.version += 1; });
        await blocked(f, 'PLAN_MISMATCH');
    });
    it('checks native dispatched prompt bytes and raw receipt existence', async (t) => {
        const f = fixture(t);
        writeFileSync(join(f.dir, 'dispatched-prompt.txt'), 'shortened'); await blocked(f, 'HASH_MISMATCH');
        f.save(); rmSync(join(f.dir, 'native-receipt.json')); await blocked(f, 'FILE_UNAVAILABLE');
    });
    it('handles malformed input and emits machine JSON with nonzero CLI exit', async (t) => {
        const f = fixture(t);
        const invoke = (...args) => spawnSync(process.execPath, [script, ...args], {encoding: 'utf8', cwd: tmpdir()});
        const pass = invoke('validate', '--bundle', f.bundlePath);
        assert.equal(pass.status, 0, pass.stdout + pass.stderr);
        assert.equal(JSON.parse(pass.stdout).verdict, 'PASS');
        f.evidence.results[0].readiness.screenshotLoadingVisible = true; f.save();
        const blocked = invoke('validate', '--bundle', f.bundlePath);
        assert.equal(blocked.status, 1);
        assert.equal(JSON.parse(blocked.stdout).verdict, 'BLOCKED');
        writeFileSync(f.bundlePath, '{broken');
        assert.equal(JSON.parse(invoke('validate', '--bundle', f.bundlePath).stdout).errors[0].code, 'INVALID_JSON');
        assert.equal(JSON.parse(invoke('validate').stdout).errors[0].code, 'USAGE');
    });
});

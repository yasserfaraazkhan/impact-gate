#!/usr/bin/env node
// Deterministic, local invariant verification. Agents still perform semantic QA.
import {createHash} from 'node:crypto';
import {readFileSync, statSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const LIMITATIONS = Object.freeze([
    'Hashes bind the supplied files to each other; no external immutable trust anchor or authenticated agent/run provenance is verified.',
    'The gate does not launch agents, inspect screenshot pixels, certify observations as real, or replace semantic testing and independent review.',
]);
const AUDITS = ['ACCEPTED', 'REJECTED', 'INCOMPLETE'];
const TYPES = ['boolean', 'string', 'number'];
const UI_READINESS = {domReady: true, targetVisible: true, loadingVisible: false};
const SCREENSHOT_READINESS = {screenshotInspected: true, screenshotTargetVisible: true, screenshotLoadingVisible: false};

class GateError extends Error {
    constructor(code, path, message, audit = 'REJECTED') {
        super(message);
        Object.assign(this, {code, path, audit});
    }
}
function requireThat(condition, code, path, message, audit) {
    if (!condition) throw new GateError(code, path, message, audit);
}
function object(value, keys, path, optional = []) {
    requireThat(value !== null && typeof value === 'object' && !Array.isArray(value),
        'OBJECT_REQUIRED', path, 'Expected an object');
    for (const key of keys) requireThat(Object.hasOwn(value, key), 'MISSING_FIELD', `${path}.${key}`,
        'Required field is absent', 'INCOMPLETE');
    for (const key of Object.keys(value)) requireThat(keys.includes(key) || optional.includes(key),
        'UNKNOWN_FIELD', `${path}.${key}`, 'Field is not in the frozen contract');
}
function string(value, path) {
    requireThat(typeof value === 'string' && value.trim().length > 0 && value === value.trim(),
        'STRING_REQUIRED', path, 'Expected a nonempty string without surrounding whitespace');
}
function array(value, path, nonempty = true) {
    requireThat(Array.isArray(value) && (!nonempty || value.length > 0), 'ARRAY_REQUIRED', path,
        nonempty ? 'Expected a nonempty array' : 'Expected an array');
}
function oneOf(value, values, path) {
    requireThat(values.includes(value), 'INVALID_ENUM', path, `Expected one of ${values.join(', ')}`);
}
function equals(actual, expected, path, code = 'MISMATCH') {
    requireThat(actual === expected, code, path, 'Observed value does not match the frozen requirement');
}
function sha(value, path) {
    requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
        'SHA256_REQUIRED', path, 'Expected a lowercase SHA256 digest of exact file bytes');
}
function version(value, path) {
    requireThat(Number.isSafeInteger(value) && value > 0, 'VERSION_REQUIRED', path, 'Expected a positive integer');
}
function identity(value, path) {
    object(value, ['agentId', 'runId'], path);
    string(value.agentId, `${path}.agentId`);
    string(value.runId, `${path}.runId`);
}
function sameIdentity(actual, expected, path) {
    identity(actual, path);
    equals(actual.agentId, expected.agentId, `${path}.agentId`, 'AGENT_MISMATCH');
    equals(actual.runId, expected.runId, `${path}.runId`, 'RUN_MISMATCH');
}
function release(value, path, expected) {
    object(value, ['releaseId', 'buildId'], path);
    string(value.releaseId, `${path}.releaseId`);
    string(value.buildId, `${path}.buildId`);
    if (expected) {
        equals(value.releaseId, expected.releaseId, `${path}.releaseId`, 'RELEASE_MISMATCH');
        equals(value.buildId, expected.buildId, `${path}.buildId`, 'BUILD_MISMATCH');
    }
}
function typed(value, type, path) {
    requireThat(typeof value === type && (type !== 'number' || Number.isFinite(value)),
        'VALUE_TYPE_MISMATCH', path, `Expected an explicit ${type}; missing and null values are not observations`);
}
function unique(items, getId, path) {
    array(items, path);
    const map = new Map();
    for (const item of items) {
        const id = getId(item);
        string(id, `${path}.id`);
        requireThat(!map.has(id), 'DUPLICATE_ID', path, `Duplicate ID: ${id}`);
        map.set(id, item);
    }
    return map;
}
function exactIds(actual, expected, path) {
    for (const id of actual.keys()) requireThat(expected.has(id), 'UNKNOWN_ID', path, `Unknown ID: ${id}`);
    for (const id of expected.keys()) requireThat(actual.has(id), 'MISSING_ID', path,
        `Missing required ID: ${id}`, 'INCOMPLETE');
}
function bytes(path, at) {
    try {
        requireThat(statSync(path).isFile(), 'FILE_REQUIRED', at, 'Evidence reference is not a regular file');
        return readFileSync(path);
    } catch (error) {
        if (error instanceof GateError) throw error;
        throw new GateError('FILE_UNAVAILABLE', at, 'Referenced file cannot be read', 'INCOMPLETE');
    }
}
function json(data, at) {
    try { return JSON.parse(data.toString('utf8')); } catch {
        throw new GateError('INVALID_JSON', at, 'Referenced file is not valid JSON');
    }
}
function readRef(ref, baseDir, at) {
    string(ref.path, `${at}.path`);
    sha(ref.sha256, `${at}.sha256`);
    const data = bytes(resolve(baseDir, ref.path), at);
    equals(createHash('sha256').update(data).digest('hex'), ref.sha256, `${at}.sha256`, 'HASH_MISMATCH');
    return data;
}
function planBinding(value, expected, at) {
    object(value, ['id', 'version', 'sha256'], at);
    equals(value.id, expected.id, `${at}.id`, 'PLAN_MISMATCH');
    equals(value.version, expected.version, `${at}.version`, 'PLAN_MISMATCH');
    equals(value.sha256, expected.sha256, `${at}.sha256`, 'PLAN_MISMATCH');
}
function envelope(value, keys, runId, at) {
    object(value, ['schemaVersion', 'runId', ...keys], at);
    equals(value.schemaVersion, 1, `${at}.schemaVersion`, 'SCHEMA_VERSION');
    equals(value.runId, runId, `${at}.runId`, 'RUN_MISMATCH');
}
// RFC 6901 traversal uses own properties only. Absence never becomes false/null.
function pointer(document, value, at) {
    requireThat(typeof value === 'string' && (value === '' || value.startsWith('/')) && !/~(?:[^01]|$)/.test(value),
        'INVALID_POINTER', at, 'Expected an RFC 6901 JSON pointer');
    let current = document;
    for (const token of value === '' ? [] : value.slice(1).split('/')) {
        const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
        requireThat(current !== null && typeof current === 'object' && Object.hasOwn(current, key) &&
            (!Array.isArray(current) || /^(0|[1-9]\d*)$/.test(key)),
        'MISSING_API_VALUE', at, 'Raw JSON field is absent; coercion cannot satisfy a check', 'INCOMPLETE');
        current = current[key];
    }
    return current;
}
function accepted(audit, at) {
    oneOf(audit, AUDITS, at);
    requireThat(audit === 'ACCEPTED', 'REVIEW_NOT_ACCEPTED', at, `Review is ${audit}`, audit);
}

// Controller envelopes may carry other controller-owned metadata. Verify the
// binding fields, without treating a locally supplied receipt as authentication.
function controllerObject(value, keys, at) {
    object(value, keys, at, value && typeof value === 'object' ? Object.keys(value) : []);
}
function provenance(bundle, plan, assignments, baseDir) {
    const refs = bundle.provenance;
    object(refs, ['reviewerContract', 'reviewerInvocation', 'reviewerReceipt'], 'bundle.provenance');
    for (const [key, ref] of Object.entries(refs)) object(ref, ['path', 'sha256'], `bundle.provenance.${key}`);
    const contract = readRef(refs.reviewerContract, baseDir, 'bundle.provenance.reviewerContract');
    requireThat(contract.length > 0, 'EMPTY_CONTRACT', 'bundle.provenance.reviewerContract', 'Reviewer contract is empty');
    equals(refs.reviewerContract.sha256, plan.reviewerContractSha256, 'plan.reviewerContractSha256', 'REVIEW_CONTRACT_MISMATCH');
    const invocation = json(readRef(refs.reviewerInvocation, baseDir, 'bundle.provenance.reviewerInvocation'), 'reviewerInvocation');
    controllerObject(invocation, ['schemaVersion', 'runId', 'jobId', 'role', 'reviewerContractSha256', 'contractRef', 'prompt', 'promptSha256', 'prerequisites'], 'reviewerInvocation');
    equals(invocation.schemaVersion, 1, 'reviewerInvocation.schemaVersion', 'SCHEMA_VERSION');
    equals(invocation.runId, bundle.runId, 'reviewerInvocation.runId', 'RUN_MISMATCH');
    string(invocation.jobId, 'reviewerInvocation.jobId');
    equals(invocation.role, 'reviewer', 'reviewerInvocation.role', 'ROLE_MISMATCH');
    equals(invocation.reviewerContractSha256, plan.reviewerContractSha256, 'reviewerInvocation.reviewerContractSha256', 'REVIEW_CONTRACT_MISMATCH');
    object(invocation.contractRef, ['path', 'sha256'], 'reviewerInvocation.contractRef');
    readRef(invocation.contractRef, baseDir, 'reviewerInvocation.contractRef');
    equals(invocation.contractRef.sha256, plan.reviewerContractSha256, 'reviewerInvocation.contractRef.sha256', 'REVIEW_CONTRACT_MISMATCH');
    requireThat(typeof invocation.prompt === 'string' && invocation.prompt.length > 0,
        'STRING_REQUIRED', 'reviewerInvocation.prompt', 'Expected the exact nonempty dispatched prompt text');
    requireThat(invocation.prompt.startsWith(`${contract.toString('utf8')}\n\n---\n`), 'SHORTENED_REVIEW_CONTRACT',
        'reviewerInvocation.prompt', 'Reviewer prompt must begin with the exact pinned contract bytes and controller separator');
    sha(invocation.promptSha256, 'reviewerInvocation.promptSha256');
    equals(createHash('sha256').update(invocation.prompt, 'utf8').digest('hex'), invocation.promptSha256,
        'reviewerInvocation.promptSha256', 'PROMPT_HASH_MISMATCH');
    array(invocation.prerequisites, 'reviewerInvocation.prerequisites');
    for (const [key, ref] of [['plan', bundle.plan], ['evidence-manifest', bundle.evidence]]) {
        const matches = invocation.prerequisites.flatMap((entry) => entry?.artifacts?.[key] ? [entry.artifacts[key]] : []);
        requireThat(matches.length === 1, 'REVIEW_INPUT_MISSING', `reviewerInvocation.prerequisites.${key}`,
            'Reviewer must receive exactly one copy of each frozen gate input', 'INCOMPLETE');
        object(matches[0], ['path', 'sha256'], `reviewerInvocation.prerequisites.${key}`);
        readRef(matches[0], baseDir, `reviewerInvocation.prerequisites.${key}`);
        equals(matches[0].sha256, ref.sha256, `reviewerInvocation.prerequisites.${key}.sha256`, 'REVIEW_INPUT_MISMATCH');
    }
    const receipt = json(readRef(refs.reviewerReceipt, baseDir, 'bundle.provenance.reviewerReceipt'), 'reviewerReceipt');
    controllerObject(receipt, ['jobId', 'role', 'provider', 'dispatchTool', 'agentId', 'runId', 'promptSha256', 'status', 'rawReceipt', 'dispatchedPrompt', 'artifacts'], 'reviewerReceipt');
    equals(receipt.jobId, invocation.jobId, 'reviewerReceipt.jobId', 'JOB_MISMATCH');
    equals(receipt.role, 'reviewer', 'reviewerReceipt.role', 'ROLE_MISMATCH');
    string(receipt.provider, 'reviewerReceipt.provider');
    string(receipt.dispatchTool, 'reviewerReceipt.dispatchTool');
    sameIdentity({agentId: receipt.agentId, runId: receipt.runId}, assignments.reviewer, 'reviewerReceipt.actor');
    equals(receipt.status, 'completed', 'reviewerReceipt.status', 'REVIEW_NOT_COMPLETED');
    equals(receipt.promptSha256, invocation.promptSha256, 'reviewerReceipt.promptSha256', 'PROMPT_HASH_MISMATCH');
    object(receipt.rawReceipt, ['path', 'sha256'], 'reviewerReceipt.rawReceipt');
    requireThat(readRef(receipt.rawReceipt, baseDir, 'reviewerReceipt.rawReceipt').length > 0,
        'EMPTY_RECEIPT', 'reviewerReceipt.rawReceipt', 'Native receipt capture is empty', 'INCOMPLETE');
    object(receipt.dispatchedPrompt, ['path', 'sha256'], 'reviewerReceipt.dispatchedPrompt');
    const dispatched = readRef(receipt.dispatchedPrompt, baseDir, 'reviewerReceipt.dispatchedPrompt');
    equals(receipt.dispatchedPrompt.sha256, invocation.promptSha256, 'reviewerReceipt.dispatchedPrompt.sha256', 'PROMPT_HASH_MISMATCH');
    equals(dispatched.toString('utf8'), invocation.prompt, 'reviewerReceipt.dispatchedPrompt', 'PROMPT_MISMATCH');
    controllerObject(receipt.artifacts, ['review'], 'reviewerReceipt.artifacts');
    object(receipt.artifacts.review, ['path', 'sha256'], 'reviewerReceipt.artifacts.review');
    readRef(receipt.artifacts.review, baseDir, 'reviewerReceipt.artifacts.review');
    equals(receipt.artifacts.review.sha256, bundle.review.sha256, 'reviewerReceipt.artifacts.review.sha256', 'REVIEW_OUTPUT_MISMATCH');
}

function verify(bundle, baseDir) {
    object(bundle, ['schemaVersion', 'runId', 'plan', 'assignments', 'evidence', 'review', 'provenance'], 'bundle');
    equals(bundle.schemaVersion, 1, 'bundle.schemaVersion', 'SCHEMA_VERSION');
    string(bundle.runId, 'bundle.runId');
    object(bundle.plan, ['id', 'version', 'path', 'sha256'], 'bundle.plan');
    string(bundle.plan.id, 'bundle.plan.id');
    version(bundle.plan.version, 'bundle.plan.version');
    object(bundle.assignments, ['path', 'sha256'], 'bundle.assignments');
    object(bundle.evidence, ['path', 'sha256'], 'bundle.evidence');
    object(bundle.review, ['path', 'sha256'], 'bundle.review');
    const plan = json(readRef(bundle.plan, baseDir, 'bundle.plan'), 'plan');
    envelope(plan, ['id', 'version', 'frozen', 'reviewerContractSha256', 'release', 'scenarios', 'assertions'], bundle.runId, 'plan');
    equals(plan.id, bundle.plan.id, 'plan.id', 'PLAN_MISMATCH');
    equals(plan.version, bundle.plan.version, 'plan.version', 'PLAN_MISMATCH');
    equals(plan.frozen, true, 'plan.frozen', 'PLAN_NOT_FROZEN');
    sha(plan.reviewerContractSha256, 'plan.reviewerContractSha256');
    release(plan.release, 'plan.release');
    const assignmentManifest = json(readRef(bundle.assignments, baseDir, 'bundle.assignments'), 'assignments');
    object(assignmentManifest, ['orchestrator', 'planner', 'environment', 'executors', 'reviewer'], 'assignments');
    array(assignmentManifest.executors, 'assignments.executors');
    for (const role of ['orchestrator', 'planner', 'environment', 'reviewer']) identity(assignmentManifest[role], `assignments.${role}`);
    for (const executor of assignmentManifest.executors) {
        object(executor, ['key', 'agentId', 'runId'], 'assignments.executors');
        string(executor.key, 'assignments.executors.key');
        string(executor.agentId, 'assignments.executors.agentId');
        string(executor.runId, 'assignments.executors.runId');
    }
    const assignments = [assignmentManifest.orchestrator, assignmentManifest.planner, assignmentManifest.environment,
        ...assignmentManifest.executors, assignmentManifest.reviewer];
    unique(assignments, (item) => item.agentId, 'assignments.agentIds');
    unique(assignments, (item) => item.runId, 'assignments.runIds');
    const executors = unique(assignmentManifest.executors, (item) => item.key, 'assignments.executors');
    const assertions = unique(plan.assertions, (item) => item?.id, 'plan.assertions');
    const requirements = new Map();
    for (const [id, assertion] of assertions) {
        const at = `plan.assertions[${id}]`;
        object(assertion, ['id', 'executorKey', 'role', 'screenshotRequired', 'checks'], at);
        string(assertion.executorKey, `${at}.executorKey`);
        requireThat(executors.has(assertion.executorKey), 'UNASSIGNED_EXECUTOR', at, 'Logical executor is not present in the assignments manifest');
        typed(assertion.screenshotRequired, 'boolean', `${at}.screenshotRequired`);
        string(assertion.role, `${at}.role`);
        const checks = unique(assertion.checks, (item) => item?.id, `${at}.checks`);
        for (const [checkId, check] of checks) {
            object(check, ['id', 'kind', 'type', 'expected', ...(check.kind === 'api' ? ['expectedHttpStatus'] : [])], `${at}.checks[${checkId}]`);
            oneOf(check.kind, ['api', 'ui'], `${at}.checks[${checkId}].kind`);
            oneOf(check.type, TYPES, `${at}.checks[${checkId}].type`);
            typed(check.expected, check.type, `${at}.checks[${checkId}].expected`);
            if (check.kind === 'api') requireThat(Number.isInteger(check.expectedHttpStatus) && check.expectedHttpStatus >= 100 && check.expectedHttpStatus <= 599,
                'HTTP_STATUS_REQUIRED', `${at}.checks[${checkId}].expectedHttpStatus`, 'Expected an explicit integer HTTP status from 100 through 599');
        }
        requirements.set(id, checks);
    }
    const scenarios = unique(plan.scenarios, (item) => item?.id, 'plan.scenarios');
    const linkedAssertions = new Map();
    for (const [id, scenario] of scenarios) {
        const at = `plan.scenarios[${id}]`;
        object(scenario, ['id', 'executorKey', 'requiredAssertions'], at);
        string(scenario.executorKey, `${at}.executorKey`);
        requireThat(executors.has(scenario.executorKey), 'UNASSIGNED_EXECUTOR', at, 'Scenario executor is not assigned');
        const links = unique(scenario.requiredAssertions, (item) => item, `${at}.requiredAssertions`);
        for (const assertionId of links.keys()) {
            requireThat(assertions.has(assertionId), 'UNKNOWN_ID', at, `Unknown assertion ID: ${assertionId}`);
            requireThat(!linkedAssertions.has(assertionId), 'DUPLICATE_ID', at, `Assertion is linked more than once: ${assertionId}`);
            equals(scenario.executorKey, assertions.get(assertionId).executorKey, `${at}.executorKey`, 'EXECUTOR_MISMATCH');
            linkedAssertions.set(assertionId, scenario);
        }
    }
    exactIds(linkedAssertions, assertions, 'plan.scenarios');

    const evidence = json(readRef(bundle.evidence, baseDir, 'bundle.evidence'), 'evidence');
    envelope(evidence, ['plan', 'environment', 'artifacts', 'results'], bundle.runId, 'evidence');
    planBinding(evidence.plan, bundle.plan, 'evidence.plan');
    const artifacts = unique(evidence.artifacts, (item) => item?.id, 'evidence.artifacts');
    const artifactBytes = new Map();
    for (const [id, artifact] of artifacts) {
        object(artifact, ['id', 'path', 'sha256', 'kind'], `evidence.artifacts[${id}]`);
        oneOf(artifact.kind, ['screenshot', 'json', 'text'], `evidence.artifacts[${id}].kind`);
        artifactBytes.set(id, readRef(artifact, baseDir, `evidence.artifacts[${id}]`));
    }
    function artifact(id, at) {
        string(id, at);
        requireThat(artifacts.has(id), 'UNKNOWN_ARTIFACT', at, 'Evidence artifact is not in the hashed manifest');
        return artifacts.get(id);
    }
    object(evidence.environment, ['worker', 'ready', 'release', 'evidenceIds'], 'evidence.environment');
    sameIdentity(evidence.environment.worker, assignmentManifest.environment, 'evidence.environment.worker');
    equals(evidence.environment.ready, true, 'evidence.environment.ready', 'ENVIRONMENT_NOT_READY');
    release(evidence.environment.release, 'evidence.environment.release', plan.release);
    const environmentRefs = unique(evidence.environment.evidenceIds, (item) => item, 'evidence.environment.evidenceIds');
    for (const id of environmentRefs.keys()) artifact(id, 'evidence.environment.evidenceIds');
    const results = unique(evidence.results, (item) => item?.assertionId, 'evidence.results');
    exactIds(results, assertions, 'evidence.results');
    const failures = [];
    for (const [id, result] of results) {
        const at = `evidence.results[${id}]`;
        object(result, ['assertionId', 'executor', 'status', 'role', 'release', 'checks'], at, ['readiness', 'screenshotArtifactId']);
        sameIdentity(result.executor, executors.get(assertions.get(id).executorKey), `${at}.executor`);
        oneOf(result.status, ['PASS', 'FAIL', 'BLOCKED'], `${at}.status`);
        requireThat(result.status !== 'BLOCKED', 'ASSERTION_BLOCKED', `${at}.status`, 'Assertion is BLOCKED', 'INCOMPLETE');
        const hasScreenshot = Object.hasOwn(result, 'screenshotArtifactId');
        requireThat(!assertions.get(id).screenshotRequired || hasScreenshot, 'SCREENSHOT_REQUIRED', at,
            'The frozen plan requires screenshot evidence', 'INCOMPLETE');
        const hasUI = [...requirements.get(id).values()].some((check) => check.kind === 'ui');
        const readiness = {...(hasUI ? UI_READINESS : {}), ...(hasScreenshot ? SCREENSHOT_READINESS : {})};
        if (Object.keys(readiness).length || Object.hasOwn(result, 'readiness')) {
            object(result.readiness, Object.keys(readiness), `${at}.readiness`);
            for (const [key, expected] of Object.entries(readiness)) {
                typed(result.readiness[key], 'boolean', `${at}.readiness.${key}`);
                equals(result.readiness[key], expected, `${at}.readiness.${key}`, 'NOT_READY');
            }
        }
        equals(result.role, assertions.get(id).role, `${at}.role`, 'ROLE_MISMATCH');
        release(result.release, `${at}.release`, plan.release);
        if (hasScreenshot) equals(artifact(result.screenshotArtifactId, `${at}.screenshotArtifactId`).kind, 'screenshot', `${at}.screenshotArtifactId`, 'SCREENSHOT_REQUIRED');
        const checks = unique(result.checks, (item) => item?.id, `${at}.checks`);
        exactIds(checks, requirements.get(id), `${at}.checks`);
        let passed = true;
        for (const [checkId, check] of checks) {
            const checkAt = `${at}.checks[${checkId}]`;
            const required = requirements.get(id).get(checkId);
            object(check, ['id', 'value', 'evidenceId'], checkAt, required.kind === 'api' ? ['jsonPointer'] : []);
            typed(check.value, required.type, `${checkAt}.value`);
            const source = artifact(check.evidenceId, `${checkAt}.evidenceId`);
            if (required.kind === 'api') {
                requireThat(Object.hasOwn(check, 'jsonPointer'), 'MISSING_FIELD', `${checkAt}.jsonPointer`, 'API check requires the raw JSON pointer', 'INCOMPLETE');
                equals(source.kind, 'json', `${checkAt}.evidenceId`, 'JSON_EVIDENCE_REQUIRED');
                const response = json(artifactBytes.get(check.evidenceId), `${checkAt}.evidenceId`);
                controllerObject(response, ['status', 'body'], `${checkAt}.response`);
                requireThat(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599,
                    'HTTP_STATUS_REQUIRED', `${checkAt}.response.status`, 'Raw API response must have an explicit integer HTTP status from 100 through 599');
                equals(response.status, required.expectedHttpStatus, `${checkAt}.response.status`, 'API_STATUS_MISMATCH');
                requireThat(typeof check.jsonPointer === 'string' && (check.jsonPointer === '/body' || check.jsonPointer.startsWith('/body/')),
                    'INVALID_POINTER', `${checkAt}.jsonPointer`, 'API observations must point into the raw response body');
                const raw = pointer(response, check.jsonPointer, `${checkAt}.jsonPointer`);
                typed(raw, required.type, `${checkAt}.rawValue`);
                equals(check.value, raw, `${checkAt}.value`, 'CONTRADICTORY_EVIDENCE');
            }
            if (check.value !== required.expected) {
                passed = false;
                failures.push({assertionId: id, checkId});
            }
        }
        equals(result.status, passed ? 'PASS' : 'FAIL', `${at}.status`, 'UNSUPPORTED_STATUS');
    }

    const review = json(readRef(bundle.review, baseDir, 'bundle.review'), 'review');
    envelope(review, ['reviewer', 'reviewerContractSha256', 'plan', 'evidenceSha256', 'audit', 'scope', 'assertions'], bundle.runId, 'review');
    sameIdentity(review.reviewer, assignmentManifest.reviewer, 'review.reviewer');
    equals(review.reviewerContractSha256, plan.reviewerContractSha256, 'review.reviewerContractSha256', 'REVIEW_CONTRACT_MISMATCH');
    planBinding(review.plan, bundle.plan, 'review.plan');
    equals(review.evidenceSha256, bundle.evidence.sha256, 'review.evidenceSha256', 'REVIEW_HASH_MISMATCH');
    accepted(review.audit, 'review.audit');
    object(review.scope, ['readiness', 'role', 'build', 'screenshots'], 'review.scope');
    for (const key of Object.keys(review.scope)) equals(review.scope[key], true, `review.scope.${key}`, 'REVIEW_SCOPE_INCOMPLETE');
    const reviewed = unique(review.assertions, (item) => item?.assertionId, 'review.assertions');
    exactIds(reviewed, assertions, 'review.assertions');
    for (const [id, entry] of reviewed) {
        const at = `review.assertions[${id}]`;
        object(entry, ['assertionId', 'audit', 'checkIds'], at);
        accepted(entry.audit, `${at}.audit`);
        const checks = unique(entry.checkIds, (item) => item, `${at}.checkIds`);
        exactIds(checks, requirements.get(id), `${at}.checkIds`);
    }
    provenance(bundle, plan, assignmentManifest, baseDir);
    return failures;
}

function verdict(runId, error, failures = []) {
    return {schemaVersion: 1, runId: typeof runId === 'string' ? runId : null, valid: !error,
        verdict: error ? 'BLOCKED' : failures.length ? 'FAIL' : 'PASS', audit: error?.audit ?? 'ACCEPTED', failures,
        errors: error ? [{code: error.code, path: error.path, message: error.message}] : [],
        limitations: [...LIMITATIONS]};
}

/** Paths in every referenced document resolve against the bundle's directory. */
export function validateBundle(bundle, {baseDir = process.cwd()} = {}) {
    try {
        const failures = verify(bundle, baseDir);
        return verdict(bundle.runId, undefined, failures);
    } catch (error) {
        return verdict(bundle?.runId, error instanceof GateError ? error :
            new GateError('VALIDATION_ERROR', 'bundle', 'Invalid bundle could not be validated'));
    }
}

export function validateBundleFile(path) {
    try {
        const absolute = resolve(path);
        return validateBundle(json(bytes(absolute, 'bundle'), 'bundle'), {baseDir: dirname(absolute)});
    } catch (error) {
        return verdict(null, error instanceof GateError ? error : new GateError('VALIDATION_ERROR', 'bundle', 'Invalid bundle path'));
    }
}

export function main(args) {
    const result = args.length === 3 && args[0] === 'validate' && args[1] === '--bundle'
        ? validateBundleFile(args[2])
        : verdict(null, new GateError('USAGE', 'arguments', 'Usage: node scripts/release-qa-swarm-gate.mjs validate --bundle <bundle.json>'));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.verdict === 'PASS' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    process.exitCode = main(process.argv.slice(2));
}

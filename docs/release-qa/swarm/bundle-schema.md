# Swarm handoff and evidence schema (v1)

Use the checked controller/gate source as the final schema authority. Do not invent fields, substitute a narrative for a file, or copy fixture identities from tests. All IDs and expected values below are populated from the real request, release, native tool receipts and observations. Use absolute artifact paths under the private run directory because the controller snapshots top-level outputs.

## Controller bridge

1. `node scripts/release-qa-swarm.mjs init --run-dir DIR --request REQUEST_JSON --orchestrator-id ACTUAL_NATIVE_ID --capabilities CAPABILITIES_JSON`
2. `node scripts/release-qa-swarm.mjs next --run-dir DIR` emits one job envelope.
3. Dispatch its `prompt` bytes through the discovered Cursor-native tool and save the actual prompt/receipt. If asynchronous, record the start, then wait for actual completion.
4. `node scripts/release-qa-swarm.mjs record --run-dir DIR --job-id JOB_ID --receipt RECEIPT_JSON`
5. Repeat `next`; after all roles it assembles the bundle from recorded snapshots and invokes the gate. `status` shows actual assignments and handoff states. GATED is not synonymous with PASS; inspect `gate.verdict`, `gate.audit` and errors.

Capabilities: `provider: "cursor-native"`, observed `dispatchTool`, observed `waitTool` (or null for synchronous dispatch), `freshContext: true`, `synchronous: boolean`, `rawEvidencePath` to the captured tool inventory/schema. Do not invent tool names. Controller correlation `runId` is not a native child ID.

Receipt: `provider`, `dispatchTool`, actual `agentId`, optional actual `runId` (defaults to the returned child ID), exact `promptSha256`, `rawReceiptPath`, `dispatchPromptPath`, `status` (running/completed/failed), `artifacts` and optional `reason`. The captured raw native receipt must contain the returned identity. Never manufacture a tool transcript. The completion must retain the same actor as the start. Completed artifact-map keys are:

| Role | Required output keys (values are file paths) |
| --- | --- |
| planner | resolved-release, changes, coverage, plan, plan-hash, ci-evidence |
| environment | environment |
| executor | results, bugs, attempts, evidence-manifest, execution-source |
| reviewer | review, report |

## Frozen plan

Exact top-level fields: `schemaVersion: 1`, controller `runId`, plan `id`, positive integer `version`, `frozen: true`, supplied `reviewerContractSha256`, `release: {releaseId, buildId}`, `scenarios`, `assertions`.

- Each scenario: `{id, executorKey: "executor", requiredAssertions: [assertion IDs]}`. Every assertion belongs to exactly one scenario. Keep narrative requirements, priorities, procedures and coverage in companion changes/coverage/human-plan files; do not invent extra machine-plan fields.
- Each assertion: `{id, executorKey: "executor", role, screenshotRequired: boolean, checks}`.
- Each check: `{id, kind: "api" | "ui", type: "boolean" | "string" | "number", expected}`. An API check additionally requires `expectedHttpStatus` (the explicitly planned response, including a valid negative-case status). Values must actually have the declared type. Nothing missing/null is coerced into false or zero.
- `releaseId` identifies the resolved release; `buildId` binds the full resolved build manifest (both source hashes, image/platform and relevant configuration identity), not merely its display version. Keep the expanded manifest in resolved-release.
- Write exact plan bytes, then their SHA-256 to plan-hash. Future actual child IDs are not in this plan.

## Executor evidence-manifest

This output is the full structured gate evidence, not just a list of file checksums. Top-level fields: `schemaVersion: 1`, controller `runId`, `plan: {id, version, sha256}`, `environment`, `artifacts`, `results`.

- Artifact: `{id, path, sha256, kind: "screenshot" | "json" | "text"}`. Hash the actual retained file. All referenced files must exist unchanged.
- Environment: `{worker: {agentId, runId}, ready: boolean, release: {releaseId, buildId}, evidenceIds: [artifact IDs]}`. Use the recorded native environment worker identity and actual evidence. Missing readiness blocks qualification.
- Result: `{assertionId, executor: {agentId, runId}, status: "PASS" | "FAIL" | "BLOCKED", role, release: {releaseId, buildId}, checks}` with conditional `readiness` and `screenshotArtifactId`.
- Result check: `{id, value, evidenceId}`. API checks additionally include `jsonPointer` into the raw response's `/body` (e.g. `/body/ServiceSettings/<candidate-derived-key>`). The JSON artifact must retain integer HTTP `status` and `body`; planned status and actual typed field are verified.
- UI readiness fields: `domReady: true`, `targetVisible: true`, `loadingVisible: false`. These are measured observations, not defaults. For absence assertions the visible target is the planned positive-control region/element proving the correct page is loaded, never the control asserted absent.
- When a screenshot is supplied, also record `screenshotInspected: true`, `screenshotTargetVisible: true`, `screenshotLoadingVisible: false`. The target is the relevant context/region, including a fully loaded page for absence assertions. Inspect actual pixels; never infer these values from a filename or caption. Omit screenshot fields only when the plan permits it and no screenshot is supplied. Supplied contradictory optional evidence cannot be ignored.

For a blocked or partially completed run, preserve the actual records and missing data. Do not insert guessed readiness or check values to satisfy the schema; the gate is expected to return BLOCKED. Preserve original attempts and their outcomes in the attempts artifact.

## Reviewer output

Exact top-level fields: `schemaVersion: 1`, controller `runId`, `reviewer: {agentId, runId}`, `reviewerContractSha256`, `plan: {id, version, sha256}`, `evidenceSha256`, `audit: "ACCEPTED" | "REJECTED" | "INCOMPLETE"`, `scope`, `assertions`.

`scope` has boolean fields readiness, role, build, screenshots. True means that scope was actually audited, not that every claim passed; in an API-only scope screenshots can be reviewed as not applicable. Each assertion review is `{assertionId, audit, checkIds}` covering every frozen check exactly once. Put findings, visual contradictions, missing proof, original-versus-audited outcomes and limitations in the companion human report.

Bind review to the exact evidence-manifest bytes supplied in the controller job. Use the reviewer's actual native ID; do not reuse an executor ID. The controller assembles separate assignment and provenance references from its receipts, including the actual reviewer invocation and full pinned contract. Agents must not rewrite those to force acceptance.

## Interpretation

The gate distinguishes unsupported evidence (BLOCKED) from a supported observed mismatch (FAIL) and supported declared scope (PASS). It does not compute whole-release GO. Its limitation text is mandatory: shared-workspace hashes do not authenticate external provenance, and structured evidence is not pixel inspection. The independent reviewer must perform the semantic work.

---
title: "Mattermost Advisory Pilot"
description: "Produce deterministic plans for existing Cypress and Playwright specs while retaining the full suite"
---

Use `plan --advisory` to inventory existing specs and explain conservative selections without an LLM, browser service, test execution, or status writes. The pilot keeps Mattermost's existing full-suite dispatch. A successful report is not a coverage pass or release approval.

## Run from a reviewed source checkout

Pin the Impact Gate checkout to a reviewed immutable commit. The example configuration lives in the source repository at [`examples/mattermost/advisory.config.json`](https://github.com/yasserfaraazkhan/impact-gate/blob/master/examples/mattermost/advisory.config.json); it is not bundled in the npm package. Merging a PR does not publish a new package version.

From that Impact Gate checkout:

```sh
npm ci --ignore-scripts
npm run build

env -i PATH="$PATH" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  node dist/cli.js plan --advisory --json \
  --config examples/mattermost/advisory.config.json \
  --path /path/to/isolated/mattermost \
  --since FULL_BASE_SHA --suite cypress-full-enterprise > plan.json
```

Use a separate, clean Mattermost checkout at the full source HEAD being evaluated. Its origin must match the configured GitHub repository. Repeat with `playwright-full-enterprise`, `cypress-full-fips`, or `playwright-full-fips`. These are separate configured identities; a plan alone does not verify the runtime browser, project or FIPS environment.

`suggest --advisory` and `gate --advisory` produce the same report contract. They require an advisory configuration and `--suite`. Pass flag values separately, such as `--since FULL_BASE_SHA`; `--since=...`, unknown long flags and missing values fail explicitly.

## What the planner verifies

- The complete committed Git diff, including CI, dependency, configuration, test, deleted and renamed paths. Both sides of a rename remain visible.
- The requested base commit, its unique merge base, and HEAD. Invalid refs, unrelated histories and multiple merge bases return errors.
- Every selected spec and suite config is a regular committed file whose bytes match HEAD. Missing files, escaping symlinks, traversal and absolute paths are rejected. Hidden index entries are checked; dirty submodules are not ignored.
- `specPattern` and `exclude` define the static inventory relative to each suite root. Source and cross-cutting patterns are repository-relative. Dot paths are included; leading `!` and `#` patterns are rejected.

The planner reads source and suite configuration as data. It does not evaluate JavaScript configuration, discover runtime test cases, apply Cypress runtime tags, or execute Playwright setup dependencies. Mattermost's existing runner retains those responsibilities. Re-review the configuration when the source layout or dispatch settings change.

## Selection and provenance

Every nonempty diff currently recommends full fallback. The example contains no product-to-spec mappings. Candidate mappings preserve their declared `human-reviewed-manifest`, `static-dependency-inference`, or `co-change-heuristic` provenance, but the pilot has no mechanism to authenticate review evidence. Declaring human review does not enable targeted selection.

Spec presence is not evidence that a test asserts changed behavior. Measured per-test coverage remains unavailable, with zero measured coverage edges. A valid empty diff is labeled `empty` and selects no changed-file candidates; the pilot execution policy still retains the full suite.

Repository origin and configuration hashes identify local inputs. They do not authenticate remote ownership or a reviewer's approval. Obtain both checkouts and the configuration from trusted pinned sources.

## Report contract

The command emits one JSON object on stdout. Progress and diagnostics go to stderr. Failures return nonzero with a JSON error object when `--json` or `--advisory` is present. Check both the exit status and the report content before treating an uploaded file as a valid plan.

| Field | Meaning |
| --- | --- |
| `advisory.repository`, `headSha`, `requestedBaseSha`, `baseSha` | Repository, tested HEAD, requested base and resolved merge base |
| `advisory.changedFiles`, `changedFilesSha256` | Complete changed-file set and fingerprint |
| `advisory.configurationSha256`, `suite.configSha256` | Planner configuration and suite config fingerprints |
| `advisory.suite` | Configured suite, framework, root, project, browser and variant |
| `advisory.inventory`, `selectedSpecs` | Exact repository-relative static spec paths |
| `advisory.fileAssessments`, `mappings`, `fullSuiteFallbackReasons` | Per-file assessment, declared provenance and fallback reasons |
| `confidence`, `confidenceKind` | `null` and `unavailable` |
| `advisory.evidence` | Coverage/execution unavailable, release not assessed, spec presence status |
| `advisory.executionPolicy` | `retain-full-suite` |
| `enforcement.shouldFail` | `false` for a completed advisory report; not a release assertion |

`runId` binds the comparison inputs; `generatedAt` can differ across identical runs. A CI caller can attach the existing `sourceRunId` field to identify repository, run and attempt. The CLI does not populate it from ambient CI variables.

The CLI creates no `.e2e-ai-agents/` reports, metrics, generated tests or GitHub outputs in this mode. Shell redirection is the caller's report write. `--no-ai` on an ordinary `plan` only disables model enrichment and still writes normal artifacts. Likewise, `policy.enforcementMode: "advisory"` alone does not activate this isolated caller.

## Shadow CI and execution evidence

Use an independent, nonblocking job with a pinned planner, an isolated source checkout and no provider/status credentials in the planning process. Build only the trusted planner; never install or run PR code in this job. Upload the JSON and preserve the existing E2E dispatch and statuses. The [Mattermost consumer PR](https://github.com/mattermost/mattermost/pull/38392) is a separate integration change.

TSIO remains the execution source. Compare only matching repository, tested source SHA, CI run and attempt, suite/project and complete expected worker reports. A workflow revision can differ from the tested PR revision. Match each failure by validated file and full title, retaining TSIO's stable key; an external ID alone is insufficient. Exclude retry survivors from final-failure counts.

For historical context, [run 34174643457, attempt 1](https://github.com/mattermost/mattermost/actions/runs/34174643457) uploaded [advisory plans](https://github.com/mattermost/mattermost/actions/runs/34174643457/artifacts/10036861237) with planner `41657f86630a10ad048f0cf544cfdd109a1d3923`. Those artifacts predate the later provenance fixes and are not validation of a newer planner revision. At tested source `5ed5f7d29ae67d6ecf7864022e37c66792280a45`, all 11 CI/E2E changes triggered full fallback: 658 static Cypress specs (447 dispatched) and 291 Playwright specs. The full workflow failed. Cypress had only 39/40 expected worker reports, so validated live recall was unavailable despite selecting both observed final failed specs. Playwright had all 20 reports and no final failures, leaving the recall denominator zero. FIPS was not observed.

Report this measure as **observed failure-selection recall**, never causal regression accuracy. Keep missing-worker evidence unavailable even when a queue completes. Full fallback establishes no time savings. Confirmed missed regressions, unnecessary selection and unnecessary blocking remain separate unknowns until evidence supports them. Keep full execution until an independently reviewed shadow dataset supports an agreed change.

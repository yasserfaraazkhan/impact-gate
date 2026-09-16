# Mattermost recovery implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. The Arbiter approves exact file ownership before implementation; an independent reviewer and Evidence Officer validate each item.

**Goal:** Make Impact Gate produce complete, actionable Mattermost review output and honest test-selection evidence, with generated tests trusted only after an observed mutation failure.

**Architecture:** Repair the existing command, planner, traceability and generation paths. Share one small mutation verifier between existing generation paths; add no orchestrator. Keep uncertain suite selection conservative, while surfacing useful existing tests and scenario recommendations separately from permission to skip tests.

**Tech Stack:** Existing TypeScript, Node test runner, Git and installed Playwright. No new runtime dependencies.

**Spec:** The user's five-item prompt at `/Users/yasserkhan/.codex/attachments/c8e8cf2c-94c1-40dc-a03d-559491ddfaa6/pasted-text.txt`, subsequent takeover instruction, `DECISIONS.md`, and the measured failures in `/private/tmp/impact-gate-pr-validation-2026-09-16/REPORT.md`.

## Global constraints

- Keep W1–W5 ordering and separate implementation/review/evidence roles.
- No runtime dependency, version bump, new top-level source directory or orchestration layer.
- Every behavior claim needs an actual command/output; observed failures precede fixes.
- Keep the fixed 30-PR sample and exact head/base/CI identities; unknown evidence is not a pass.
- Never mutate the saved Mattermost checkout or overwrite prior artifacts.
- Three distinct failed approaches to one leaf trigger an explicit stop/ruling, not endless retries.
- No live-model or full-Mattermost execution claim from a fixture. Real local Playwright execution remains mandatory for W1.

## Task 1: W1 generated-test verification

**Files:** Exact fourteen-file approval (including caller and independent-review amendments) in `DECISIONS.md`; agent owns those files only. The caller passes repository root and selected base separately from test output root. The new internal verifier is created before callers use it and is not a new public API.

**Consumes:** Existing `runAgenticGeneration`, `ScenarioInput`, `AgenticConfig`, `runPlaywrightSpec`, stage-3 `GeneratedSpec`, crew `appPath`/`gitSince`, Git changed-file identity.

**Produces:** Explicit verified/unverified mutation evidence in existing generation results and summary artifacts. `passed`/`verified` requires positive clean execution plus an assertion failure on an applicable changed-line mutant. Crew executes its already-written artifact instead of asking the provider to overwrite it.

- [x] Add failing regression cases to the existing runner/report tests before production edits. Exercise an actual temporary Git repo and real Playwright runner, not a runner stub.
- [x] Use a changed `eligible` function and these generated-spec bodies as the minimum acceptance controls:

```typescript
import {test, expect} from '@playwright/test';
import {eligible} from '../../../../eligibility';
test('accepts the changed boundary', () => {
    expect(eligible(18)).toBe(true);
    expect(eligible(17)).toBe(false);
});
```

```typescript
import {test} from '@playwright/test';
test('assertion-free control', async () => {});
```

  The fixture's actual path layout must make the import real. Provider responses are fixture data; no execution result is stubbed. Record the pre-fix failure.
- [x] Implement only the three approved operators over full changed-line hunks. Reject out-of-root, symlink/unsafe, binary, test-only, or unsupported mutation targets. Preserve original bytes and restore in `finally`; do not overwrite a concurrently changed file. Prefer a disposable source workspace when the runner can execute it correctly; never report a mutation of a file the application did not load as verified.
- [x] Tighten Playwright result parsing: positive executed tests for baseline; actual terminal assertion failure for a kill. Do not use `spec.ok`, process exit alone, empty/skipped/flaky reports, load/compile failures or timeouts as proof.
- [x] Wire the same verifier into the actual review generator and stage 3. Remove compile-only success. Keep unverified files/results explicitly marked and outside ordinary trusted discovery; preserve preexisting test files when verification fails.
- [x] Test good clean pass, mutant assertion failure, restored pass; bad clean pass and mutant pass => unverified. Cover missing base/source, no candidate, zero/skipped tests, and process/compile failure.
- [x] Independent adversarial review addresses source restoration, error paths, evidence authenticity, and all callers. Evidence Officer runs acceptance and records `gates/w1.txt`; Simplifier reports duplication removed; Arbiter closes W1 only after those checks.

## Task 2: W2 reliable reports and fixed empirical replay

Implement only after W1's gate exists. Repair the measured output/input defects before treating machine-readable reports as baseline recommendations. Exact approval will name the reporter files, tests and at most three measurement files under `scripts/`.

- [x] Make review stdout one JSON object on success, empty diff, invalid ref, threshold failure and comment-write failure. Progress goes to stderr. Invalid Git input fails; review does not add its own prediction artifact to future diffs.
- [x] Preserve computed behavior, scenario recommendations, matched test paths and PR test details in both JSON and Markdown.
- [x] Resolve repository-relative PR tests from the repository root; keep manifest inventory under its separate test root. Resolve auto-detected test roots against `--path`, while preserving portable init config and explicit path semantics.
- [x] Replace unsupported coverage wording with actual covered/partial/uncovered facts. Do not change selection policy in these repairs.
- [x] Promote the existing fixed replay into a reproducible script and exact pinned sample/evidence inputs, within the three-file script budget. Record both named-list and effective full-suite selection outcomes; never equate them.
- [x] Re-run all 30 PRs against the repaired baseline. Record table, exact commands, and observed escaped-failure fraction with its denominator/limitations in `gates/w2.txt`. One failure cannot establish general accuracy. Keep unknown CI observations separate.

## Task 3: W3 evidence precedence and useful mapping

Do not start until W2 is recorded. Existing source has separate ordinary/advisory paths; no change may pretend they share evidence automatically.

- [x] Prefer valid per-path traceability candidates over scanner guesses, preserving declared/unverified origin. Existing inputs lack tested revision/suite provenance, so measured coverage remains unavailable; do not add an instrumentation framework. Preserve the complete diff and full fallback for new unverified associations and unknown changes, while retaining existing explicit-manifest policy.
- [x] Reject stale/invalid/future dates, missing or escaping tests and wrong-inventory paths from candidate eligibility. Unsupported revision/suite claims never become measured coverage or permission to omit tests.
- [x] Exercise declared/scanner conflicts and forged measured claims in real local tests. Replace empty runtime cold-start associations with narrow inventory-based candidates; validate scanner/monorepo path semantics on real Mattermost source.
- [x] Re-run the unchanged W2 harness and report before/after. No fabricated source edges from TSIO statuses. If real Mattermost measured edges are unavailable, report that limitation and do not claim measured selection improved.
- [x] Arbiter accepts or reverts based on evidence; `gates/w3.txt` records the honest result, including no improvement.

## Task 4: W4 reduce the product surface

- [x] Simplifier traces callers for all four orchestrators and public command/export dependencies.
- [x] Delete proven-dead/duplicate code, retain reachable public interfaces where removal would be a breaking guess, and identify experimental commands.
- [x] Collapse README to supported review/gate behavior and experimental functionality. Item diff must reduce net lines and preserve review/gate behavior.
- [x] Evidence Officer records negative net diff, full test suite, and real-repository review/gate runs in `gates/w4.txt`.

## Task 5: W5 current evidence and delivery

- [ ] Create a current dogfood folder matching the existing shape, with exact tested revisions, commands and raw outputs; include W2/W3 numbers and regressions.
- [ ] Run full build, tests and lint after all integration; independent whole-branch review addresses remaining findings.
- [ ] Record `gates/w5.txt` and the limits of what was actually executed. Publish no package/version and change no Mattermost full-suite execution policy as a side effect of dispatching agents.

## Ownership and conflict scan

| Tasks/interfaces | Conflict | Resolution |
|---|---|---|
| W1 and W2: review.ts | W1 adds verification context; W2 changes output handling | Execute serially, review each gate. |
| W2 and W3: report/plan fields | Reporting must retain later mapping provenance | W2 preserves existing fields, W3 adds only evidenced provenance. |
| W2 and W3: fixed replay | Changing method would invalidate comparison | Freeze sample, normalization and failure eligibility at W2. |
| W1/W3 and W4: reachable code | Deletion could remove validated paths | W4 traces final callers and reruns whole suite. |
| W5 and all earlier items | Final docs can overstate fixture evidence | Separate local real execution, recorded CI, and not-run claims. |
| W1 internal consistency | Mutation/load failure could look like detection | Require structured executed baseline and terminal assertion failure; restoration check. |
| W2 internal consistency | Empty recommendation can hide full fallback | Record explicit named set and effective run-set separately. |
| W3 internal consistency | No measured data can look like a successful improvement | Allow unchanged rate, forbid fabricated edges. |
| W4 internal consistency | Cleanup can grow the surface | Negative net lines required. |
| W5 internal consistency | Historical records could be relabeled current | Preserve originals; new folder only contains actual new-run provenance. |

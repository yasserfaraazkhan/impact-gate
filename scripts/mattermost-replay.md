# Frozen Mattermost replay

This is the W2 baseline harness and the unchanged W3 measurement contract. It replays the fixed 30 most recently **updated** merged Mattermost PRs targeting master from 2026-09-16. It is not random sampling or necessarily the 30 latest merges. No live CI, provider, training, or sample refresh is performed.

Build the caller's CLI first, then run from any directory with Python 3.9+ (Path.is_relative_to), Node and Git available:

```sh
PATH=/opt/homebrew/bin:$PATH python3 scripts/mattermost-replay.py \
  --cli /absolute/impact-gate/dist/cli.js \
  --source-cache /private/tmp/impact-gate-pr-validation-2026-09-16/source \
  --evidence-root /private/tmp/impact-gate-pr-validation-2026-09-16 \
  --output /private/tmp/new-replay-output
```

`--fixture` defaults to the adjacent pinned JSON; `--timeout` defaults to 600 seconds per command. Output must not exist, preventing overwritten receipts. A failed or timed-out run preserves all command output and error rows and exits nonzero; it cannot silently count as a completed baseline. A retry uses a separate new output directory so the original receipt survives. The fixture and normalization/eligibility logic must remain unchanged for W3.

Inputs are the original `prs.json`, `ci/validated-index.json`, historical corrected results/summary/report and CI README, plus 104 raw suite receipts. SHA-256 hashes are pinned in the fixture. PR fields are preserved exactly. Compact suite provenance retains exact head/run/attempt, worker-report completeness, terminal worker identity, reconciliation and retry survivors; redundant screenshots and duplicated failed-test structures remain in the original evidence. `compact_ci` defines the exact fixture projection and checks it against the immutable index on every run. The raw failed spec's final non-expired/non-late dispatcher attempt is independently checked against its actual orchestration record.

Two disposable shared-object clones under the output directory hold HEAD source and its unique merge-base inventory. Cached source objects are only read. Review receives the full committed base-to-head comparison and the **base** Playwright inventory, with uncommitted inclusion disabled in a generated local config. Plan runs with `--no-ai`. No manifest training or evidence mapping is added. Provider credentials are absent from subprocess environments; the complete allowlisted environment appears in every receipt.

Every subprocess has exact argv, shell-rendered command, cwd, environment, exit code, duration, stdout and stderr files. `provenance.json` records the built CLI hash, all source/build file hashes, source revision, fixture/harness hashes and invocation. `cli-source-diff.stdout.txt` preserves uncommitted product changes. Reviews and plans use strict `json.loads` on the complete stdout; no banner stripping or recovery is allowed. `rows.json`, `summary.json` and `REPORT.md` contain the complete results; all 30 rows must complete before success.

Named recommendations are the union of `impactedFlows[].existingTests`, `relevantExistingTests[].file`, and `recommendations[].alreadyCoveredBy`. Absolute clone prefixes are stripped; `specs/` maps to `e2e-tests/playwright/`, `../cypress/` and `tests/integration/` map to Cypress. Only exact repository-relative paths that exist at base and match Playwright `specs/**/*.spec.[tj]sx?` or Cypress `tests/integration/**/*_spec.[tj]sx?` (also `.spec`/`.cy`) are retained. Adjacent unit tests, helpers and paths absent at base are excluded with reasons. PR-included tests remain separately visible, never automatically counted as preexisting recommendations.

Effective selection is separately recorded: a `full` plan encompasses the complete static preexisting E2E inventory; otherwise it uses the plan's normalized recommended paths. A full fallback is not a named recommendation or time saving. Static selection reduction uses selected base-spec occurrences / all base-spec occurrences; execution time savings are unmeasured.

Each omission denominator consists of eligible observed terminal-failed preexisting **spec occurrences** (PR/head/run/attempt/suite/spec), not failed assertions, raw artifact errors or all PRs. Eligibility requires matching identities, complete expected worker reports for the corresponding suite, confirmed terminal failure after retry reconciliation and presence at base. Named omission counts missing named recommendations; effective omission counts missing effective selection. The denominators are reported independently even when equal. PR38451's complete Playwright suite remains eligible despite incomplete Cypress reports. Missing suites, missing worker reports, retry survivors and skipped FIPS remain unknown/excluded; no passing inference is made. One observed failure is not established as PR-caused and cannot establish general detection accuracy. Existing unrelated-PR-test decision softening remains a heuristic limitation.

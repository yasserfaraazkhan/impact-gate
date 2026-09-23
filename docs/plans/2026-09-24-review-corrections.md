# Corrections following independent review of d414df8

The independent review reproduced four introduced defects and several existing
limitations. This follow-up addresses all eleven findings without adding a new
test runner, provider, matching engine, or agent framework.

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| 1. Config skips Git base detection | Detect the default branch when both CLI and config omit the base; preserve configured roots and explicit profile/provider overrides | Multi-commit temporary repository exercised through impact, review, plan, and gate; explicit config/CLI precedence and external config root |
| 2. Filesystem permissions become authorization scenarios | Match named authorization checks instead of a bare `Permission` substring | Filesystem negatives and authorization-call positives |
| 3. Heuristic associations imply coverage/confidence | Review flows use `associated`; unavailable confidence remains `null` with `confidenceKind`, including metrics and output rendering | Scanner result, text/Markdown/JSON, GitHub output, and metric-average regressions |
| 4. Changed Go tests disappear | List declared `TestX(*testing.T)` names from changed `_test.go` files as not executed | Excludes comments, string examples, TestMain and helpers; Go declarations do not satisfy E2E gaps |
| 5. Prediction JSON contains banners | Send progress, fallback and threshold diagnostics to stderr | Actual CLI JSON parsing for success, provider fallback, threshold failure and argument errors |
| 6. Absolute comment destination is nested | Resolve the requested path against the report root | Actual CLI absolute/relative output destinations and GitHub summary path |
| 7. Generation failure discards static review | Emit the complete review plus structured generation failure, then retain the classified nonzero exit | Missing provider, generation exception, failed summary, and enforcement precedence |
| 8. Preserved existing spec is an unverified proposal | Mark untouched specs skipped; count only artifacts actually created as generated | Existing spec stays byte-identical with no provider call; dry-run artifacts still count |
| 9. Long reproduction truncates expected outcome | Put the expected outcome before reproduction steps | Actual generator prompt with a long reproduction |
| 10. ESM skill installation crashes | Supply package-rooted `createRequire` in the ESM build | Packed ESM CLI installs exactly the packaged skill bytes |
| 11. Local outputs contaminate later diffs | Omit untracked tool artifact directories and conventional config files; retain staged/committed/modified tracked versions | Repeated CLI runs and tracked/staged preservation |

Cross-review additionally preserved unresolved scenario gaps when a flow becomes
`associated`, while avoiding generation from association alone. Config discovery
also respects explicit profile overrides before resolving the default branch.

## Validation

- `npm test`: **686 passed, 0 failed, 0 skipped**, including CJS/ESM builds,
  packaged consumer checks and existing real Playwright regression fixtures.
- This local total includes eight pre-existing untracked tests that are not part
  of the commit; the independent reviewer previously observed 658 tests in the
  clean baseline versus 666 in this workspace. Do not compare counts without
  accounting for that difference.
- `npm run lint` and `git diff --check`: passed.
- No live model was used. Deterministic provider fixtures test generation
  mechanics; they do not establish live-model quality.

## Mattermost follow-up

Only PR [#38731](https://github.com/mattermost/mattermost/pull/38731) was revisited,
at the same head `cb48cd53e87d1f91925d046832dadc7d95ed8a94` and merge base
`6249c96b019ba646a8c2bcb5ea9b35dd83e8de37`. Six targeted CLI runs covered review,
plan, gate, prediction, review with generation, and trained review.

- The original 36 filename candidates remain. Review now reports one associated
  flow, zero covered flows, and unavailable confidence. The matching algorithm
  was not replaced; these remain weak candidates requiring human review.
- Filesystem errors no longer produce user-role scenarios. The scenario export
  is empty for this change, and generation explicitly skips because there are
  no proposed scenarios. It does not claim provider-backed execution.
- The changed Go file exposes 19 declared test names, including all four new
  regression tests, explicitly marked **not executed**.
- The gate still exits 1 for unassessed changes. Prediction stdout parses as
  JSON. The absolute plan-comment destination and GitHub output path agree.
- Trained review still finds no mapped flow; confidence remains unavailable
  rather than increasing to 97.
- The heuristic risk score remains 0.488 with this checkout's Git history.
  History-sensitive scores can differ in a shallow clone.

The generated training manifest was temporarily set aside for the untrained
comparison and restored byte-for-byte afterward. Tracked Mattermost source was
unchanged. No Go or application E2E tests were rerun in this follow-up, and no
Mattermost comments, checks, workflow runs, commits, or PRs were published.

Local receipts and raw outputs are saved under
`artifacts/review-corrections-2026-09-24/`; they are not committed. The original
trial evidence remains under `artifacts/mattermost/launch-trial-2026-09-24/`.
The portable regression tests in this commit let an independent reviewer check
the fixes without those local artifacts.

## Compatibility and remaining limits

Review consumers must handle `metrics.confidence: null`, the explicit
`confidenceKind`, the `associated` flow status and Go PR-test inventory. Metric
averages exclude unavailable samples instead of converting them to zero.

Static review remains advisory. Go inventory is not Go execution or measured
coverage. No application running this Mattermost PR head, agent-browser session,
or live LLM provider was used. Browser-served Go code remains outside the current
direct-import mutation verifier; autonomous browser QA is not launch-certified.

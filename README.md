<p align="center">
  <img src="./docs-site/public/impact-gate-readme-banner.png" alt="Impact Gate" width="720" />
</p>

# Impact Gate

Impact Gate reviews a Git diff and suggests existing end-to-end specs to run. Its supported CLI surface is `review` for a report and `gate` for a spec-mapping threshold. The report combines changed-file impact, behavior signals, a test plan, and defect-risk prediction. Its source-to-test associations are candidates, not evidence that those tests exercised the changed source. Measured coverage and release safety are unavailable.

This README describes the current source checkout. The recovery changes have not been published as a new npm release. Node.js 20 or newer is required.

## Review and gate

Build from this checkout:

```sh
npm ci
npm run build
node dist/cli.js review --path /path/to/repository --since origin/main
```

`--path` selects the repository and `--since` selects a Git base ref. Use a base ref present in that repository. The default review prints a text report with impacted flows, associated existing specs, gaps, recommendations, prediction, and mapping provenance when available. Static review needs no provider. `--deep` asks an LLM provider for semantic prediction and falls back to deterministic prediction if unavailable; `--generate` also needs a provider and may execute generated tests. Those modes can incur provider cost.

For CI, use the same built CLI:

```sh
node dist/cli.js review --path /path/to/repository --since origin/main --json > review.json
node dist/cli.js review --path /path/to/repository --since origin/main --ci-comment-path review-comment.md
node dist/cli.js gate --path /path/to/repository --since origin/main --threshold 80 --json > gate.json
```

`review --json` emits the complete review report as one JSON document on stdout; diagnostics go to stderr. `--ci-comment-path` writes the Markdown review report to the given file while the terminal report still prints. The review's `--predict-threshold` compares the prediction score and can set an exit failure; it is separate from the gate's `--threshold`.

`gate --json` emits its decision, changed files, mapped and partial feature counts, unassessed files, mapping percentage, threshold, and reason. The default threshold is 80%. A fully mapped feature means a spec is associated in the manifest; partial associations do not count toward the numerator. The gate fails when changed files remain unassessed or the mapping percentage misses the threshold. It reports a valid empty diff separately, and an invalid Git ref exits with an error. A passing gate establishes spec presence against the mapping policy, not behavioral coverage, test success, or release readiness. Keep the repository's full-suite policy unless separate evidence authorizes a different execution decision.

### Candidate evidence and fallback

Impact Gate can use route-manifest associations, exact imported source-to-test relationships, and filename/domain matches to name Playwright or Cypress candidates. Each mapping's origin is reported; imported traceability and scanner matches remain **unverified**. A test execution report alone cannot prove which source file a spec covered. Supplying a coverage map declares relationships, but names, run counts, statuses, timestamps, or a current HEAD do not turn them into measured source coverage.

Valid exact imported relationships take precedence over scanner candidates for that source path. New declared-traceability and cold-start heuristic associations remain unassessed and require full-suite fallback. Unknown paths do too. Existing explicit route-manifest decisions retain their configured policy; this is not a universal change to those decisions. Experimental `plan --advisory` keeps the full suite for nonempty Mattermost diffs and does not authorize selective execution.

The fixed 30-PR Mattermost replay is [recorded in the W3 gate](gates/w3.txt): 30/30 completed, with 60 valid review/plan JSON outputs. Named candidates appeared on 26/30 PRs, often with broad lists (2–817, median 95 among positive PRs). The single eligible historical failed spec was absent from the named list (1/1), while full-suite fallback made effective omission 0/1; static selection savings were 0%. That failure was not established as PR-caused. These are candidate-utility observations, not accuracy, coverage, or runtime-savings measurements. The [March 2026 dogfood](dogfood/2026-03-28/README.md) is historical. [W1](gates/w1.txt) and [W2](gates/w2.txt) retain the earlier verification and measurement evidence.

### Optional generation

```sh
node dist/cli.js review --path /path/to/repository --since origin/main --generate
```

`review --generate` sends uncovered recommendations to the agentic generator. It requires a configured provider, such as `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, or `--llm-provider`. When generation proceeds, its summary is written to `<testsRoot>/.e2e-ai-agents/review-generate-summary.json`. Results can be passed, failed, skipped, or unverified; proposals that do not meet verification are quarantined under `<testsRoot>/.e2e-ai-agents/unverified/*.ts.unverified` rather than accepted as runnable specs. `--dry-run` skips execution, records a `skipped` result, and leaves the proposal quarantined without verification.

`passed` means the verifier accepted that generated spec under the local-source conditions below. `failed` can mean generation itself failed; `unverified` means the proposal was not accepted. Neither `skipped` nor `unverified` is a passing test result.

Verification currently supports only specs that directly import changed local source. Acceptance requires a clean Playwright run, an assertion failure caused by a supported changed-line mutation, and a passing run after source restoration. Missing repository/base context, absent qualifying mutation kills, and remote, browser-served, or prebuilt application targets remain unverified. Additions to existing specs are conservatively unverified. Compilation, process exit zero, or generated code alone is insufficient. The [W1 evidence](gates/w1.txt) used a deterministic provider fixture and real local Playwright execution; it did not test live-model quality or Mattermost browser behavior.

## A practical Playwright workflow

1. Start with one user journey and its expected result. Give the authoring agent the acceptance criteria, relevant code diff, test configuration, fixtures, and a representative existing spec.
2. Run `review` to find affected areas and existing test candidates. Export recommendations with `--scenarios-output scenarios.json`, inspect them, and remove duplicates before adding coverage.
3. Explore the running feature and reproduce the behavior. Capture the actual controls, setup data, and observable result before asking for test code.
4. Write the smallest independent scenario with meaningful assertions. Reuse the project's fixtures and page objects, prefer user-facing locators, and avoid arbitrary sleeps.
5. Run the spec in the intended environment. Check that it detects the regression, repeat it to look for instability, and investigate failures before changing assertions.
6. Review the diff and evidence, then run the required suite before merging. Keep product bugs separate from broken test setup.

One authoring agent can handle this loop; add an independent reviewer for a complex change. Impact Gate assists with diff review, candidate discovery, and optional proposals. Browser exploration, business expectations, and release approval still need evidence from the actual application. See the [quick start](docs-site/src/content/docs/getting-started/quick-start.md) for a worked command sequence.

```sh
# Deterministic scenario export; inspect the JSON before generation
node dist/cli.js review --path /path/to/repository --since origin/main --scenarios-output scenarios.json
# Experimental proposal generation; dry run still calls a provider and writes quarantine files
node dist/cli.js generate --path /path/to/repository --since origin/main --scenarios scenarios.json --dry-run
```

For PR and release reviewers, use the report and mapping gate alongside the required CI suite. For browser QA engineers, start with [bounded exploration](docs-site/src/content/docs/guides/browser-qa.md) and review the findings before generating follow-up tests. The browser agent and generation modes remain experimental.

## Experimental capabilities

The main CLI registers 21 command tokens: supported `review` and `gate`, plus these 19 experimental tokens. They remain callable but are not the supported review/gate product workflow:

| Command tokens | Purpose |
| --- | --- |
| `init`, `bootstrap`, `train` | Set up and derive route-family data. |
| `impact`, `plan`, `suggest` | Lower-level impact and planning; `suggest` is a `plan` alias. `plan --advisory` is the isolated Mattermost planning path. |
| `predict`, `predict-feedback`, `feedback` | Risk scoring and outcome feedback. |
| `traceability-capture`, `traceability-ingest` | Capture declared source-to-test relationships and ingest candidates. |
| `generate`, `heal`, `finalize-generated-tests` | Standalone generation and test maintenance. |
| `analyze`, `crew` | Pipeline and multi-agent orchestration. |
| `llm-health`, `cost-report`, `install-skill` | Provider diagnostics, cost reports, and skill installation. |

The separate `impact-gate-qa`/`e2e-qa-agent` binaries run the experimental browser QA agent; `impact-gate-mcp`/`e2e-agents-mcp` expose the experimental MCP server. The package also exports library APIs for the pipeline, crew, generation, and other integrations. See the [Mattermost advisory example](examples/mattermost/README.md) and [`package.json`](package.json) for those surfaces and their inputs. Provider-backed capabilities need their provider setup; the QA binary also uses `agent-browser`.

Apache-2.0 license. See [LICENSE](LICENSE).

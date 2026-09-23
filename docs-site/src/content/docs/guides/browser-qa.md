---
title: "Experimental Browser QA"
description: "Explore a running application, review findings, and prepare follow-up tests"
---

The separate `impact-gate-qa` binary is experimental. It explores a running application and records findings. Its scores and verdicts are advisory observations; they do not establish complete regression coverage or authorize a release.

For supported diff review and spec-mapping policy, start with [review and gate](../../getting-started/quick-start/). Browser QA requires a configured LLM provider, `agent-browser`, an accessible application, and the setup data or authentication needed for the journey.

## Explore one journey first

From the Impact Gate source checkout, run:

```sh
node dist/qa-agent/cli.js hunt "checkout flow" \
  --base-url http://localhost:3000 --phase 2 --no-fix
```

This stops at browser exploration and skips the repair loop. Review the screenshots, reproduction steps, expected behavior, and console observations before turning a finding into a test. Commands in this guide describe the current source, which has not been published as a new npm release.

## Modes

| Mode | Intended scope |
| --- | --- |
| `pr` | Use a Git diff to focus exploration on affected areas |
| `hunt` | Explore a named feature or journey |
| `release` | Explore a broader set of flows within the configured time limit |
| `fix` | Revisit paths associated with repairs |

```sh
node dist/qa-agent/cli.js pr --since origin/main \
  --base-url http://localhost:3000 --phase 2 --no-fix
node dist/qa-agent/cli.js release --time 30 \
  --base-url http://localhost:3000 --phase 2 --no-fix
```

A time-limited exploration may miss routes, permissions, data conditions, and failures. Keep the existing regression suite and release criteria. Use `--help` for provider budget, project, test-root, and output options.

## From findings to tests

Use the findings as authoring input:

1. Confirm that the reported behavior is reproducible and conflicts with the intended behavior.
2. Check existing specs to avoid adding duplicate coverage.
3. Preserve concrete reproduction steps, setup requirements, and the expected outcome in a scenario.
4. Generate or write a focused Playwright test, run it against the intended application, and inspect the assertions.

The optional phase-three generation handoff passes findings directly to the existing generator, retaining reproduction steps and expected/observed behavior. It writes `qa-findings-scenarios.json` and `qa-generation-summary.json` under the QA output directory (default `.e2e-ai-agents`). Inspect the summary's per-scenario status, artifact path, and reason. Only accepted `passed` results enter the report's generated-spec list; an empty list does not mean no findings occurred. Model or execution failures are not passing test results.

Automatic generation selects at most five actionable findings, ordered by severity from critical to info and keeping the original order within each severity. The scenario file retains all actionable findings; `deferredScenarioIds` and `deferredCount` in the generation summary identify those left for later. Inspect that list, choose the remaining scenarios, and pass a reviewed scenario file to `generate --scenarios` when ready.

The QA `--time` and `--budget` limits apply to exploration, not an aggregate phase-three generation budget. Generation has bounded attempts per scenario, but may take additional time and provider spend. Keep the finding set focused and inspect the exported scenarios when planning a larger generation run.

The current generation verifier accepts only specs that directly import changed local source and demonstrate clean/mutated/restored behavior. Browser-served or remote application tests remain unverified under that verifier. Review and validate those proposals in the application's own environment. See [AI guardrails](../ai-guardrails/) for the exact contract.

## Reports and orchestration

The QA run writes reports such as `.e2e-ai-agents/qa-summary.md` and `.e2e-ai-agents/qa-report.json`. Inspect individual findings and evidence as well as the overall summary. A health score is a heuristic, not measured test coverage.

The optional [/qa skill](../qa-skill/) and [crew workflows](../crew-workflows/) provide alternate experimental entry points. A single authoring agent plus a reviewer is a reasonable starting point; add parallel agents when distinct product areas can be explored independently.

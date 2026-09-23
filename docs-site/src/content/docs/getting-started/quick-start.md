---
title: "Quick Start"
description: "Review a diff, inspect a test plan, and author focused Playwright tests"
---

Impact Gate's supported entry points are `review` for diff analysis and `gate` for a spec-mapping threshold. Start with the workflow that matches your job:

| Audience | First action | Result |
| --- | --- | --- |
| Developer | Review the diff and export scenarios | Existing spec candidates and a reviewable authoring plan |
| PR or release reviewer | Read the report and check mapping policy | Gaps and candidate provenance, with full-suite fallback where required |
| Browser QA engineer | Explore one running user journey | Observations and reproduction steps to turn into tests; the browser agent is experimental |

## Build the current source

Follow [installation](../installation/), then run these commands from the Impact Gate checkout. They describe source changes that have not been published as a new npm release. Replace `/path/to/app` and `origin/main` with your repository and an available base ref.

## 1. Review the diff

```sh
node dist/cli.js review --path /path/to/app --since origin/main
```

The report shows impacted areas, associated existing specs, mapping gaps, heuristic risk scores, and recommendations. Inspect the named specs before deciding what to add. A filename or manifest association does not prove that a spec exercised the changed behavior.

For a release comparison, use the previous shipped tag as `--since`. Keep the repository's required full suite; a review report does not authorize skipping it.

## 2. Export and inspect the authoring plan

```sh
node dist/cli.js review --path /path/to/app --since origin/main \
  --scenarios-output ./scenarios.json
```

This exports scenario inputs without calling a provider. Review the JSON, remove duplicates, add the expected user-visible outcomes, and check fixtures and setup data. The format can be passed directly to the experimental generator:

```sh
node dist/cli.js generate --path /path/to/app --since origin/main \
  --scenarios ./scenarios.json --dry-run
```

Generation requires a configured provider. Here `--dry-run` still asks the provider for code and writes a quarantined proposal; it skips test execution. Alternatively, give the reviewed scenarios and an existing spec to your preferred coding agent.

## 3. Author and verify one useful test

A practical Playwright authoring loop is:

1. Define one user journey, its acceptance criteria, and its observable result.
2. Read the relevant diff, existing specs, fixtures, page objects, and Playwright configuration.
3. Explore the running feature and record the real controls and data needed to reproduce it.
4. Write a small independent scenario with meaningful assertions and stable user-facing locators.
5. Run it in the intended environment, demonstrate that it catches the regression, and repeat it to look for instability.
6. Review the test diff and run the required suite before merging.

One authoring agent can handle this process. An independent reviewer helps when the change is complex. Playwright also provides [planner, generator, and healer agents](https://playwright.dev/docs/test-agents); Impact Gate supplies diff context and candidate provenance for that work.

## Optional generation and its limits

```sh
node dist/cli.js review --path /path/to/app --since origin/main --generate
```

The integrated path may execute generated code. It writes a generation summary under the test root's `.e2e-ai-agents` directory. Inspect each result:

| Status | Meaning |
| --- | --- |
| `passed` | Accepted under the supported local-source verification conditions |
| `failed` | Generation or another required step failed |
| `skipped` | Execution was skipped; no passing result was established |
| `unverified` | The proposal did not meet the acceptance conditions |

Acceptance requires a clean Playwright run, an assertion failure caused by a supported mutation to changed local source, and a passing run after restoration. Only specs that directly import that changed source are supported. Browser-served, remote, prebuilt targets and additions to existing specs remain unverified. Unaccepted proposals are quarantined as `.e2e-ai-agents/unverified/*.ts.unverified`. Compilation or a smoke pass alone is insufficient. See [AI guardrails](../../guides/ai-guardrails/).

## PR and release review

```sh
node dist/cli.js review --path /path/to/app --since origin/main --json > review.json
node dist/cli.js review --path /path/to/app --since origin/main \
  --ci-comment-path review-comment.md
node dist/cli.js gate --path /path/to/app --since origin/main \
  --threshold 80 --json > gate.json
```

A gate passes when the configured percentage of impacted features has associated specs and no changed files remain unassessed. Partial mappings do not count as fully mapped. Invalid refs fail; valid empty diffs are reported separately. This measures mapping presence, not executed behavior coverage or release readiness.

Use the [CI integration guide](../../guides/ci-integration/) for PR reports or the [Mattermost advisory guide](../../guides/mattermost-advisory/) for the isolated pilot that retains full-suite execution.

## Browser QA

Start with a single running feature, capture findings, and inspect them before authoring tests. The [experimental browser QA guide](../../guides/browser-qa/) explains exploration modes and generation limits. Browser observations, generated proposals, accepted tests, and a release decision are separate results.

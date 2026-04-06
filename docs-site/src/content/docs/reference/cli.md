---
title: "CLI Commands"
description: "Complete reference for all impact-gate CLI commands"
---

<div class="doc-intro">
  <div class="doc-chip">Command reference</div>
  <p class="doc-lead">
    The CLI is built around one deterministic workflow: <code>impact</code>,
    <code>plan</code>, and <code>gate</code>. Optional AI commands are layered
    on after the evidence path is already useful.
  </p>
</div>

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Core mental model</span>
    <h2 class="docs-panel__title">Read the CLI as deterministic first, AI second</h2>
    <p class="docs-panel__copy">
      Most teams start and stay inside <code>impact</code>, <code>plan</code>,
      and <code>gate</code> for a while. The AI commands exist to extend that
      evidence path, not replace it.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Fast orientation</span>
    <h2 class="docs-panel__title">The three commands most teams learn first</h2>
    <div class="docs-terminal">
      <code>npx impact-gate impact --path . --since origin/main</code>
      <code>npx impact-gate plan --path . --since origin/main</code>
      <code>npx impact-gate gate --threshold 80 --path .</code>
    </div>
  </div>
</div>

<div class="command-index">
  <a href="#core-ci-workflow">Core CI</a>
  <a href="#optional-ai-workflow">Optional AI</a>
  <a href="#setup-and-calibration">Setup</a>
  <a href="#traceability">Traceability</a>
  <a href="#feedback--diagnostics">Diagnostics</a>
  <a href="#advanced--experimental">Advanced</a>
  <a href="#global-flags">Global Flags</a>
</div>

All commands are invoked via `npx impact-gate <command>`. Start with the core CI workflow first, then layer in optional AI features if the deterministic plan is already useful. The same deterministic flow supports pull-request gating and release-readiness planning from a git diff, while the AI path adds local-API grounding and hallucination guardrails rather than trusting raw generated code.

## Core CI Workflow

### `impact`

Map changed files to impacted route families using deterministic analysis. Free tier.

```bash
npx impact-gate impact --path . --since origin/main
```

Release-readiness example:

```bash
npx impact-gate impact --path . --since v2.1.0
```

Use `--since` with a previous release tag or branch when you want to compare the current candidate against what is already shipped.

### `plan` (alias: `suggest`)

Generate a coverage plan with gap analysis, run sets, and confidence scores. Free tier.

```bash
npx impact-gate plan --path . --since origin/main --fail-on-must-add-tests
```

Release-readiness example:

```bash
npx impact-gate plan --path . --since v2.1.0
```

This is the easiest way to turn a release diff into a test plan that shows impacted areas, current coverage, and where new tests or manual checks are still needed before ship.

Key flags: `--fail-on-must-add-tests`, `--github-output`, `--ci-comment-path`, `--json`

### `gate`

Pass/fail check against a coverage threshold. Exits non-zero on failure.

```bash
npx impact-gate gate --threshold 80 --path .
```

`--threshold` is percentage-style (`0-100`). For example, `80` means 80%.

## Defect Prediction

### `predict`

Research-backed defect risk scoring from a git diff. Works on any repo with zero config and no LLM cost.

```bash
npx impact-gate predict --path . --since origin/main
npx impact-gate predict --path . --since origin/main --deep --verbose
npx impact-gate predict --path . --since origin/main --predict-threshold 0.7
npx impact-gate predict --path . --since origin/main --json
```

| Flag | Description |
|------|-------------|
| `--since <ref>` | Base git ref for the diff (default: `origin/main`) |
| `--deep` | Enable LLM semantic analysis (~$0.02/PR) |
| `--predict-threshold <0-1>` | Exit 1 if defect risk exceeds threshold |
| `--train` | Retrain weights from labeled feedback data |
| `--calibration-status` | Show calibration state and exit |
| `--ref <sha>` | Tag the prediction with a commit SHA for traceability |
| `--json` | Output structured JSON |
| `--verbose` | Show full metrics breakdown |

Output includes a defect risk score (0.0-1.0), risk level (low/medium/high/critical), top contributing factors, and a recommendation. The engine uses 14 Kamei change-level metrics, Hassan complexity deltas, and optional LLM semantic analysis.

### `predict-feedback`

Record the actual outcome for a previous prediction. Used to build calibration data that improves accuracy over time.

```bash
npx impact-gate predict-feedback --outcome defect --ref abc123
npx impact-gate predict-feedback --outcome clean
```

| Flag | Description |
|------|-------------|
| `--outcome <defect\|clean>` | Whether the change introduced a defect (required) |
| `--ref <sha>` | Match a specific prediction by commit SHA |

After 50+ labeled samples, run `impact-gate predict --train` to retrain weights on your project's data (~65% -> ~75-80% accuracy).

## Optional AI Workflow

### `analyze`

Convenience wrapper that runs impact + plan, and optionally generation and healing.

```bash
npx impact-gate analyze --path . --generate --heal
```

### `generate`

LLM-powered spec generation with iterative run-fix loops.

```bash
npx impact-gate generate --path . --max-attempts 3
```

### `heal`

Repair flaky or failing specs from Playwright report data.

```bash
npx impact-gate heal --path . --traceability-report ./playwright-report.json
```

### `finalize-generated-tests`

Stage generated tests, commit, and optionally open a PR.

```bash
npx impact-gate finalize-generated-tests --path . --create-pr --pr-title "Add E2E tests"
```

## Setup And Calibration

### `init`

Initialize a new configuration file interactively.

```bash
npx impact-gate init
```

### `train`

Build the route-families manifest by scanning your codebase.

```bash
# Offline (free)
npx impact-gate train --no-enrich --path .

# With LLM enrichment
npx impact-gate train --path . --budget-usd 0.50

# Validate accuracy
npx impact-gate train --validate --since HEAD~50 --path .
```

Key flags: `--no-enrich`, `--validate`, `--server-path`, `--budget-usd`, `--verbose`

### `bootstrap`

Generate a route-families manifest from an Understand-Anything knowledge graph. This is the fastest way to onboard a new project: point the tool at an existing knowledge graph and it produces the mapping file that powers impact analysis.

```bash
# Default: reads .understand-anything/knowledge-graph.json
npx impact-gate bootstrap --path .

# Custom knowledge graph location
npx impact-gate bootstrap --kg-path ./my-kg.json

# API-only tests, limit to 30 families, preview first
npx impact-gate bootstrap --test-mode api --max-families 30 --dry-run
```

Key flags:

| Flag | Description |
|------|-------------|
| `--kg-path` | Path to a knowledge-graph JSON file (default: `.understand-anything/knowledge-graph.json`) |
| `--test-mode` | Test mode: `ui`, `api`, or `both` (auto-detected from the knowledge graph if omitted) |
| `--max-families` | Maximum number of route families to generate (default: 50) |
| `--dry-run` | Print the proposed manifest without writing files |

## Traceability

### `traceability-capture`

Extract test-file relationships from Playwright JSON reports.

```bash
npx impact-gate traceability-capture --path . --traceability-report ./report.json
```

### `traceability-ingest`

Merge captured mappings into the rolling traceability manifest.

```bash
npx impact-gate traceability-ingest --path . --traceability-input ./input.json
```

Key flags: `--traceability-min-hits`, `--traceability-max-files-per-test`, `--traceability-max-age-days`

## Feedback & Diagnostics

### `feedback`

Ingest recommendation outcomes for calibration. Free tier.

```bash
npx impact-gate feedback --path . --feedback-input ./feedback.json
```

### `cost-report`

View LLM cost breakdown from past runs. Free tier.

```bash
npx impact-gate cost-report --path .
```

### `llm-health`

Test LLM provider connectivity.

```bash
npx impact-gate llm-health
```

`llm-health` checks the configured provider, or the auto-detected provider if you rely on environment discovery.

## Advanced / Experimental

### `crew`

Run multi-agent workflows when you want richer strategy output or design artifacts on top of the core plan.

```bash
npx impact-gate crew --workflow quick-check --path . --tests-root ./e2e --since origin/main
```

Key flags: `--workflow` (`quick-check`, `design-only`, `full-qa`), `--budget-usd`, `--dry-run`, `--json`, `--plugins`

## Global Flags

These flags apply across the main CLI surface and are the ones most teams pin in CI, local aliases, or project-level config.

| Flag | Description |
|------|-------------|
| `--path` | Project root directory |
| `--tests-root` | Path to test directory |
| `--framework` | Test framework (`playwright`, `cypress`, `pytest`, `supertest`, `selenium`, `auto`) |
| `--profile` | Analysis profile (`default`, `strict`) |
| `--since` | Git ref for diff base, such as `origin/main`, a release branch, or a previous shipped tag |
| `--config` | Path to config file |
| `--budget-usd` | Max LLM spend in USD |
| `--verbose` / `-v` | Debug-level output |
| `--json` | Structured JSON output |
| `--degraded-mode` | Skip all AI calls |
| `--dry-run` | Preview without executing |

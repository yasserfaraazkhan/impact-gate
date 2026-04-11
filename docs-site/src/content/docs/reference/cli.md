---
title: "CLI Commands"
description: "Complete reference for all impact-gate CLI commands"
---

<div class="doc-intro">
  <div class="doc-chip">Command reference</div>
  <p class="doc-lead">
    The recommended entry point is <code>review</code>, which combines impact
    analysis, behavior analysis, coverage planning, and defect prediction. Add
    <code>--generate</code> to produce ready-to-run test files for uncovered flows.
  </p>
</div>

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Core mental model</span>
    <h2 class="docs-panel__title">Review first, generate second</h2>
    <p class="docs-panel__copy">
      Start with <code>review</code> to understand what changed and what's
      missing. Add <code>--generate</code> when you want test code. The lower-level
      <code>impact</code>, <code>plan</code>, and <code>gate</code> commands
      are still available for granular CI pipelines.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Fast orientation</span>
    <h2 class="docs-panel__title">The commands most teams learn first</h2>
    <div class="docs-terminal">
      <code>npx impact-gate review --path . --since origin/main</code>
      <code>npx impact-gate review --path . --since origin/main --generate</code>
      <code>npx impact-gate gate --threshold 80 --path .</code>
    </div>
  </div>
</div>

<div class="command-index">
  <a href="#review">Review</a>
  <a href="#core-ci-workflow">Core CI</a>
  <a href="#ai-test-generation">AI Generation</a>
  <a href="#setup-and-calibration">Setup</a>
  <a href="#traceability">Traceability</a>
  <a href="#feedback--diagnostics">Diagnostics</a>
  <a href="#advanced--experimental">Advanced</a>
  <a href="#global-flags">Global Flags</a>
</div>

All commands are invoked via `npx impact-gate <command>`. The `review` command is the recommended starting point. It combines all analysis into one report and optionally generates test code. Lower-level commands (`impact`, `plan`, `gate`) are available for granular CI pipelines.

## Review

### `review`

Unified PR review: behavior analysis, coverage gaps, defect risk, and test recommendations. Free tier (no LLM required).

```bash
# Full review report
npx impact-gate review --path . --since origin/main

# Generate test files for uncovered flows (requires LLM API key)
npx impact-gate review --path . --since origin/main --generate

# Dry run: generate files without executing them
npx impact-gate review --path . --since origin/main --generate --dry-run

# Deep mode: add LLM semantic risk analysis
npx impact-gate review --path . --since origin/main --deep

# Write PR comment for CI
npx impact-gate review --path . --since origin/main --ci-comment-path comment.md

# JSON output
npx impact-gate review --path . --since origin/main --json
```

| Flag | Description |
|------|-------------|
| `--generate` | Feed uncovered recommendations into agentic test generation (requires LLM) |
| `--generate-output <dir>` | Custom output directory for generated test files |
| `--deep` | Enable LLM-powered semantic risk analysis |
| `--ci-comment-path <path>` | Write markdown report for PR comments |
| `--predict-threshold <0-1>` | Exit 1 if defect risk exceeds threshold |
| `--dry-run` | Generate test files without executing them |
| `--max-attempts <n>` | Max fix attempts per scenario (default: 3) |
| `--json` | Output structured JSON |

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

## AI Test Generation

The recommended way to generate tests is `review --generate` (see above). These standalone commands are available for advanced pipelines:

### `analyze`

Legacy wrapper that runs impact + plan + optional generation/healing.

```bash
npx impact-gate analyze --path . --generate --heal
```

### `generate`

Standalone LLM-powered spec generation from a plan or scenario file.

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

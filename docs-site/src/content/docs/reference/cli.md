---
title: "CLI Commands"
description: "Complete reference for all e2e-ai-agents CLI commands"
---

All commands are invoked via `npx e2e-ai-agents <command>`. Use `--help` on any command for full flag details.

## Analysis Commands

### `impact`

Map changed files to impacted route families using deterministic analysis. Free tier.

```bash
npx e2e-ai-agents impact --path . --since origin/main
```

### `plan` (alias: `suggest`)

Generate a coverage plan with gap analysis, run sets, and confidence scores. Free tier.

```bash
npx e2e-ai-agents plan --path . --since origin/main --fail-on-must-add-tests
```

Key flags: `--fail-on-must-add-tests`, `--github-output`, `--ci-comment-path`, `--json`

### `analyze`

Convenience wrapper that runs impact + plan, and optionally generation and healing.

```bash
npx e2e-ai-agents analyze --path . --generate --heal
```

### `gate`

Pass/fail check against a confidence threshold. Exits non-zero on failure.

```bash
npx e2e-ai-agents gate --threshold 0.7 --path .
```

## Crew Command

### `crew`

Run multi-agent workflows with 10 specialized agents.

```bash
npx e2e-ai-agents crew --workflow quick-check --path . --tests-root ./e2e --since origin/main
```

Key flags: `--workflow` (`quick-check`, `design-only`, `full-qa`), `--budget-usd`, `--dry-run`, `--json`

## Generation & Healing

### `generate`

LLM-powered spec generation with iterative run-fix loops.

```bash
npx e2e-ai-agents generate --path . --max-attempts 3
```

### `heal`

Repair flaky or failing specs from Playwright report data.

```bash
npx e2e-ai-agents heal --path . --traceability-report ./playwright-report.json
```

### `finalize-generated-tests`

Stage generated tests, commit, and optionally open a PR.

```bash
npx e2e-ai-agents finalize-generated-tests --path . --create-pr --pr-title "Add E2E tests"
```

## Bootstrap

### `bootstrap`

Generate a route-families manifest from an Understand-Anything knowledge graph. This is the fastest way to onboard a new (non-Mattermost) project: point the tool at an existing knowledge graph and it produces the mapping file that powers impact analysis.

```bash
# Default: reads .understand-anything/knowledge-graph.json
npx e2e-ai-agents bootstrap --path .

# Custom knowledge graph location
npx e2e-ai-agents bootstrap --kg-path ./my-kg.json

# API-only tests, limit to 30 families, preview first
npx e2e-ai-agents bootstrap --test-mode api --max-families 30 --dry-run
```

Key flags:

| Flag | Description |
|------|-------------|
| `--kg-path` | Path to a knowledge-graph JSON file (default: `.understand-anything/knowledge-graph.json`) |
| `--test-mode` | Test mode: `ui`, `api`, or `both` (auto-detected from the knowledge graph if omitted) |
| `--max-families` | Maximum number of route families to generate (default: 50) |
| `--dry-run` | Print the proposed manifest without writing files |

## Training & Knowledge

### `train`

Build the route-families manifest by scanning your codebase.

```bash
# Offline (free)
npx e2e-ai-agents train --no-enrich --path .

# With LLM enrichment
npx e2e-ai-agents train --path . --budget-usd 0.50

# Validate accuracy
npx e2e-ai-agents train --validate --since HEAD~50 --path .
```

Key flags: `--no-enrich`, `--validate`, `--server-path`, `--budget-usd`, `--verbose`

## Traceability

### `traceability-capture`

Extract test-file relationships from Playwright JSON reports.

```bash
npx e2e-ai-agents traceability-capture --path . --traceability-report ./report.json
```

### `traceability-ingest`

Merge captured mappings into the rolling traceability manifest.

```bash
npx e2e-ai-agents traceability-ingest --path . --traceability-input ./input.json
```

Key flags: `--traceability-min-hits`, `--traceability-max-files-per-test`, `--traceability-max-age-days`

## Feedback & Diagnostics

### `feedback`

Ingest recommendation outcomes for calibration. Free tier.

```bash
npx e2e-ai-agents feedback --path . --feedback-input ./feedback.json
```

### `cost-report`

View LLM cost breakdown from past runs. Free tier.

```bash
npx e2e-ai-agents cost-report --path .
```

### `llm-health`

Test LLM provider connectivity.

```bash
npx e2e-ai-agents llm-health
```

### `init`

Initialize a new configuration file interactively.

```bash
npx e2e-ai-agents init
```

## Global Flags

| Flag | Description |
|------|-------------|
| `--path` | Project root directory |
| `--tests-root` | Path to test directory |
| `--framework` | Test framework (`playwright`, `cypress`, `pytest`, `supertest`, `auto`) |
| `--since` | Git ref for diff base |
| `--config` | Path to config file |
| `--budget-usd` | Max LLM spend in USD |
| `--verbose` / `-v` | Debug-level output |
| `--json` | Structured JSON output |
| `--degraded-mode` | Skip all AI calls |
| `--dry-run` | Preview without executing |

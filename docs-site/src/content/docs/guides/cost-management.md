---
title: "Cost Management"
description: "Control LLM spending with budgets, model routing, and degraded mode"
---

AI-powered features consume LLM tokens. Use these controls to keep costs predictable.

## Free-Tier Commands

These commands run without any LLM calls or API keys:

| Command | What It Does |
|---------|-------------|
| `review` | Unified PR review: behavior analysis, coverage gaps, defect risk, recommendations |
| `impact` | Deterministic impact analysis from git diff |
| `plan` | Coverage gap detection and test recommendations |
| `predict` | Research-backed defect risk scoring |
| `train --no-enrich` | Build route-families manifest (scanner only) |
| `feedback` | Ingest recommendation outcomes |
| `cost-report` | View past LLM cost breakdown |
| `traceability-capture` | Extract test-file relationships |
| `traceability-ingest` | Merge traceability mappings |

AI-powered features like `review --generate`, `review --deep`, `generate`, and `heal` require an LLM API key.

## Budget Flag

Cap LLM spending per run with `--budget-usd`:

```bash
npx impact-gate crew --workflow design-only --budget-usd 2.00 --path .
```

When the budget is exhausted, further LLM calls are rejected and the run completes with whatever results it has so far. The default budget for `train` is $0.50 with a max of $10.

## Cost Report

View a breakdown of LLM costs from past runs:

```bash
npx impact-gate cost-report --path .
```

This reads the cost tracking data stored in `.e2e-ai-agents/` and reports per-agent and per-model spend.

## Model Routing

The model router sends different task types to different models to optimize cost:
- **Simple tasks** (classification, short answers) go to cheaper, faster models
- **Complex tasks** (test generation, code analysis) go to more capable models

This happens automatically when using the default provider configuration.

## Degraded Mode

For zero-cost operation that skips all AI calls:

```bash
npx impact-gate crew --workflow quick-check --degraded-mode --path .
```

In degraded mode, agents that require LLM calls are skipped. Deterministic analysis (impact mapping, gap detection) still runs, so you get partial results at no cost.

## Cost by Workflow

Typical costs per crew workflow run:

| Workflow | Typical Cost | Range |
|----------|-------------|-------|
| `quick-check` | ~$0.10 | $0.05-0.20 |
| `design-only` | ~$1.00 | $0.50-2.00 |
| `full-qa` | ~$3.00 | $2.00-5.00 |

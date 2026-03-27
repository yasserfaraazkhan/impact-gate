---
title: "Artifacts"
description: "The files impact-gate writes and how to use them in CI and release workflows"
---

Most useful outputs are written under:

```text
<testsRoot>/.e2e-ai-agents/
```

## Core Planning Artifacts

| File | Produced By | What It Is For |
|------|-------------|----------------|
| `plan.json` | `plan` | Structured coverage plan with impacted families, run sets, confidence, and decisions |
| `ci-summary.md` | `plan` | Markdown summary for PR comments or release reports |
| `metrics.jsonl` | `plan` | Append-only event log for metrics and later cost reporting |
| `metrics-summary.json` | `plan` | Aggregated metrics for dashboards or CI summaries |

## Knowledge And Training Artifacts

| File | Produced By | What It Is For |
|------|-------------|----------------|
| `route-families.json` | `train` or `bootstrap` | The core manifest mapping code paths to product areas and flows |
| `train-report.json` | `train` | Training stats, coverage numbers, and enrichment timing |
| `traceability.json` | `traceability-ingest` | Rolling file-to-test mapping manifest |
| `traceability-state.json` | `traceability-ingest` | Hit counts and rolling ingest state |
| `failure-history.json` | failure correlation | Historical file-to-failure relationships used for confidence boosts |

## AI And QA Artifacts

| File or Directory | Produced By | What It Is For |
|-------------------|-------------|----------------|
| `generated-needs-review/` | generation stage | Quarantine area for specs blocked by hallucination guardrails or verification failures |
| `qa-screenshots/` | `impact-gate-qa` | Browser screenshots captured during exploratory testing or fix verification |
| `reports/` | reporting flows | Structured outputs consumed by downstream tooling or humans |

## How Teams Usually Use Them

- `plan.json` feeds automation and deeper tooling
- `ci-summary.md` is posted into pull requests or release discussions
- `route-families.json` is maintained as product knowledge
- `traceability.json` improves precision over time
- `generated-needs-review/` becomes a manual review queue, not a deployable output

## Recommended Habit

Treat these artifacts as part of the operating model, not temporary scratch files. They are the easiest way to understand what the tool decided and why.

---
title: "Artifacts"
description: "The files impact-gate writes and how to use them in CI and release workflows"
---

<div class="doc-intro">
  <div class="doc-chip">Reference</div>
  <p class="doc-lead">
    Most of the product’s value shows up in the artifacts it writes. Treat
    these files as part of the operating model, not temporary scratch output.
  </p>
</div>

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Output root</span>
    <h2 class="docs-panel__title">Most useful artifacts live under one working directory</h2>
    <p class="docs-panel__copy">
      That makes it easier to archive them in CI, inspect them locally, and
      feed them into release reviews or downstream tooling.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Artifact root</span>
    <h2 class="docs-panel__title">Default working directory</h2>
    <div class="docs-terminal">
      <code>&lt;testsRoot&gt;/.e2e-ai-agents/</code>
    </div>
  </div>
</div>

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

## Review And Generation Artifacts

| File or Directory | Produced By | What It Is For |
|-------------------|-------------|----------------|
| `review-generate-summary.json` | `review --generate` | Review-driven generation results with scenario mapping |
| `agentic-summary.json` | `generate` | Standalone agentic generation results |
| `generated-needs-review/` | generation stage | Quarantine area for specs blocked by hallucination guardrails or verification failures |
| `qa-screenshots/` | `impact-gate-qa` | Browser screenshots captured during exploratory testing or fix verification |
| `reports/` | reporting flows | Structured outputs consumed by downstream tooling or humans |

## How Teams Usually Use Them

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Operating model</span>
    <h2 class="docs-panel__title">How teams usually work with the artifacts</h2>
    <ul>
      <li><code>plan.json</code> feeds automation and deeper tooling</li>
      <li><code>ci-summary.md</code> is posted into PRs or release discussions</li>
      <li><code>route-families.json</code> is maintained as product knowledge</li>
      <li><code>traceability.json</code> improves precision over time</li>
      <li><code>generated-needs-review/</code> becomes a manual review queue</li>
    </ul>
  </div>
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Practical habit</span>
    <h2 class="docs-panel__title">Inspect the written artifacts, not just stdout</h2>
    <p class="docs-panel__copy">
      The artifacts are the easiest way to understand what the tool decided,
      why it made that decision, and what a release owner or QA lead should do
      next.
    </p>
  </div>
</div>

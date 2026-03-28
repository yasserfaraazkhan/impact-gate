---
title: "CI Integration"
description: "Run impact analysis and coverage gating in GitHub Actions"
---

<div class="doc-intro">
  <div class="doc-chip">Operational guide</div>
  <p class="doc-lead">
    Add diff-aware E2E coverage checks to your pull request and release
    workflows so untested changes are caught before they merge or ship.
  </p>
</div>

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">What CI gets you</span>
    <h2 class="docs-panel__title">Make impact analysis part of the release pipeline</h2>
    <p class="docs-panel__copy">
      Start with deterministic planning in CI, then add gating and optional AI
      only after the route-family manifest is reliable enough to trust.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Core CI loop</span>
    <h2 class="docs-panel__title">The same workflow works in pull requests and releases</h2>
    <div class="docs-terminal">
      <code>npx impact-gate impact --path . --since origin/main</code>
      <code>npx impact-gate plan --path . --since origin/main</code>
      <code>npx impact-gate gate --threshold 80 --path .</code>
    </div>
  </div>
</div>

## GitHub Actions Example

```yaml
name: E2E Coverage Check
on:
  pull_request:
    branches: [main, master]

jobs:
  e2e-coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install impact-gate
        run: npm install -D @yasserkhanorg/impact-gate

      - name: Run coverage check
        run: |
          npx impact-gate plan \
            --since origin/${{ github.base_ref }} \
            --fail-on-must-add-tests \
            --github-output "$GITHUB_OUTPUT"
```

## Gate Command

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Thresholds</span>
    <h2 class="docs-panel__title">Use gate when you want an explicit pass/fail decision</h2>
    <p class="docs-panel__copy">
      The gate command exits non-zero if overall coverage falls below the
      configured threshold, making it suitable as a required status check.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Gate example</span>
    <h2 class="docs-panel__title">Thresholds use percentage-style values</h2>
    <div class="docs-terminal">
      <code>npx impact-gate gate --threshold 80 --path .</code>
    </div>
  </div>
</div>

`--threshold` uses percentage-style values (`0-100`).

## CI Artifacts

Every run produces files under `.e2e-ai-agents/`:

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Plan artifact</span>
    <h3 class="docs-panel__title"><code>.e2e-ai-agents/plan.json</code></h3>
    <p class="docs-panel__copy">Structured plan with run sets, confidence, and decisions.</p>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">PR summary</span>
    <h3 class="docs-panel__title"><code>.e2e-ai-agents/ci-summary.md</code></h3>
    <p class="docs-panel__copy">Markdown summary for pull requests and release reviews.</p>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Metrics summary</span>
    <h3 class="docs-panel__title"><code>.e2e-ai-agents/metrics-summary.json</code></h3>
    <p class="docs-panel__copy">Aggregated run metrics for dashboards and reporting.</p>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Event log</span>
    <h3 class="docs-panel__title"><code>.e2e-ai-agents/metrics.jsonl</code></h3>
    <p class="docs-panel__copy">Append-only metric log for later analysis and calibration.</p>
  </div>
</div>

## JSON Output for Parsing

<div class="docs-panel">
  <span class="docs-panel__eyebrow">Machine-readable output</span>
  <h2 class="docs-panel__title">Use JSON when another job needs to consume the result</h2>
  <p class="docs-panel__copy">
    Structured JSON output is useful when CI needs to branch on impact results
    or feed the plan into another reporting step.
  </p>
</div>

Use `--json` to get structured log output suitable for CI pipelines:

```bash
npx impact-gate plan --json --path . --since origin/main
```

## Free-Tier CI

<div class="docs-panel">
  <span class="docs-panel__eyebrow">No-key mode</span>
  <h2 class="docs-panel__title">Run the core planning loop in CI without any provider</h2>
  <p class="docs-panel__copy">
    Deterministic analysis only requires git, the repository, and the route
    manifest. Provider environment variables are optional.
  </p>
</div>

For zero-cost CI runs, skip AI enrichment:

```bash
npx impact-gate impact --path . --since origin/${{ github.base_ref }}
npx impact-gate plan --path . --since origin/${{ github.base_ref }}
```

These commands use deterministic analysis only and require no API key. Add provider env vars only when you intentionally want AI enrichment on top of this baseline.

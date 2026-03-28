---
title: "Quick Start"
description: "Get from install to impact results and release-ready test planning in three steps"
---

<div class="doc-intro">
  <div class="doc-chip">Core workflow</div>
  <p class="doc-lead">
    Learn how to install Impact Gate, run diff-aware impact analysis, and turn
    the result into a release-ready test plan in minutes. The same commands
    work for pull requests, release branches, and previous shipped tags.
  </p>
</div>

<div class="docs-grid">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">What this gets you</span>
    <h2 class="docs-panel__title">Go from diff to test plan in one short loop</h2>
    <p class="docs-panel__copy">
      All three steps below are free-tier, require no API key, and work for
      pull requests, release branches, and previous shipped tags.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Three commands</span>
    <h2 class="docs-panel__title">The default path stays deterministic</h2>
    <div class="docs-terminal">
      <code>npx impact-gate impact --path . --since origin/main</code>
      <code>npx impact-gate plan --path . --since origin/main</code>
      <code>npx impact-gate gate --threshold 80 --path .</code>
    </div>
  </div>
</div>

## Step 1: Install

<div class="docs-step">
  <div class="docs-step__index">01</div>
  <div>
    <h3 class="docs-step__title">Install the package into the repo</h3>
    <p class="docs-step__copy">
      Add the CLI as a dev dependency so impact analysis and planning run next
      to the test suite.
    </p>
  </div>
</div>

```bash
npm install -D @yasserkhanorg/impact-gate
```

## Step 2: Run Impact Analysis

<div class="docs-step">
  <div class="docs-step__index">02</div>
  <div>
    <h3 class="docs-step__title">Compare the current branch to a known baseline</h3>
    <p class="docs-step__copy">
      Start with the base branch for pull requests, then swap in the previous
      shipped tag when you want release-readiness planning.
    </p>
  </div>
</div>

Point the tool at your project and diff against your base branch:

```bash
npx impact-gate impact --path . --since origin/main
```

This parses the git diff, maps changed files to route families, and reports which E2E test flows are impacted.

For release readiness, point the same workflow at the previous shipped tag or release branch:

```bash
npx impact-gate impact --path . --since v2.1.0
```

## Step 3: View the Results

<div class="docs-step">
  <div class="docs-step__index">03</div>
  <div>
    <h3 class="docs-step__title">Turn the same diff into a written coverage plan</h3>
    <p class="docs-step__copy">
      The plan command writes the artifacts you can inspect in CI, release
      review, and downstream automation.
    </p>
  </div>
</div>

The `impact` command prints a deterministic summary to stdout. To write coverage artifacts with gap analysis, run `plan`:

```bash
npx impact-gate plan --path . --since origin/main
```

This produces:
- **`.e2e-ai-agents/plan.json`** -- structured plan with run sets and confidence scores
- **`.e2e-ai-agents/ci-summary.md`** -- markdown summary suitable for PR comments

Use the exact same command for a release-diff test plan:

```bash
npx impact-gate plan --path . --since v2.1.0
```

That gives you a release-focused view of impacted flows, current coverage, and what still needs tests or manual validation before shipping.

## Why The AI Path Is Safer Than Raw Generation

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Deterministic first</span>
    <h3 class="docs-panel__title">The plan exists before the model does</h3>
    <p class="docs-panel__copy">
      Diff analysis, impact mapping, and coverage planning happen before
      generation enters the loop.
    </p>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Repo grounding</span>
    <h3 class="docs-panel__title">Prompts are constrained by local API knowledge</h3>
    <p class="docs-panel__copy">
      Page objects, helpers, signatures, and inherited methods are discovered
      before prompting.
    </p>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Detection</span>
    <h3 class="docs-panel__title">Suspicious calls are flagged after generation</h3>
    <p class="docs-panel__copy">
      Invented methods and fabricated helpers are caught instead of silently
      landing in the main suite.
    </p>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Verification</span>
    <h3 class="docs-panel__title">Generated specs still need to earn trust</h3>
    <p class="docs-panel__copy">
      Compile checks and smoke runs are used before a generated spec counts as
      verified.
    </p>
  </div>
</div>

When you later enable generation or healing, `impact-gate` does not just trust whatever the LLM writes.

- The diff and coverage plan are established first with deterministic analysis
- Generation prompts are grounded in your repository's discovered page objects and helpers
- The generator is told to use only known methods and fall back to raw Playwright selectors when needed
- Suspicious method calls are detected after generation and blocked into `generated-needs-review/`
- Written specs are compile-checked and smoke-run before they count as verified

## What Next?

<div class="command-index">
  <a href="../guides/ci-integration/">CI Integration</a>
  <a href="../guides/release-readiness/">Release Readiness</a>
  <a href="../guides/ai-guardrails/">AI Guardrails</a>
  <a href="../reference/cli/">CLI Reference</a>
</div>

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Confidence</span>
    <h2 class="docs-panel__title">Make the deterministic path trustworthy first</h2>
    <ul>
      <li>Run <code>train --no-enrich</code> to improve route-family accuracy</li>
      <li>Add <code>gate --threshold 80</code> in CI once plan output looks trustworthy</li>
      <li>Add a <a href="../guides/ci-integration/">CI integration</a> to gate PRs on coverage</li>
    </ul>
  </div>
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Expansion</span>
    <h2 class="docs-panel__title">Layer in graph bootstrap and optional AI later</h2>
    <ul>
      <li>If you already have an Understand-Anything knowledge graph, run <code>bootstrap</code> instead of <code>train</code></li>
      <li>Try <code>crew --workflow quick-check</code> for strategy recommendations on top of the core CI loop</li>
      <li>Set up <a href="../guides/cost-management/">cost controls</a> before enabling AI features</li>
    </ul>
  </div>
</div>

---
title: "Release Readiness"
description: "Use impact-gate to compare releases and build a ship-focused test plan"
---

<div class="doc-intro">
  <div class="doc-chip">Ship with confidence</div>
  <p class="doc-lead">
    Compare the current candidate to the last shipped tag, review the changed
    flows, and turn that delta into a ship-focused E2E plan. This keeps release
    readiness grounded in evidence instead of prompt-only guesswork.
  </p>
</div>

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Typical release diff</span>
    <h2 class="docs-panel__title">Use the last shipped tag as the baseline</h2>
    <div class="docs-terminal">
      <code>npx impact-gate impact --path . --since v2.1.0</code>
      <code>npx impact-gate plan --path . --since v2.1.0</code>
      <code>npx impact-gate gate --threshold 80 --path .</code>
    </div>
  </div>
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">What it answers</span>
    <h2 class="docs-panel__title">Release comparison turns one delta into a reviewable plan</h2>
    <ul>
      <li>Compare the current release candidate to the last shipped tag</li>
      <li>Determine which flows changed</li>
      <li>Review which tests already cover those flows</li>
      <li>See where more testing or manual validation is still needed</li>
    </ul>
  </div>
</div>

That tells the tool: "treat `v2.1.0` as the already-shipped baseline, and build the test plan for everything that changed after it."

## When Teams Use This

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Release cadence</span>
    <h3 class="docs-panel__title">Common release scenarios</h3>
    <ul>
      <li>release branch vs previous stable tag</li>
      <li>release candidate vs last production release</li>
      <li>hotfix branch vs current production tag</li>
      <li>milestone validation before a coordinated rollout</li>
    </ul>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Why teams use it</span>
    <h3 class="docs-panel__title">The plan becomes a QA review packet</h3>
    <p class="docs-panel__copy">
      Teams use the written artifacts for release notes, QA sign-off, and a
      shared view of what changed between shipped versions.
    </p>
  </div>
</div>


## Recommended Workflow

<div class="docs-steps">
  <div class="docs-step">
    <div class="docs-step__index">01</div>
    <div>
      <h3 class="docs-step__title">Run <code>impact</code> to inspect the raw changed families</h3>
      <p class="docs-step__copy">
        Start with the deterministic view of what changed between the shipped
        release and the current candidate.
      </p>
    </div>
  </div>
  <div class="docs-step">
    <div class="docs-step__index">02</div>
    <div>
      <h3 class="docs-step__title">Run <code>plan</code> to produce run sets and gap analysis</h3>
      <p class="docs-step__copy">
        This is the moment where the diff becomes a release-specific test plan.
      </p>
    </div>
  </div>
  <div class="docs-step">
    <div class="docs-step__index">03</div>
    <div>
      <h3 class="docs-step__title">Review the written artifacts with QA and release owners</h3>
      <p class="docs-step__copy">
        Use <code>.e2e-ai-agents/ci-summary.md</code> and
        <code>.e2e-ai-agents/plan.json</code> as the shared evidence layer.
      </p>
    </div>
  </div>
  <div class="docs-step">
    <div class="docs-step__index">04</div>
    <div>
      <h3 class="docs-step__title">Gate the release when you need an explicit threshold</h3>
      <p class="docs-step__copy">
        Use <code>gate</code> for a pass/fail decision once the manifest is
        trustworthy enough to enforce.
      </p>
    </div>
  </div>
  <div class="docs-step">
    <div class="docs-step__index">05</div>
    <div>
      <h3 class="docs-step__title">Add targeted generation only if the remaining gaps matter</h3>
      <p class="docs-step__copy">
        AI generation should follow the plan, not replace it.
      </p>
    </div>
  </div>
</div>

## Artifacts To Review

The release-readiness path is most useful when you inspect the written artifacts, not just stdout:

<div class="docs-grid docs-grid--three">
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Plan</span>
    <h3 class="docs-panel__title"><code>.e2e-ai-agents/plan.json</code></h3>
    <p class="docs-panel__copy">Structured run sets, confidence, gaps, and decisions.</p>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Summary</span>
    <h3 class="docs-panel__title"><code>.e2e-ai-agents/ci-summary.md</code></h3>
    <p class="docs-panel__copy">Human-readable release review notes for PRs and sign-off.</p>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Metrics</span>
    <h3 class="docs-panel__title"><code>.e2e-ai-agents/metrics-summary.json</code></h3>
    <p class="docs-panel__copy">Aggregated metrics for dashboards, audits, and CI reporting.</p>
  </div>
</div>

These artifacts are useful for release notes, QA sign-off, and CI reporting.

## Example Release Checklist

<div class="docs-panel">
  <span class="docs-panel__eyebrow">Checklist</span>
  <h2 class="docs-panel__title">Questions to answer before you ship</h2>
  <ul>
    <li>Has every P0 or P1 impacted family been reviewed?</li>
    <li>Is the run set small enough to be actionable?</li>
    <li>Are there any <code>must-add-tests</code> decisions?</li>
    <li>Are there changed files with no family mapping?</li>
    <li>Are there risky areas with low confidence?</li>
    <li>Do the generated or existing specs still need manual verification?</li>
  </ul>
</div>

## Recommended CI Pattern

<div class="docs-panel">
  <span class="docs-panel__eyebrow">CI pattern</span>
  <h2 class="docs-panel__title">Keep release readiness grounded in evidence</h2>
  <p class="docs-panel__copy">
    Use the deterministic plan on every release-candidate branch first. Then
    add AI generation or healing only when the route-family manifest is already
    reliable enough to trust. That keeps release readiness from turning into a
    prompt-only exercise.
  </p>
</div>

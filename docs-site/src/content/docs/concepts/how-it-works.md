---
title: "How Impact Gate Works"
description: "The end-to-end model behind diff analysis, planning, gating, and optional AI"
---

<div class="doc-intro">
  <div class="doc-chip">Concept model</div>
  <p class="doc-lead">
    Impact Gate is easiest to understand as one pipeline: read a diff, map it
    to product areas, compare that to coverage, and only then decide whether AI
    should help extend the suite.
  </p>
</div>

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Pipeline</span>
    <h2 class="docs-panel__title">Diff in, evidence out, AI last</h2>
    <div class="docs-terminal">
      <code>01 read a diff</code>
      <code>02 map changed files to product areas</code>
      <code>03 compare those areas to E2E coverage</code>
      <code>04 produce a plan and a gate decision</code>
      <code>05 optionally generate or heal with guardrails</code>
    </div>
  </div>
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Why this matters</span>
    <h2 class="docs-panel__title">The strongest story is deterministic first</h2>
    <p class="docs-panel__copy">
      The product is not “an AI test generator” first. It is a diff-aware
      evidence layer that becomes more valuable once a team trusts what it is
      telling them.
    </p>
  </div>
</div>

## Core Mental Model

The product is not "an AI test generator" first. Its strongest path is deterministic:

- read a git diff
- determine what changed
- determine what should run
- determine what is missing
- decide whether the current PR or release candidate is ready

That deterministic path is why `impact`, `plan`, and `gate` are the core commands.

## Step 1: Diff In

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Input</span>
    <h2 class="docs-panel__title">Everything starts with a git comparison</h2>
    <ul>
      <li><code>origin/main</code> for pull requests</li>
      <li>a previous release tag for release readiness</li>
      <li>a hotfix base for emergency verification</li>
    </ul>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Example</span>
    <h2 class="docs-panel__title">Release-ready plan from one tag</h2>
    <div class="docs-terminal">
      <code>npx impact-gate plan --path . --since v2.1.0</code>
    </div>
  </div>
</div>

Everything starts with a git comparison. In practice, teams use:

## Step 2: Knowledge Layer

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Project knowledge</span>
    <h2 class="docs-panel__title">The diff is interpreted through what the repo already knows</h2>
    <ul>
      <li><strong>route families</strong> map code paths to product areas and flows</li>
      <li><strong>dependency graph</strong> catches transitive impacts</li>
      <li><strong>traceability</strong> adds file-to-test evidence from CI history</li>
      <li><strong>historical failure data</strong> can raise confidence that an area needs attention</li>
    </ul>
  </div>
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Interpretation</span>
    <h2 class="docs-panel__title">This is what turns files into flows and tests</h2>
    <p class="docs-panel__copy">
      Without the knowledge layer, you only know which files changed. With it,
      you can reason about which product areas and E2E checks actually matter.
    </p>
  </div>
</div>

The diff is interpreted through project knowledge:

## Step 3: Coverage Planning

<div class="docs-panel">
  <span class="docs-panel__eyebrow">Plan output</span>
  <h2 class="docs-panel__title">Coverage planning answers what changed, what to run, and what is missing</h2>
  <ul>
    <li>what is impacted</li>
    <li>what should run now</li>
    <li>what confidence we have in that decision</li>
    <li>what flows appear under-covered</li>
    <li>whether new tests or more manual verification are needed</li>
  </ul>
</div>

`plan` produces a structured answer to:

The main artifacts are written under `.e2e-ai-agents/`.

## Step 4: Gate Decision

<div class="docs-panel">
  <span class="docs-panel__eyebrow">Decision layer</span>
  <h2 class="docs-panel__title">Gate turns the plan into a CI policy decision</h2>
  <ul>
    <li>advisory while onboarding</li>
    <li>threshold-based blocking once the manifest is trustworthy</li>
    <li>stronger enforcement for release branches or critical paths</li>
  </ul>
</div>

`gate` turns the plan into a CI decision. This is where you decide how strict to be:

## Step 5: Optional AI With Guardrails

<div class="docs-panel">
  <span class="docs-panel__eyebrow">Guarded AI</span>
  <h2 class="docs-panel__title">The AI path helps only after the deterministic picture exists</h2>
  <ul>
    <li>enrich flow understanding</li>
    <li>generate specs for uncovered gaps</li>
    <li>heal failing generated specs</li>
    <li>power deeper exploratory or crew workflows</li>
  </ul>
  <p class="docs-panel__copy">
    The generation path uses local API-surface grounding, prompt sanitization,
    hallucination detection, quarantine into <code>generated-needs-review/</code>,
    compile checks, and smoke-run verification.
  </p>
</div>

AI enters after the deterministic evidence is already established.

The AI layer is used to:

See [AI Guardrails](../guides/ai-guardrails/) for the full safety model.

## Why This Matters

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Engineering evidence</span>
    <h2 class="docs-panel__title">Every layer answers a different confidence question</h2>
    <ul>
      <li>the diff explains why you are testing</li>
      <li>the manifest explains what feature was affected</li>
      <li>the plan explains what is covered</li>
      <li>the gate explains whether confidence is high enough</li>
      <li>the AI layer helps only after that foundation is already in place</li>
    </ul>
  </div>
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Positioning</span>
    <h2 class="docs-panel__title">This keeps the product honest</h2>
    <p class="docs-panel__copy">
      The tool feels stronger because it can justify every recommendation with
      artifacts and repo knowledge, not just a prompt and a model opinion.
    </p>
  </div>
</div>

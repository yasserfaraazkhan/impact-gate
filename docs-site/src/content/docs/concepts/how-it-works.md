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
- provide a test plan and mapping evidence for PR or release review

Use `impact`, `plan --no-ai`, and `gate` for that deterministic path. Spec mappings and heuristic scores do not establish measured behavior coverage or release readiness.

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
      <code>npx impact-gate plan --no-ai --path . --since v2.1.0</code>
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
      <li><strong>traceability</strong> imports file-to-test evidence from an explicit per-test source coverage map; a passing result or Git diff alone creates no coverage edges</li>
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

Ordinary `plan --no-ai` writes these artifacts under `<testsRoot>/.e2e-ai-agents/`. Its confidence is heuristic. The separate [Mattermost advisory path](../../guides/mattermost-advisory/) emits JSON on stdout with unavailable confidence and retains the full suite for every nonempty diff.

## Step 4: Gate Decision

<div class="docs-panel">
  <span class="docs-panel__eyebrow">Decision layer</span>
  <h2 class="docs-panel__title">Gate checks a spec-mapping threshold</h2>
  <ul>
    <li>fully mapped impacted features count toward the threshold</li>
    <li>partial mappings do not count as fully covered</li>
    <li>unassessed files fail the ordinary gate; invalid Git refs return errors</li>
  </ul>
</div>

`gate` independently analyzes the diff and compares the percentage of fully mapped features to `--threshold`; it does not consume a saved plan or measure executed assertions. A valid empty Git diff can pass with no coverage percentage. `gate --advisory` requires the configured advisory suite and emits an advisory plan instead. Ordinary plan policy enforcement is a separate mechanism.

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

See [AI Guardrails](../../guides/ai-guardrails/) for the full safety model.

## Why This Matters

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Engineering evidence</span>
    <h2 class="docs-panel__title">Every layer answers a different confidence question</h2>
    <ul>
      <li>the diff explains why you are testing</li>
      <li>the manifest explains what feature was affected</li>
      <li>the plan explains spec mappings and gaps</li>
      <li>the gate explains whether the spec-mapping threshold is met</li>
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

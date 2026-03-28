---
title: "AI Guardrails"
description: "How impact-gate reduces hallucinations and keeps generated specs in a trusted path"
---

<div class="doc-intro">
  <div class="doc-chip">Guarded generation</div>
  <p class="doc-lead">
    Impact Gate does not treat generated code as trustworthy just because a
    model produced it. The AI path is designed to reduce hallucinations before
    generation and to block suspicious output after generation.
  </p>
</div>

## Guardrail 1: Deterministic First

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">01 deterministic first</span>
    <h2 class="docs-panel__title">The strongest workflow does not depend on a model</h2>
    <p class="docs-panel__copy">
      Diff analysis, impact mapping, coverage planning, release-diff planning,
      and threshold gating already exist before any prompt is sent.
    </p>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">02 local grounding</span>
    <h2 class="docs-panel__title">Generation is anchored to the repo’s API surface</h2>
    <p class="docs-panel__copy">
      The tool discovers page objects, helper methods, inherited methods, and
      method signatures before it asks the model to write anything.
    </p>
  </div>
</div>

The strongest workflow does not depend on an LLM:

- diff analysis
- impact mapping
- coverage planning
- release-diff planning
- threshold gating

AI is layered on after the deterministic picture already exists.

## Guardrail 2: Local API-Surface Grounding

Generation is grounded in the actual repository, not a generic mental model of Playwright tests.

The tool extracts:

- page objects
- helper methods
- inherited methods
- method signatures

That discovered API surface is then injected into generation prompts so the model works from real project methods.

## Guardrail 3: Prompt Constraints

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">03 prompt constraints</span>
    <h2 class="docs-panel__title">The prompt narrows the space where hallucinations appear</h2>
    <ul>
      <li>use only known methods</li>
      <li>do not invent project-specific helpers</li>
      <li>fall back to raw Playwright selectors if a helper does not exist</li>
      <li>return code only</li>
    </ul>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">04 prompt sanitization</span>
    <h2 class="docs-panel__title">Inputs are cleaned before they reach the model</h2>
    <p class="docs-panel__copy">
      User-action strings, evidence, and flow names are sanitized to reduce
      prompt pollution and keep upstream text from contaminating the output.
    </p>
  </div>
</div>

Generation prompts explicitly say:

- use only known methods
- do not invent project-specific helpers
- fall back to raw Playwright selectors if a helper does not exist
- return code only

This sharply narrows the space where hallucinations usually creep in.

## Guardrail 4: Prompt Sanitization

User-action strings, evidence, and flow names are sanitized before they go into prompts. That reduces prompt pollution and lowers the chance that upstream text contaminates the generated output.

## Guardrail 5: Hallucination Detection

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">05 hallucination detection</span>
    <h2 class="docs-panel__title">Suspicious method calls are scanned after generation</h2>
    <p class="docs-panel__copy">
      Invented page-object methods, fabricated helpers, and fake wrapper calls
      are detected against the discovered API surface.
    </p>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">06 quarantine</span>
    <h2 class="docs-panel__title">Suspicious specs are moved into a review queue</h2>
    <p class="docs-panel__copy">
      Blocked specs are written to <code>generated-needs-review/</code> so they
      stay visible without silently entering the trusted suite.
    </p>
  </div>
</div>

After generation, the code is scanned for method calls that do not exist in the discovered API surface.

Examples of suspicious output:

- invented page-object methods
- fabricated helpers
- project-specific wrapper calls that do not actually exist

By default, suspicious specs are blocked.

## Guardrail 6: Needs-Review Quarantine

Blocked specs are written to:

```text
generated-needs-review/
```

That keeps suspicious code out of the main trusted test tree while still letting the team inspect what the model attempted.

## Guardrail 7: Compile And Smoke Verification

<div class="docs-panel">
  <span class="docs-panel__eyebrow">07 verification</span>
  <h2 class="docs-panel__title">Written specs still have to earn trust</h2>
  <ul>
    <li>compile check first</li>
    <li>smoke run when Playwright is available</li>
    <li>failed specs move out of the trusted path</li>
  </ul>
</div>

Specs that are written into the main path are still verified:

- compile check first
- smoke run when Playwright is available

Specs that fail verification are moved out of the trusted path.

## Practical Takeaway

<div class="docs-panel docs-panel--terminal">
  <span class="docs-panel__eyebrow">Practical takeaway</span>
  <h2 class="docs-panel__title">This is not “generate and pray”</h2>
  <div class="docs-terminal">
    <code>01 build evidence</code>
    <code>02 ground the prompt</code>
    <code>03 constrain the output</code>
    <code>04 detect suspicious calls</code>
    <code>05 quarantine risky specs</code>
    <code>06 verify written specs</code>
  </div>
  <p class="docs-panel__copy">
    That is a much stronger story for teams evaluating the product than generic
    “AI-powered testing.”
  </p>
</div>

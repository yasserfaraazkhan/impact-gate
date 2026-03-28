---
title: "Autonomous Browser QA"
description: "Let Impact Gate lead browser-side QA from diff to bug hunt, generated tests, and verified results"
---

<div class="doc-intro">
  <div class="doc-chip">AI-led QA loop</div>
  <p class="doc-lead">
    Give Impact Gate a diff, a feature name, or a staging URL, and it can take
    the lead on browser-side QA: scope the run, explore the app, hunt bugs,
    generate follow-up tests, heal failures, and return an evidence-backed
    verdict. This is the product story for replacing manual smoke passes and
    ad hoc exploratory testing with one autonomous workflow.
  </p>
</div>

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">What it replaces</span>
    <h2 class="docs-panel__title">Manual QA work turns into one guided autonomous loop</h2>
    <ul>
      <li>hand-built smoke passes</li>
      <li>click-by-click exploratory testing</li>
      <li>ad hoc bug hunts</li>
      <li>first-draft test authoring</li>
      <li>retrying brittle specs until they pass</li>
    </ul>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">The loop</span>
    <h2 class="docs-panel__title">One prompt in, browser evidence out</h2>
    <div class="docs-terminal">
      <code>diff or prompt</code>
      <code>-> scope with route families and traceability</code>
      <code>-> explore in a real browser</code>
      <code>-> find issues and capture evidence</code>
      <code>-> generate or heal tests when needed</code>
      <code>-> verify and report</code>
    </div>
  </div>
</div>

<div class="command-index">
  <a href="#start-here">Start here</a>
  <a href="#modes">Modes</a>
  <a href="#from-findings-to-tests">From findings to tests</a>
  <a href="#trust-what-it-finds">Trust what it finds</a>
  <a href="#what-you-get">What you get</a>
</div>

## Start Here

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Natural language</span>
    <h2 class="docs-panel__title">Tell the agent what to validate and let it choose the path</h2>
    <div class="docs-terminal">
      <code>/qa test this app at http://localhost:3000</code>
      <code>/qa hunt "checkout flow" on https://staging.example.com</code>
      <code>/qa run a release regression on https://preview.example.com</code>
      <code>/qa verify the healed tests only</code>
    </div>
    <p class="docs-panel__copy">
      The <code>/qa</code> skill is the natural-language front door. It maps the
      request to the right browser-side workflow so the AI can lead the charge
      instead of making you assemble flags by hand.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Direct CLI</span>
    <h2 class="docs-panel__title">Use the engine directly when you want the full browser loop now</h2>
    <div class="docs-terminal">
      <code>npx impact-gate-qa pr --since origin/main --base-url http://localhost:3000</code>
      <code>npx impact-gate-qa hunt "checkout flow" --base-url http://localhost:3000</code>
      <code>npx impact-gate-qa release --base-url http://localhost:3000 --time 30</code>
      <code>npx impact-gate-qa fix --base-url http://localhost:3000</code>
    </div>
    <p class="docs-panel__copy">
      If you already know the mode you want, the CLI gives you the same
      autonomous browser engine without the wrapper.
    </p>
  </div>
</div>

## Modes

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">PR mode</span>
    <h3 class="docs-panel__title">Diff-scoped validation for changed features</h3>
    <ul>
      <li>tests the features that changed in the branch or PR</li>
      <li>uses the diff to stay focused on the real blast radius</li>
      <li>returns findings, evidence, and a verdict for merge decisions</li>
    </ul>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Hunt mode</span>
    <h3 class="docs-panel__title">Deep exploratory testing for bugs and edge cases</h3>
    <ul>
      <li>attacks a named area like checkout, billing, or settings</li>
      <li>lets the AI roam beyond scripted happy paths</li>
      <li>is built for bug hunts, edge cases, and surprise regressions</li>
    </ul>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Release mode</span>
    <h3 class="docs-panel__title">Broader autonomous regression before you ship</h3>
    <ul>
      <li>systematically covers critical flows for a release candidate</li>
      <li>uses the browser loop to gather evidence while it explores</li>
      <li>produces a go / no-go / conditional style outcome</li>
    </ul>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Fix mode</span>
    <h3 class="docs-panel__title">Verification for healed specs and repaired paths</h3>
    <ul>
      <li>re-runs the browser path after repairs or spec updates</li>
      <li>confirms the fix before it is trusted again</li>
      <li>keeps the loop closed instead of leaving a half-finished repair behind</li>
    </ul>
  </div>
</div>

## From Findings To Tests

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Generation</span>
    <h2 class="docs-panel__title">When the browser finds a gap, the same stack can draft the fix</h2>
    <div class="docs-terminal">
      <code>npx impact-gate generate --path . --max-attempts 3</code>
      <code>npx impact-gate heal --path . --traceability-report ./playwright-report.json</code>
      <code>npx impact-gate finalize-generated-tests --path . --create-pr --pr-title "Add E2E tests"</code>
    </div>
    <p class="docs-panel__copy">
      Browser exploration is not the end of the story. Impact Gate can turn the
      discovery into runnable specs, run them, and heal them until the code and
      the evidence agree.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Full autonomy</span>
    <h2 class="docs-panel__title">Let the crew carry the flow from design to generated and healed specs</h2>
    <div class="docs-terminal">
      <code>npx impact-gate crew --workflow full-qa --path . --tests-root ./e2e-tests --since origin/main</code>
      <code>npx impact-gate analyze --path . --generate --heal</code>
    </div>
    <p class="docs-panel__copy">
      Use the full-qa workflow when you want the system to keep moving through
      design, generation, execution, and healing with minimal manual effort.
    </p>
  </div>
</div>

## Trust What It Finds

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Scope control</span>
    <h2 class="docs-panel__title">Deterministic context keeps the browser loop focused</h2>
    <ul>
      <li>route families map changed code to product areas</li>
      <li>traceability data tightens the test-to-file link</li>
      <li>impact and plan decide where the AI should spend time</li>
      <li>the browser loop starts with evidence, not guesswork</li>
    </ul>
  </div>
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Trust controls</span>
    <h2 class="docs-panel__title">Generation and repair stay guarded</h2>
    <ul>
      <li>generation uses discovered API surface instead of invented helpers</li>
      <li>suspicious specs are quarantined instead of trusted automatically</li>
      <li>compiled and smoke-verified output stays in the trusted path</li>
      <li>browser evidence and reports stay visible for review</li>
    </ul>
  </div>
</div>

## What You Get

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Evidence</span>
    <h3 class="docs-panel__title">Findings that are easy to act on</h3>
    <ul>
      <li>screenshots and console errors</li>
      <li>step-by-step browser findings</li>
      <li>health scores and verdicts</li>
      <li>release-readiness context</li>
    </ul>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Artifacts</span>
    <h3 class="docs-panel__title">Outputs you can keep using in CI</h3>
    <ul>
      <li><code>.e2e-ai-agents/qa-summary.md</code></li>
      <li><code>.e2e-ai-agents/qa-report.json</code></li>
      <li><code>.e2e-ai-agents/plan.json</code></li>
      <li>generated and healed Playwright specs</li>
    </ul>
  </div>
</div>

<div class="docs-panel docs-panel--compact">
  <span class="docs-panel__eyebrow">Bottom line</span>
  <h3 class="docs-panel__title">This is the browser QA loop you reach for when you want AI to do the heavy lifting, reduce manual effort, and keep moving until it has both evidence and runnable code.</h3>
</div>

## Related Reading

<div class="command-index">
  <a href="./qa-skill/">QA Skill</a>
  <a href="./crew-workflows/">Crew Workflows</a>
  <a href="./ai-guardrails/">AI Guardrails</a>
  <a href="../concepts/route-families/">Route Families</a>
  <a href="../reference/cli/">CLI Reference</a>
</div>

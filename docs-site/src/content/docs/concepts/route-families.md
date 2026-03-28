---
title: "Route Families"
description: "The knowledge model that connects code changes to features, flows, and tests"
---

<div class="doc-intro">
  <div class="doc-chip">Knowledge model</div>
  <p class="doc-lead">
    A route family ties a user-facing capability to the routes, source paths,
    specs, and flows that own it. Build the manifest with
    <code>train</code> or <code>bootstrap</code>, then refine it until impact
    analysis stays trustworthy.
  </p>
</div>

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">What it captures</span>
    <h2 class="docs-panel__title">One family groups the code and tests behind a product capability</h2>
    <ul>
      <li>URL routes</li>
      <li>frontend paths</li>
      <li>backend paths</li>
      <li>spec directories</li>
      <li>user flows</li>
      <li>priority</li>
    </ul>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Manifest shape</span>
    <h2 class="docs-panel__title">The manifest lives under <code>&lt;testsRoot&gt;/.e2e-ai-agents</code> and uses a top-level <code>families</code> array</h2>
    <div class="docs-terminal">
      <code>{</code>
      <code>  "families": [</code>
      <code>    {</code>
      <code>      "id": "feature_a",</code>
      <code>      "routes": ["/{workspace}/feature-a/{item}"],</code>
      <code>      "webappPaths": ["src/features/feature-a/**"],</code>
      <code>      "serverPaths": ["server/feature-a/**"],</code>
      <code>      "specDirs": ["feature-a"]</code>
      <code>    }</code>
      <code>  ]</code>
      <code>}</code>
    </div>
    <p class="docs-panel__copy">
      For Playwright repos, <code>specDirs</code> are relative to
      <code>--tests-root</code>. For Cypress repos, use
      <code>cypressSpecDirs</code> instead.
    </p>
  </div>
</div>

<div class="command-index">
  <a href="#create-it">Create it</a>
  <a href="#refine-it">Refine it</a>
  <a href="#why-it-matters">Why it matters</a>
  <a href="#when-to-update">When to update</a>
</div>

## Create It

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Train</span>
    <h2 class="docs-panel__title">Scan your codebase and let the scanner propose families</h2>
    <div class="docs-terminal">
      <code>npx impact-gate train --no-enrich --path .</code>
      <code>npx impact-gate train --path .</code>
      <code>npx impact-gate train --validate --since HEAD~50 --path .</code>
    </div>
    <p class="docs-panel__copy">
      Use <code>--no-enrich</code> for the deterministic offline path,
      <code>train</code> for enrichment, and <code>--validate</code> to measure
      coverage against real git history. The default
      <code>--budget-usd</code> is <code>$0.50</code> and the hard cap is
      <code>$10</code>.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Bootstrap</span>
    <h2 class="docs-panel__title">Import route families from an Understand-Anything knowledge graph</h2>
    <div class="docs-terminal">
      <code>npx impact-gate bootstrap --path .</code>
      <code>npx impact-gate bootstrap --kg-path ./knowledge-graph.json</code>
      <code>npx impact-gate bootstrap --dry-run --max-families 30 --path .</code>
    </div>
    <p class="docs-panel__copy">
      Use <code>--kg-path</code> when the graph lives elsewhere,
      <code>--dry-run</code> to preview the manifest, and
      <code>--max-families</code> to keep the first pass focused.
    </p>
  </div>
</div>

## Refine It

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Review loop</span>
    <h2 class="docs-panel__title">Check the manifest against the real product areas</h2>
    <ul>
      <li>Open <code>&lt;testsRoot&gt;/.e2e-ai-agents/route-families.json</code></li>
      <li>Add or tighten <code>webappPaths</code>, <code>serverPaths</code>, and <code>specDirs</code> for unmapped files</li>
      <li>Re-run <code>train --validate</code> until the coverage and confidence look healthy</li>
      <li>Commit the manifest so <code>impact</code>, <code>plan</code>, and the optional AI flows stay grounded</li>
    </ul>
  </div>
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Helpful fields</span>
    <h2 class="docs-panel__title">Use the optional fields to make routing more precise</h2>
    <ul>
      <li><code>priority</code> distinguishes critical flows from lower-risk ones</li>
      <li><code>userFlows</code> turns raw file mappings into readable scenarios</li>
      <li><code>components</code> and <code>pageObjects</code> make generation and review easier</li>
      <li><code>features</code> let one family break into finer-grained bindings</li>
    </ul>
  </div>
</div>

## Why It Matters

<div class="docs-grid docs-grid--two">
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">Better decisions</span>
    <h3 class="docs-panel__title">A strong manifest improves the whole diff-to-test workflow</h3>
    <ul>
      <li>impact analysis accuracy</li>
      <li>release-diff planning</li>
      <li>run-set precision</li>
      <li>gap detection quality</li>
    </ul>
  </div>
  <div class="docs-panel docs-panel--dense">
    <span class="docs-panel__eyebrow">AI grounding</span>
    <h3 class="docs-panel__title">The same manifest keeps generation and QA scoped to the right areas</h3>
    <ul>
      <li>AI generation grounding</li>
      <li>QA-agent scoping</li>
      <li>readable user flows</li>
      <li>more useful coverage guidance</li>
    </ul>
  </div>
</div>

## When To Update

<div class="docs-panel">
  <span class="docs-panel__eyebrow">Update signals</span>
  <h2 class="docs-panel__title">Refine route families whenever the manifest stops matching reality</h2>
  <ul>
    <li>changed files show up as unmapped</li>
    <li>confidence is repeatedly low</li>
    <li>generated plans miss obvious flows</li>
    <li>release diffs feel too broad</li>
    <li>new product areas or test directories appear</li>
  </ul>
</div>

<div class="docs-panel docs-panel--compact">
  <span class="docs-panel__eyebrow">Takeaway</span>
  <h3 class="docs-panel__title">A strong manifest is one of the biggest predictors of whether `impact-gate` feels useful on real diffs.</h3>
</div>

<div class="docs-panel docs-panel--compact">
  <span class="docs-panel__eyebrow">Fallback truth</span>
  <h3 class="docs-panel__title">Heuristic grouping is useful for orientation, but a maintained manifest is still the trusted path for release-ready decisions.</h3>
</div>

## Related Reading

<div class="command-index">
  <a href="../guides/impact-analysis/">Impact Analysis</a>
  <a href="../getting-started/zero-config/">Zero Config</a>
  <a href="../reference/cli/">CLI Reference</a>
</div>

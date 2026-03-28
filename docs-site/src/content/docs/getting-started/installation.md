---
title: "Installation"
description: "Install @yasserkhanorg/impact-gate and verify your setup"
---

<div class="doc-intro">
  <div class="doc-chip">Getting started</div>
  <p class="doc-lead">
    Install the CLI, verify the deterministic workflow first, then add an AI
    provider only when you want generation, healing, or crew workflows.
  </p>
</div>

<div class="docs-grid">
  <div class="docs-panel docs-panel--compact">
    <span class="docs-panel__eyebrow">Requirements</span>
    <h2 class="docs-panel__title">What you need first</h2>
    <ul>
      <li><strong>Node.js &gt;= 20</strong> with an LTS runtime</li>
      <li><strong>Git</strong> for diff-aware analysis</li>
      <li>A repo with Playwright or Cypress tests already in place</li>
    </ul>
  </div>
  <div class="docs-panel docs-panel--terminal docs-panel--feature">
    <span class="docs-panel__eyebrow">First verification</span>
    <h2 class="docs-panel__title">The safest first run is deterministic</h2>
    <div class="docs-terminal">
      <code>npx impact-gate impact --path . --since origin/main</code>
      <code>npx impact-gate plan --path . --since origin/main</code>
      <code>npx impact-gate gate --threshold 80 --path .</code>
    </div>
  </div>
</div>

## Install

Add the package to your project when you want it versioned with the test suite:

```bash
npm install -D @yasserkhanorg/impact-gate
```

Install globally only when you want ad hoc CLI access across many repositories:

```bash
npm install -g @yasserkhanorg/impact-gate
```

## Verify

<div class="docs-steps">
  <div class="docs-step">
    <div class="docs-step__index">01</div>
    <div>
      <h3 class="docs-step__title">Confirm the CLI is available</h3>
      <p class="docs-step__copy">
        Start by checking that the binary resolves and the command surface is
        visible from the current project.
      </p>
    </div>
  </div>
</div>

```bash
npx impact-gate --help
```

You should see the core commands including `impact`, `plan`, `gate`, `train`,
and the optional AI workflows. The best first run is still `impact`, then
`plan`, then `gate`.

## Optional: LLM Provider

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Optional AI</span>
    <h2 class="docs-panel__title">Add a provider only when you want it</h2>
    <p class="docs-panel__copy">
      Crew workflows, test generation, and healing need an LLM provider, but
      the core CI commands do not.
    </p>
  </div>
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Free path</span>
    <h2 class="docs-panel__title">Core commands work without any API key</h2>
    <p class="docs-panel__copy">
      <code>impact</code>, <code>plan</code>, <code>gate</code>,
      <code>train --no-enrich</code>, <code>cost-report</code>, and
      <code>feedback</code> all work on the deterministic path alone.
    </p>
  </div>
</div>

Set one of these environment variables:

```bash
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
export OPENAI_API_KEY=sk-...

# Ollama (free, runs locally)
export OLLAMA_BASE_URL=http://localhost:11434
```

## Verify Provider Connectivity

```bash
npx impact-gate llm-health
```

This probes the configured provider, or the auto-detected provider if you rely on environment discovery, and reports whether it can accept requests and return responses.

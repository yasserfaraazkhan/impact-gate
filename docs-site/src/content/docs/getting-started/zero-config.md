---
title: "Zero Config"
description: "How auto-detection works and when you need a config file"
---

<div class="doc-intro">
  <div class="doc-chip">Auto-detection</div>
  <p class="doc-lead">
    The CLI can infer most of what it needs so you can start with the
    deterministic <code>impact → plan → gate</code> loop before writing a
    config file.
  </p>
</div>

<div class="docs-grid">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Best fit</span>
    <h2 class="docs-panel__title">Zero-config shines in established test repos</h2>
    <p class="docs-panel__copy">
      The most battle-tested path is still a Playwright or Cypress repo with a
      recognizable tests root and a normal git remote.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Typical first run</span>
    <h2 class="docs-panel__title">Let the CLI discover the shape of the repo</h2>
    <div class="docs-terminal">
      <code>npx impact-gate impact --path . --since origin/main</code>
      <code>npx impact-gate plan --path . --since origin/main</code>
    </div>
  </div>
</div>

## What Gets Auto-Detected

### Test Framework

The CLI reads your project files and `package.json` dependencies to detect:
- **Playwright** if `@playwright/test` or `playwright` is present
- **Cypress** if `cypress` is present
- **pytest** if `conftest.py`, `pytest.ini`, or pytest config in `pyproject.toml` / `setup.cfg` is present
- **supertest** if `supertest` is in your npm dependencies (runs via Vitest or Jest)
- **Selenium** if `selenium-webdriver` or `webdriverio` is present

### Tests Root

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Tests root</span>
    <h2 class="docs-panel__title">Directory discovery follows common conventions</h2>
    <p class="docs-panel__copy">
      The first matching directory below becomes <code>--tests-root</code>.
    </p>
    <div class="docs-terminal">
      <code>e2e-tests/playwright, e2e-tests, e2e, tests/e2e</code>
      <code>test/e2e, tests, test, specs, playwright, cypress</code>
    </div>
  </div>
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Git base branch</span>
    <h2 class="docs-panel__title">Diff base is discovered from the remote</h2>
    <p class="docs-panel__copy">
      The CLI queries <code>git remote show origin</code> for the default HEAD
      branch and falls back to the current branch when needed.
    </p>
  </div>
</div>

### Project Root

Walks up from the current directory until it finds `package.json` or `.git`.

## When You Need a Config File

<div class="docs-panel">
  <span class="docs-panel__eyebrow">Use config when the repo needs stronger intent</span>
  <h2 class="docs-panel__title">Reach for config once heuristics are no longer enough</h2>
  <ul>
    <li>Set a <strong>profile</strong> such as <code>strict</code> for tighter gating</li>
    <li>Configure <strong>dependency graph</strong> depth or traceability behavior</li>
    <li>Enable the <strong>pipeline</strong> for test generation</li>
    <li>Define <strong>policy enforcement</strong> such as advisory, warn, or block</li>
    <li>Point to a <strong>separate server path</strong> for backend analysis</li>
    <li>Override framework or tests-root detection when the repo is unusual</li>
  </ul>
</div>

Create `impact-gate.config.json` in your project root when you need to:

If auto-detection gets it wrong, prefer explicit flags or a config file over guessing.

The CLI searches for `impact-gate.config.json` or `.impact-gate.config.json` starting from the current directory and walking upward.

## Bootstrap: Alternative Setup with a Knowledge Graph

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Knowledge graph</span>
    <h2 class="docs-panel__title">Bootstrap route families from existing project knowledge</h2>
    <p class="docs-panel__copy">
      If you already have an Understand-Anything knowledge graph, bootstrap can
      generate the manifest automatically instead of training from scratch.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">Bootstrap</span>
    <h2 class="docs-panel__title">Generate the manifest directly</h2>
    <div class="docs-terminal">
      <code>npx impact-gate bootstrap --path .</code>
      <code>npx impact-gate bootstrap --dry-run --max-families 30</code>
    </div>
  </div>
</div>

If your project already has an [Understand-Anything](https://github.com/nicholasgriffintn/understand-anything) knowledge graph, the `bootstrap` command can generate your route-families manifest automatically instead of running `train`:

```bash
npx impact-gate bootstrap --path .
```

Bootstrap reads the knowledge graph, classifies your project (frontend, backend, or fullstack), and produces `.e2e-ai-agents/route-families.json` with prioritized families derived from the graph's nodes and edges. It also auto-detects your test framework and test mode (`ui`, `api`, or `both`).

Use `--dry-run` to preview the manifest before writing, or `--max-families 30` to limit the output. See the [CLI reference](../reference/cli/#bootstrap) for all flags.

## Explicit Flags Always Win

<div class="docs-panel">
  <span class="docs-panel__eyebrow">Precedence</span>
  <h2 class="docs-panel__title">CLI flags override both config and heuristics</h2>
  <p class="docs-panel__copy">
    When the repo needs a one-off override, use flags directly. They win over
    auto-detected values and the config file.
  </p>
</div>

Any CLI flag overrides both auto-detected values and config file settings:

```bash
npx impact-gate impact \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --framework playwright \
  --since origin/release-9.0
```

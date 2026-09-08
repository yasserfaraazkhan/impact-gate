---
title: "Configuration"
description: "Config file format and all available fields"
---

<div class="doc-intro">
  <div class="doc-chip">Reference</div>
  <p class="doc-lead">
    Use <code>impact-gate.config.json</code> to pin analysis defaults, route the
    tool to the right tests root, and make CI behavior predictable across pull
    requests, release branches, and local runs.
  </p>
</div>

<div class="docs-grid docs-grid--two">
  <div class="docs-panel">
    <span class="docs-panel__eyebrow">Config purpose</span>
    <h2 class="docs-panel__title">Use config when you want repeatable team defaults</h2>
    <p class="docs-panel__copy">
      Auto-detection is great for onboarding, but config is what makes CI,
      release branches, and local runs behave the same way across the team.
    </p>
  </div>
  <div class="docs-panel docs-panel--terminal">
    <span class="docs-panel__eyebrow">File names</span>
    <h2 class="docs-panel__title">The CLI looks for these files automatically</h2>
    <div class="docs-terminal">
      <code>impact-gate.config.json</code>
      <code>.impact-gate.config.json</code>
    </div>
  </div>
</div>

<div class="command-index">
  <a href="#top-level">Top-Level</a>
  <a href="#git"><code>git</code></a>
  <a href="#impact"><code>impact</code></a>
  <a href="#pipeline"><code>pipeline</code></a>
  <a href="#policy"><code>policy</code></a>
  <a href="#advisory"><code>advisory</code></a>
  <a href="#profiles">Profiles</a>
</div>

Create `impact-gate.config.json` (or `.impact-gate.config.json`) in your project root. The CLI auto-discovers it by walking upward from the current directory.

## Full Config Example

```json
{
  "path": ".",
  "profile": "default",
  "testsRoot": "./e2e-tests",
  "mode": "impact",
  "framework": "auto",
  "git": {
    "since": "origin/main"
  },
  "impact": {
    "dependencyGraph": {
      "enabled": true,
      "maxDepth": 3
    },
    "traceability": {
      "enabled": true
    },
    "aiFlow": {
      "enabled": true,
      "provider": "anthropic"
    }
  },
  "pipeline": {
    "enabled": false,
    "scenarios": 3,
    "outputDir": "specs/functional/ai-assisted",
    "mcp": false
  },
  "policy": {
    "enforcementMode": "advisory",
    "blockOnActions": ["must-add-tests"]
  }
}
```

## Field Reference

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | `.` | Project root directory |
| `profile` | string | `default` | Analysis profile: `default` or `strict` |
| `testsRoot` | string | auto-detected | Path to tests directory |
| `mode` | string | `impact` | Default analysis mode |
| `framework` | string | `auto` | Test framework (`playwright`, `cypress`, `pytest`, `supertest`, `selenium`, `auto`) |

### `git`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `since` | string | auto-detected | Git ref for diff base (e.g., `origin/main`) |

### `impact`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dependencyGraph.enabled` | boolean | `true` | Enable static reverse-dependency analysis |
| `dependencyGraph.maxDepth` | number | `3` | Max depth for transitive impact traversal |
| `traceability.enabled` | boolean | `true` | Use CI execution data for file-to-test mapping |
| `aiFlow.enabled` | boolean | `true` | Enable LLM-powered flow mapping |
| `aiFlow.provider` | string | `auto` | LLM provider for AI enrichment |

### `pipeline`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable test generation pipeline |
| `scenarios` | number | `3` | Number of test scenarios to generate per gap |
| `outputDir` | string | — | Directory for generated specs |
| `mcp` | boolean | `false` | Use Playwright MCP server for generation |

### `policy`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enforcementMode` | string | `advisory` | `advisory`, `warn`, or `block` |
| `blockOnActions` | string[] | `[]` | Actions that trigger blocking (`run-now`, `must-add-tests`, `safe-to-merge`) |

### `advisory`

The isolated `plan --advisory` caller requires this top-level object and a `--suite` ID. See the [Mattermost guide](../../guides/mattermost-advisory/) and [source configuration](https://github.com/yasserfaraazkhan/impact-gate/blob/master/examples/mattermost/advisory.config.json).

| Field | Required value |
| --- | --- |
| `repository` | GitHub `owner/repo`, matching the checkout origin |
| `sourcePatterns` | Repository-relative product-source globs |
| `crossCuttingPatterns` | Repository-relative globs that require full fallback |
| `suites` | Distinct entries with `id`, `framework`, `root`, `configFile`, `project`, `browser`, `variant`, `specPattern`, and optional `exclude` |
| `mappings` | Candidate entries with `sourcePattern`, suite ID, exact `specs`, and declared `provenance: {kind, evidence}`; may be empty |

Spec patterns and exclusions are relative to the suite root and include dot paths. Absolute paths, traversal and leading `!`/`#` patterns are rejected. Configuration is read as data, not evaluated as framework code. Declared human review, static inference and co-change evidence remain unverified; every nonempty diff retains full fallback. The report fingerprints the inputs but does not authenticate their reviewer or runtime environment.

`policy.enforcementMode: "advisory"` only changes ordinary plan enforcement. It does not activate the isolated, provider-free, no-write contract; use the CLI `--advisory` flag for that.

## Profiles

<div class="reference-grid">
  <div class="reference-card">
    <span class="reference-card__eyebrow">Profile</span>
    <h3><code>default</code></h3>
    <p>Standard analysis behavior for most repositories.</p>
  </div>
  <div class="reference-card">
    <span class="reference-card__eyebrow">Profile</span>
    <h3><code>strict</code></h3>
    <p>
      Uses stricter handling for heuristic-only mappings and more opinionated
      analysis defaults when you want tighter gating.
    </p>
  </div>
</div>

Framework auto-detection is separate from profiles. The CLI can auto-detect Playwright, Cypress, pytest, supertest, and Selenium usage from project files and dependencies.

## Precedence

CLI flags override config file values, which override auto-detected defaults.

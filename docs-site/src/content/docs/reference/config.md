---
title: "Configuration"
description: "Config file format and all available fields"
---

Create `e2e-ai-agents.config.json` (or `.e2e-ai-agents.config.json`) in your project root. The CLI auto-discovers it by walking upward from the current directory.

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
| `profile` | string | `default` | Analysis profile (`default` or `mattermost`) |
| `testsRoot` | string | auto-detected | Path to tests directory |
| `mode` | string | `impact` | Default analysis mode |
| `framework` | string | `auto` | Test framework (`playwright`, `cypress`, `auto`) |

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
| `aiFlow.provider` | string | `anthropic` | LLM provider for AI enrichment |

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

## Profiles

- **`default`** -- standard analysis with configurable strictness
- **`mattermost`** -- strict mode with escalation for heuristic-only mappings, tuned for Mattermost's codebase structure

## Precedence

CLI flags override config file values, which override auto-detected defaults.

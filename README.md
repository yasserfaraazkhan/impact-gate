# @yasserkhanorg/e2e-agents

AI-powered E2E test impact analysis, generation, healing, and autonomous QA for frontend repositories.

[![npm](https://img.shields.io/npm/v/%40yasserkhanorg%2Fe2e-agents)](https://www.npmjs.com/package/@yasserkhanorg/e2e-agents)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/github-yasserfaraazkhan%2Fe2e--agents-blue?logo=github)](https://github.com/yasserfaraazkhan/e2e-agents)

## What It Does

Given a git diff, `e2e-ai-agents` determines which E2E test flows are impacted, identifies coverage gaps, and can generate or heal Playwright tests — all from the CLI. The companion `e2e-qa-agent` goes further: it opens a real browser, explores your app autonomously, and produces a QA report with findings and a release-readiness verdict.

**Pipeline:** `impact` → `plan` → `generate` → `heal` → `finalize`

## Installation

```bash
npm install @yasserkhanorg/e2e-agents
```

Requires Node.js >= 20. Ships both CommonJS and ESM builds.

## CLI Commands

```bash
# All-in-one: impact + plan + optional generate/heal
npx e2e-ai-agents analyze --path /path/to/project [--generate] [--heal]

# Analyze which flows are impacted by code changes
npx e2e-ai-agents impact --path /path/to/project

# Generate a coverage plan with gap analysis
npx e2e-ai-agents plan --path /path/to/project

# Generate tests for uncovered gaps (requires plan output)
npx e2e-ai-agents generate --path /path/to/project

# Heal flaky/failing specs from a Playwright report
npx e2e-ai-agents heal --path /path/to/project --traceability-report ./playwright-report.json

# Stage generated tests, commit, and open a PR
npx e2e-ai-agents finalize-generated-tests --path /path/to/project --create-pr

# Ingest test execution data for traceability
npx e2e-ai-agents traceability-capture --path /path/to/project --traceability-report ./playwright-report.json
npx e2e-ai-agents traceability-ingest --path /path/to/project --traceability-input ./traceability-input.json

# Ingest recommendation feedback for calibration
npx e2e-ai-agents feedback --path /path/to/project --feedback-input ./feedback.json

# Test LLM provider connectivity
npx e2e-ai-agents llm-health
```

`plan` and `suggest` are aliases. `analyze` is a convenience wrapper that runs impact + plan and optionally generation/healing in one invocation. Use `--help` for all available flags.

## Route-Families Training

Route-families map your source files to features, test directories, and user flows. They are the context that powers accurate impact analysis. The `train` command bootstraps and maintains this manifest.

```bash
# Scan your codebase + LLM enrichment (default)
npx e2e-ai-agents train --path /path/to/project

# Offline mode (no LLM, no API key needed)
npx e2e-ai-agents train --path /path/to/project --no-enrich

# Validate accuracy against recent git history
npx e2e-ai-agents train --path /path/to/project --validate --since HEAD~50

# Full pipeline: scan + enrich + validate
npx e2e-ai-agents train --path /path/to/project --validate --since HEAD~20
```

**Why LLM enrichment is on by default:** The manifest exists to give AI context for impact analysis, scenario suggestion, and bug detection. AI-generated context produces better AI reasoning downstream. Use `--no-enrich` for offline/free operation or to avoid sending code snippets to third-party LLM APIs.

**Training loop:** Run `train` → review the generated `route-families.json` → run `train --validate` to check coverage % → fix gaps → repeat.

The `train` command:
1. **Scans** your project structure (frontend `src/`, backend `server/`, test dirs, test library page objects, types/utils)
2. **Matches** source directories to test directories by name, including fuzzy singular/plural matching
3. **Discovers** server-derived families from Go three-tier architecture (api4, app, store)
4. **Discovers** test-derived families from feature-organized test directories
5. **Enriches** with LLM (priority, user flows, routes, components)
6. **Merges** intelligently with any existing manifest (preserves human curation)
7. **Validates** against git history to measure accuracy with monorepo-aware path normalization

**Additional flags:**
- `--verbose` / `-v` — DEBUG-level output with timing for each phase
- `--json` — structured JSON log output (for CI pipelines)
- `--server-path` — explicit path to backend server root
- `--budget-usd` — max LLM spend (default: $0.50, max: $10)

**Output:**
- `<testsRoot>/.e2e-ai-agents/route-families.json` — the manifest
- `<testsRoot>/.e2e-ai-agents/train-report.json` — timing data, family counts, coverage stats, LLM metrics

## Configuration

Create `e2e-ai-agents.config.json` in your project (auto-discovered):

```json
{
  "path": ".",
  "profile": "mattermost",
  "testsRoot": ".",
  "mode": "impact",
  "framework": "auto",
  "git": { "since": "origin/master" },
  "impact": {
    "dependencyGraph": { "enabled": true, "maxDepth": 3 },
    "traceability": { "enabled": true },
    "aiFlow": { "enabled": true, "provider": "anthropic" }
  },
  "pipeline": {
    "enabled": false,
    "scenarios": 3,
    "outputDir": "specs/functional/ai-assisted",
    "mcp": false
  },
  "policy": {
    "enforcementMode": "block",
    "blockOnActions": ["must-add-tests"]
  }
}
```

Key options:

- **`testsRoot`** — path to tests when they live outside the app root
- **`profile`** — `default` or `mattermost` (strict mode with escalation for heuristic-only mappings)
- **`impact.dependencyGraph`** — static reverse dependency graph for transitive impact
- **`impact.traceability`** — file-to-test mapping from CI execution data
- **`impact.aiFlow`** — LLM-powered flow mapping (requires `ANTHROPIC_API_KEY`)
- **`pipeline.mcp`** — use Playwright MCP server for browser-aware generation/healing
- **`policy.enforcementMode`** — `advisory`, `warn`, or `block`

## CI Integration

### GitHub Actions

```yaml
- name: Run E2E coverage check
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    npx e2e-ai-agents plan \
      --config ./e2e-ai-agents.config.json \
      --since origin/${{ github.base_ref }} \
      --fail-on-must-add-tests \
      --github-output "$GITHUB_OUTPUT"
```

The `plan` command writes:
- `.e2e-ai-agents/plan.json` — structured plan with `runSet`, `confidence`, `decision`
- `.e2e-ai-agents/ci-summary.md` — markdown summary for PR comments
- `.e2e-ai-agents/metrics-summary.json` — run metrics

Use `--fail-on-must-add-tests` to exit non-zero when uncovered P0/P1 gaps exist. Use `--github-output` to expose outputs to subsequent workflow steps.

See [examples/github-actions/pr-impact.yml](examples/github-actions/pr-impact.yml) for a complete workflow template.

## Pipeline Modes

### Package Native (default)

Strategy-based Playwright test templates with quality guardrails (no `test.describe`, single tag) and iterative heal attempts.

### MCP Mode (`--pipeline-mcp`)

Uses the official Playwright Test Agent loop (planner/generator/healer) with Claude CLI orchestration. Validates generated specs against discovered local API surface to block hallucinated methods.

- **`--pipeline-mcp-only`** — fail if MCP setup fails (no silent fallback)
- **`--pipeline-mcp-allow-fallback`** — fall back to package-native if MCP unavailable
- **`--pipeline-mcp-timeout-ms`** — per-command timeout
- **`--pipeline-mcp-retries`** — retry count for transient failures

### Agentic Generation (`generate` command)

LLM-powered generate-run-fix loop: generates a spec, runs it, analyzes failures, and iterates up to `--max-attempts` times.

## LLM Providers

Used internally for AI enrichment, test generation, and healing.

```bash
# Anthropic (default)
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
export OPENAI_API_KEY=sk-...

# Ollama (free, local)
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=deepseek-r1:7b
```

Programmatic provider usage:

```typescript
import { AnthropicProvider } from '@yasserkhanorg/e2e-agents';

const claude = new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY
});
const response = await claude.generateText('Analyze test failure');
```

Factory pattern with auto-detection, hybrid mode (free local + premium fallback), and custom OpenAI-compatible endpoints are also supported. See the [provider API exports](src/index.ts) for full details.

## MCP Server

Exposes 6 tools for test agents (Playwright v1.56+):

```typescript
import { E2EAgentsMCPServer } from '@yasserkhanorg/e2e-agents/mcp';

const server = new E2EAgentsMCPServer();
// Tools: discover_tests, read_file, write_file, run_tests, get_git_changes, get_repository_context
```

Security: `write_file` is restricted to test spec files (`*.spec.ts`, `*.test.ts`) and the `.e2e-ai-agents/` directory. Path traversal and symlink escape are blocked. Rate limited to 100 requests/minute.

## Traceability

Build file-to-test mappings from CI execution data:

1. **Capture** — extract test-file relationships from Playwright JSON reports
2. **Ingest** — merge into a rolling manifest (`.e2e-ai-agents/traceability.json`)
3. **Query** — impact analysis uses the manifest to map changed files to relevant tests

Tuning flags: `--traceability-min-hits`, `--traceability-max-files-per-test`, `--traceability-max-age-days`.

Schemas: [schemas/traceability-input.schema.json](schemas/traceability-input.schema.json)

## Artifacts

| File | Written by | Purpose |
|------|-----------|---------|
| `route-families.json` | `train` | Route family manifest |
| `train-report.json` | `train` | Training timings, coverage, LLM metrics |
| `plan.json` | `plan` | Coverage plan with gaps, decisions, metrics |
| `ci-summary.md` | `plan` | Markdown for PR comments |
| `metrics.jsonl` | `plan` | Append-only run metrics |
| `metrics-summary.json` | `plan` | Aggregated metrics |
| `traceability.json` | `traceability-ingest` | File-to-test manifest |
| `traceability-state.json` | `traceability-ingest` | Rolling counts |
| `feedback.json` | `feedback` | Recommendation outcomes |
| `calibration.json` | `feedback` | Precision/recall calibration |
| `flaky-tests.json` | `feedback` | Flaky test scores |
| `agentic-summary.json` | `generate` | Agentic generation results |

All written under `<testsRoot>/.e2e-ai-agents/`.

## Autonomous QA Agent (`e2e-qa-agent`)

An autonomous QA engineer that opens a real browser, navigates to changed features, tries edge cases, and produces a findings report — all unsupervised. Built on top of `agent-browser` and the Anthropic tool-use API.

### Quick Start

```bash
# PR mode — test features changed since origin/main
npx e2e-qa-agent pr --since origin/main --base-url http://localhost:8065

# Hunt mode — deep-test a specific area
npx e2e-qa-agent hunt "channel settings" --base-url http://localhost:8065

# Release mode — systematic exploration of all critical flows
npx e2e-qa-agent release --base-url http://localhost:8065 --time 30

# Fix mode — verify healed specs
npx e2e-qa-agent fix --base-url http://localhost:8065
```

### Architecture

1. **Phase 1 (Script)** — Runs `e2e-ai-agents impact/plan` to determine scope, then executes matched Playwright specs.
2. **Phase 2 (Explore)** — LLM-driven browser loop: observe (accessibility snapshot) → think → act (click/fill/navigate) → record findings. Includes stuck detection, multi-user testing, console error capture, and vision-based analysis.
3. **Phase 3 (Report)** — Generates a structured report with findings, per-flow sign-off, and a release-readiness verdict (go/no-go/conditional).

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--base-url` | `http://localhost:8065` | Application URL |
| `--time` | `15` | Time limit in minutes |
| `--budget` | `2.00` | Max LLM spend in USD |
| `--phase` | `all` | Run only `1`, `2`, or `3` |
| `--headed` | off | Keep browser visible |
| `--since` | — | Git ref for diff-based scoping |
| `--tests-root` | — | Path to Playwright tests directory |

Requires `agent-browser` CLI (`npm install -g agent-browser`) and `ANTHROPIC_API_KEY`.

## Production Usage

Used by [Mattermost](https://github.com/mattermost/mattermost) for CI-integrated E2E coverage gating, test generation, and spec healing. See the [Mattermost Playwright integration](https://github.com/mattermost/mattermost/tree/master/e2e-tests/playwright) for a real-world example.

## License

Apache 2.0

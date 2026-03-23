# @yasserkhanorg/e2e-agents

AI-powered E2E test impact analysis, generation, healing, and autonomous QA for any project with route families — not just Mattermost.

[![npm](https://img.shields.io/npm/v/%40yasserkhanorg%2Fe2e-agents)](https://www.npmjs.com/package/@yasserkhanorg/e2e-agents)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/github-yasserfaraazkhan%2Fe2e--agents-blue?logo=github)](https://github.com/yasserfaraazkhan/e2e-agents)

## What It Does

Given a git diff, `e2e-ai-agents` determines which E2E test flows are impacted, identifies coverage gaps, and can generate or heal tests for Playwright, Cypress, pytest (Python), or supertest/vitest (Node.js API) — all from the CLI. The tool is project-agnostic: any codebase with a `route-families.json` manifest works out of the box. The companion `e2e-qa-agent` goes further: it opens a real browser, explores your app autonomously, and produces a QA report with findings and a release-readiness verdict.

**Pipeline:** `impact` → `plan` → `generate` → `heal` → `finalize`
**Multi-Agent Crew:** `impact` + `cross-impact` + `regression-advisor` → `strategist` → `test-designer` → `generator` → `executor` → `healer`

> **How does this compare to other tools?** See [docs/comparison.md](docs/comparison.md) for a detailed analysis against Launchable, Codecov ATS, Qodo, Testsigma, mabl, GitHub Copilot, and others.

## Free Tier

These commands work with **zero LLM cost** — no API key required:

| Command | What It Does |
|---------|-------------|
| `impact` | Deterministic impact analysis from git diff |
| `plan` | Coverage gap detection and test recommendations |
| `train --no-enrich` | Build route-families manifest (scanner only) |
| `bootstrap` | Generate route-families.json from a knowledge graph (deterministic) |
| `gate` | CI coverage gate — exit 1 if coverage is below threshold |
| `traceability-capture` | Extract test-file relationships from Playwright JSON |
| `traceability-ingest` | Merge traceability mappings into rolling manifest |
| `feedback` | Ingest recommendation outcomes for calibration |
| `cost-report` | View LLM cost breakdown from past runs |

AI-powered features (crew workflows, test generation, healing) require an API key from [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), or a local [Ollama](https://ollama.ai/) instance (free).

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

# Bootstrap route-families.json from an Understand-Anything knowledge graph
npx e2e-ai-agents bootstrap --path <project-root> [--kg-path <path>] [--test-mode ui|api|both] [--max-families <n>] [--dry-run]

# CI coverage gate — fails with exit code 1 if coverage is below threshold
npx e2e-ai-agents gate --path <project-root> [--threshold <0-100>]

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

## Multi-Agent Crew

The Crew orchestrates 10 specialized agents for deep test analysis. While the standard pipeline gives a fast pass/fail gate, the Crew produces structured test designs, cross-family impact maps, and prioritized test strategies.

```bash
# Quick strategy: impact + strategy recommendations (~$0.10, ~1 min)
npx e2e-ai-agents crew --workflow quick-check --path /path/to/project --tests-root ./e2e-tests --since origin/master

# Full test design without generation (~$0.50-2.00, ~5-40 min)
npx e2e-ai-agents crew --workflow design-only --path /path/to/project --tests-root ./e2e-tests --since origin/master

# End-to-end: design + generate + execute + heal (~$2-5, ~10-60 min)
npx e2e-ai-agents crew --workflow full-qa --path /path/to/project --tests-root ./e2e-tests --since origin/master

# With budget cap and JSON output
npx e2e-ai-agents crew --workflow design-only --budget-usd 2.00 --json --path /path/to/project --tests-root ./e2e-tests --since origin/master

# Dry run: preview what would happen without LLM calls
npx e2e-ai-agents crew --workflow design-only --dry-run --path /path/to/project --tests-root ./e2e-tests --since origin/master

# View LLM cost breakdown
npx e2e-ai-agents cost-report --path /path/to/project
```

### Budget Enforcement

The `--budget-usd` flag sets a hard cost limit for the entire crew run. Budget enforcement uses a **pre-reservation** model (like credit card authorization holds) to prevent parallel agents from overshooting:

1. Before each LLM call, the provider **reserves** estimated cost in a shared ledger
2. Other parallel agents see the in-flight hold and stop if the budget would be exceeded
3. After the call completes, the reservation is **settled** to actual cost

This means 3 agents running in parallel against a $1.00 budget will not collectively spend $1.20. The overshoot is bounded by the estimation error of a single call (~$0.01).

### Resilience

Provider calls are protected by a **circuit breaker** (3-failure threshold, 60s cooldown). If a provider goes down, calls fail fast instead of burning through retry timeouts. Circuit breakers are shared per provider type — if Anthropic is down, all agents discover it after 3 total failures.

Only transient errors (429, 5xx, network) trip the circuit. Budget exceeded and auth errors do not.

### Plugins

External agents can register into crew workflows via the `plugins` config:

```typescript
// my-plugin.ts
import type { AgentPlugin, AgentTask, AgentResult, CrewContext } from '@yasserkhanorg/e2e-agents';

const myPlugin: AgentPlugin = {
    role: 'my-custom-analyzer',
    phase: 'understand',              // Run in the 'understand' phase
    runAfter: ['impact-analyst'],     // After impact-analyst completes
    async execute(task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        // Access ctx.impactedFlows, ctx.changedFiles, etc.
        return { role: 'my-custom-analyzer', status: 'success', output: null, warnings: [] };
    },
};
export default myPlugin;
```

```bash
npx e2e-ai-agents crew --plugins ./my-plugin.ts --workflow full-qa --path ./app
```

Plugins with `runAfter` dependencies run sequentially after their dependencies. Plugins without `runAfter` run in parallel with other agents in their phase. Plugin paths must be relative and cannot escape the workspace directory.

See [docs/PLUGIN_API_STABILITY.md](docs/PLUGIN_API_STABILITY.md) for the full API contract and stability guarantees.

### What the Crew Adds Beyond the Pipeline

| Capability | Pipeline | Crew |
|-----------|---------|------|
| Impact detection | Per-family, isolated | Same + cross-family ripple detection |
| Test scenarios | Flat `scenariosToAdd` strings | Structured `TestCase[]` with type, preconditions, steps, expected outcome, rationale |
| Test categories | None | 9: happy-path, edge-case, boundary, negative, state-transition, race-condition, permission, accessibility, performance |
| Strategy | None | Per-flow approach (full-test / smoke-test / skip) with priority and rationale |
| Regression awareness | None | Risk scoring from flaky history, calibration data, and file-pattern heuristics |

### Programmatic API

```typescript
import { CrewOrchestrator, ImpactAnalystAgent, StrategistAgent, TestDesignerAgent, CrossImpactAgent, RegressionAdvisorAgent } from '@yasserkhanorg/e2e-agents';

const orchestrator = new CrewOrchestrator();
orchestrator.registerAgent(new ImpactAnalystAgent());
orchestrator.registerAgent(new CrossImpactAgent());
orchestrator.registerAgent(new RegressionAdvisorAgent());
orchestrator.registerAgent(new StrategistAgent());
orchestrator.registerAgent(new TestDesignerAgent());

const result = await orchestrator.run({
    appPath: './webapp',
    testsRoot: './e2e-tests',
    gitSince: 'origin/master',
    workflow: 'design-only',
});

console.log(result.context.testDesigns);   // Structured test cases
console.log(result.context.crossImpacts);  // Cross-family links
console.log(result.context.strategyEntries); // Prioritized strategy
```

## Route-Families Training

### What it produces

The `train` command builds a **knowledge map** of your codebase — a single JSON file (`route-families.json`) that maps source files to features, test directories, and user flows. This is not ML training; no model is trained. It's building a structured manifest like:

```json
{
  "id": "channels",
  "routes": ["/{team}/channels/{channel}"],
  "priority": "P0",
  "webappPaths": ["src/components/channel_header/**"],
  "serverPaths": ["server/channels/api4/channel*.go", "server/channels/app/channel*.go"],
  "specDirs": ["specs/functional/channels/"],
  "userFlows": ["Create channel", "Archive channel", "Search in channel"],
  "components": ["ChannelHeader", "ChannelSidebar"]
}
```

### Why the tool needs this

When a PR changes `server/channels/app/channel.go`, the tool needs to answer: **"which E2E tests should I run?"** Without the manifest, it has no idea. With it:

```
channel.go changed
  → belongs to "channels" family
    → specs are in specs/functional/channels/
      → run those tests
      → flag if coverage is missing for the affected user flows
```

Every downstream command (`impact`, `plan`, `generate`, `heal`, `e2e-qa-agent`) reads this manifest to understand the codebase.

### How scanning works

The scanner uses 4 strategies to build the `file → family` mapping:

1. **Directory matching** — `src/channels/` + `tests/channels/` share a name → channels family
2. **Test-derived** — `specs/functional/channels/drafts/` exists with spec files → drafts family (even if source code is scattered across components/actions/reducers)
3. **Server-derived** — `api4/channel.go` + `app/channel.go` + `store/channel_store.go` span 3 backend tiers → channel family (related files like `channel_bookmark.go` are grouped under the parent)
4. **Name-matched** — `src/utils/channels.ts` or `server/public/model/channel.go` basename matches → add to channels family's paths

### What LLM enrichment adds

The scanner finds files. The LLM reads code samples and adds **semantic metadata** the scanner can't determine:
- Accurate URL routes (`/{team}/channels/{channel}` instead of guessed `/channels`)
- Priority classification (P0 critical user flow vs P2 nice-to-have)
- Human-readable user flows ("Create channel", "Search messages")
- React component and page object names

This metadata makes impact analysis smarter — it can prioritize P0 flows and suggest specific test scenarios.

### What validation does

The `--validate` flag measures manifest accuracy against **real git history**. It's not training data — it's a quality check:

```
835 commits → 5105 changed files → 3223 bound to a family = 63% coverage
```

This tells you the manifest is complete enough. If coverage were 30%, impact analysis would be blind to most code changes.

### Usage

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

**Why LLM enrichment is on by default:** The manifest gives AI context for impact analysis, scenario suggestion, and bug detection. AI-generated context produces better AI reasoning downstream. Use `--no-enrich` for offline/free operation or to avoid sending code snippets to third-party LLM APIs.

**Training loop:** Run `train` → review `route-families.json` → run `train --validate` to check coverage % → fix gaps → repeat.

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

### Generation Profiles

The tool auto-detects your project type and generates tests following the appropriate conventions. Use the `--profile` flag (or the `profile` config key) to select a profile explicitly:

| Profile | Description |
|---------|-------------|
| `mattermost` | Mattermost-specific conventions (strict mode, escalation for heuristic-only mappings) |
| `generic` | Generic Playwright project |
| `pytest` | Python projects using pytest + requests/httpx |
| `supertest` | Node.js API projects using supertest/vitest |

When `--profile` is omitted, the tool inspects `package.json`, `pyproject.toml`, and test directory structure to pick the best match automatically.

### Key options

- **`testsRoot`** — path to tests when they live outside the app root
- **`profile`** — `mattermost`, `generic`, `pytest`, or `supertest` (auto-detected when omitted)
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

Strategy-based test templates for Playwright, Cypress, pytest, or supertest/vitest with quality guardrails and iterative heal attempts.

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

The tool works with any project that has a `route-families.json` manifest — frontend, backend, or full-stack. Used in production by [Mattermost](https://github.com/mattermost/mattermost) for CI-integrated E2E coverage gating, test generation, and spec healing. See the [Mattermost Playwright integration](https://github.com/mattermost/mattermost/tree/master/e2e-tests/playwright) for a real-world example.

## License

Apache 2.0

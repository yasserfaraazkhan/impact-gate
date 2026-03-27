# @yasserkhanorg/impact-gate

Diff-aware E2E impact analysis and coverage gating for Playwright/Cypress teams. Optional AI features can suggest, generate, and heal tests once your project has a route-families.json manifest.

[![npm](https://img.shields.io/npm/v/%40yasserkhanorg%2Fimpact-gate)](https://www.npmjs.com/package/@yasserkhanorg/impact-gate)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/github-repo-blue?logo=github)](https://github.com/yasserfaraazkhan/impact-gate)

## What It Does

`impact-gate` is built first for one painful CI job: given a git diff, tell us which E2E surface changed and whether the current suite already covers it.

- **Primary**: diff-aware E2E impact analysis and coverage gating
- **Secondary**: optional AI features can suggest, generate, and heal tests once your project has a route-families.json manifest
- **Tertiary**: crew workflows, MCP integrations, plugins, and the autonomous QA agent

The clearest path today is a Playwright or Cypress repository with a maintained `route-families.json` manifest. That is the path this package is optimized to make unusually clear and useful.

Transition note:
- The package and primary CLI are being renamed to `impact-gate`.
- Legacy CLI aliases (`e2e-ai-agents`, `e2e-qa-agent`, `e2e-agents-mcp`) still work during migration.
- Legacy config filenames are still supported.
- The `.e2e-ai-agents/` artifact directory remains unchanged for compatibility.

## Product Shape

| Level | Commands | What They Are For |
|------|----------|-------------------|
| Core CI Workflow | `impact`, `plan`, `gate` | Decide what changed, what is covered, and whether a PR should pass |
| Optional AI Workflow | `generate`, `heal`, `analyze`, `finalize-generated-tests` | Suggest, create, or repair tests after impact analysis |
| Setup and Calibration | `train`, `bootstrap`, `traceability-*`, `feedback`, `cost-report`, `llm-health` | Build the manifest, feed execution data back in, and inspect cost/provider health |
| Advanced / Experimental | `crew`, MCP mode, plugins, `impact-gate-qa` | Deeper orchestration and browser-driven workflows beyond the core CI loop |

## Known Limitations

- The clearest, most stable workflow is still **Playwright/Cypress impact analysis and gating**.
- AI generation and healing work best **after** the project has a good `route-families.json` manifest.
- Advanced features are improving, but they are **not** the best entry point if you only want dependable CI coverage decisions.
- The Mattermost profile is still the most opinionated path in the codebase. Generic flows are supported, but the package should be judged first on the core CI workflow above.

## Free Tier

These commands work with **zero LLM cost** and do not require an API key:

| Command | What It Does |
|---------|-------------|
| `impact` | Deterministic impact analysis from a git diff |
| `plan` | Coverage-gap detection and recommended run set |
| `gate` | CI coverage gate that exits non-zero below a threshold |
| `train --no-enrich` | Build `route-families.json` with the scanner only |
| `bootstrap` | Generate `route-families.json` from a knowledge graph |
| `traceability-capture` | Extract test-file relationships from Playwright JSON |
| `traceability-ingest` | Merge traceability mappings into rolling manifest |
| `feedback` | Ingest recommendation outcomes for calibration |
| `cost-report` | View LLM cost breakdown from past runs |

Optional AI features use [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), or a local [Ollama](https://ollama.ai/) instance.

## Start Here

The fastest way to evaluate the package is the deterministic CI path. These commands do not require an API key.

Install the package:

```bash
npm install @yasserkhanorg/impact-gate
```

Requires Node.js >= 20. Ships both CommonJS and ESM builds.

Verify the CLI:

```bash
npx impact-gate --help
```

Then run the core CI workflow:

```bash
# 1. See what changed
npx impact-gate impact --path /path/to/project --since origin/main

# 2. Build a coverage plan and CI summary artifacts
npx impact-gate plan --path /path/to/project --since origin/main

# 3. Fail the job if coverage is below a threshold
npx impact-gate gate --path /path/to/project --threshold 80
```

Notes:

- `impact` prints a deterministic summary to stdout.
- `plan` writes `.e2e-ai-agents/plan.json` and `.e2e-ai-agents/ci-summary.md`.
- `gate` expects a threshold in the range `0-100` and exits `1` when the threshold is missed.
- Add the Optional AI Workflow only after your `route-families.json` manifest is useful enough to trust.

## Setup and Calibration

These commands help the core CI workflow become accurate and project-aware.

```bash
# Build the manifest from the repo structure
npx impact-gate train --path /path/to/project --no-enrich

# Or bootstrap it from an Understand-Anything knowledge graph
npx impact-gate bootstrap --path /path/to/project [--kg-path ./knowledge-graph.json]

# Feed execution data back into the manifest
npx impact-gate traceability-capture --path /path/to/project --traceability-report ./playwright-report.json
npx impact-gate traceability-ingest --path /path/to/project --traceability-input ./traceability-input.json

# Calibration and diagnostics
npx impact-gate feedback --path /path/to/project --feedback-input ./feedback.json
npx impact-gate cost-report --path /path/to/project
npx impact-gate llm-health
```

## Optional AI Workflow

Once impact analysis is useful and the manifest is in place, you can layer on AI assistance.

```bash
# All-in-one wrapper: impact + coverage + optional generation/healing
npx impact-gate analyze --path /path/to/project [--generate] [--heal]

# Generate tests for uncovered gaps
npx impact-gate generate --path /path/to/project

# Heal flaky or failing specs from a Playwright report
npx impact-gate heal --path /path/to/project --traceability-report ./playwright-report.json

# Stage generated tests, commit, and optionally open a PR
npx impact-gate finalize-generated-tests --path /path/to/project --create-pr
```

`plan` and `suggest` are aliases. `analyze` is the convenience wrapper when you want the full path in one invocation.

## Advanced / Experimental

These features are real, but they are not the clearest place to start if your goal is simple CI coverage decisions.

### Multi-Agent Crew

The Crew orchestrates deeper multi-agent workflows on top of the same impact-analysis foundation. Use it when you want richer strategy output, structured test design, or end-to-end generation pipelines.

```bash
# Quick strategy recommendations
npx impact-gate crew --workflow quick-check --path /path/to/project --tests-root ./e2e-tests --since origin/master

# Full design-only workflow
npx impact-gate crew --workflow design-only --path /path/to/project --tests-root ./e2e-tests --since origin/master

# End-to-end workflow
npx impact-gate crew --workflow full-qa --path /path/to/project --tests-root ./e2e-tests --since origin/master
```

Built-in safeguards include budget enforcement, provider circuit breaking, and structured output for downstream tooling.

### Plugins

External agents can register into crew workflows via the `plugins` config:

```typescript
import type {AgentPlugin, AgentTask, AgentResult, CrewContext} from '@yasserkhanorg/impact-gate';

const myPlugin: AgentPlugin = {
    role: 'my-custom-analyzer',
    phase: 'understand',
    runAfter: ['impact-analyst'],
    async execute(task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
        return {role: 'my-custom-analyzer', status: 'success', output: null, warnings: []};
    },
};

export default myPlugin;
```

```bash
npx impact-gate crew --plugins ./my-plugin.ts --workflow full-qa --path ./app
```

See [docs/PLUGIN_API_STABILITY.md](docs/PLUGIN_API_STABILITY.md) for the API contract and stability guarantees.

### Programmatic API

```typescript
import {
    CrewOrchestrator,
    ImpactAnalystAgent,
    CrossImpactAgent,
    RegressionAdvisorAgent,
    StrategistAgent,
    TestDesignerAgent,
} from '@yasserkhanorg/impact-gate';

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

console.log(result.context.strategyEntries);
console.log(result.context.testDesigns);
console.log(result.context.crossImpacts);
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

Every downstream command (`impact`, `plan`, `generate`, `heal`, `impact-gate-qa`) reads this manifest to understand the codebase.

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
npx impact-gate train --path /path/to/project

# Offline mode (no LLM, no API key needed)
npx impact-gate train --path /path/to/project --no-enrich

# Validate accuracy against recent git history
npx impact-gate train --path /path/to/project --validate --since HEAD~50

# Full pipeline: scan + enrich + validate
npx impact-gate train --path /path/to/project --validate --since HEAD~20
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

Create `impact-gate.config.json` in your project (auto-discovered):

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

### Analysis Profiles

Profiles are not the same thing as frameworks. They control analysis strictness and project-specific conventions.

| Profile | Description |
|---------|-------------|
| `default` | Standard analysis behavior for most repositories |
| `mattermost` | Mattermost-specific conventions and stricter handling of heuristic-only mappings |

Framework detection is separate. The CLI can auto-detect Playwright, Cypress, pytest, supertest, and Selenium usage from the project structure and dependencies.

### Key options

- **`testsRoot`** — path to tests when they live outside the app root
- **`profile`** — `default` or `mattermost`
- **`impact.dependencyGraph`** — static reverse dependency graph for transitive impact
- **`impact.traceability`** — file-to-test mapping from CI execution data
- **`impact.aiFlow`** — LLM-powered flow mapping through the configured provider
- **`pipeline.mcp`** — use Playwright MCP server for browser-aware generation/healing
- **`policy.enforcementMode`** — `advisory`, `warn`, or `block`

## CI Integration

### GitHub Actions

```yaml
- name: Run E2E coverage check
  run: |
    npx impact-gate plan \
      --config ./impact-gate.config.json \
      --since origin/${{ github.base_ref }} \
      --fail-on-must-add-tests \
      --github-output "$GITHUB_OUTPUT"
```

The `plan` command writes:
- `.e2e-ai-agents/plan.json` — structured plan with `runSet`, `confidence`, `decision`
- `.e2e-ai-agents/ci-summary.md` — markdown summary for PR comments
- `.e2e-ai-agents/metrics-summary.json` — run metrics

Use `--fail-on-must-add-tests` to exit non-zero when uncovered P0/P1 gaps exist. Use `--github-output` to expose outputs to subsequent workflow steps.

If you want AI enrichment on top of the deterministic plan, add your provider environment variables to the workflow separately.

See [examples/github-actions/pr-impact.yml](examples/github-actions/pr-impact.yml) for a complete workflow template.

## Pipeline Modes

### Package Native (default)

Strategy-based test templates with quality guardrails and iterative heal attempts. The strongest path today is still a repo whose impact analysis and manifest quality are already in good shape.

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
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
export OPENAI_API_KEY=sk-...

# Ollama (free, local)
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=deepseek-r1:7b
```

Programmatic provider usage:

```typescript
import { AnthropicProvider } from '@yasserkhanorg/impact-gate';

const claude = new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY
});
const response = await claude.generateText('Analyze test failure');
```

Factory pattern with auto-detection, hybrid mode (free local + premium fallback), and custom OpenAI-compatible endpoints are also supported. See the [provider API exports](src/index.ts) for full details.

## Advanced / Experimental: MCP Server

Exposes 6 tools for test agents (Playwright v1.56+):

```typescript
import { E2EAgentsMCPServer } from '@yasserkhanorg/impact-gate/mcp';

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

## Advanced / Experimental: Autonomous QA Agent (`impact-gate-qa`)

An autonomous QA engineer that opens a real browser, navigates to changed features, tries edge cases, and produces a findings report — all unsupervised. Built on top of `agent-browser` and the Anthropic tool-use API.

### Quick Start

```bash
# PR mode — test features changed since origin/main
npx impact-gate-qa pr --since origin/main --base-url http://localhost:8065

# Hunt mode — deep-test a specific area
npx impact-gate-qa hunt "channel settings" --base-url http://localhost:8065

# Release mode — systematic exploration of all critical flows
npx impact-gate-qa release --base-url http://localhost:8065 --time 30

# Fix mode — verify healed specs
npx impact-gate-qa fix --base-url http://localhost:8065
```

### Architecture

1. **Phase 1 (Script)** — Runs `impact-gate impact/plan` to determine scope, then executes matched Playwright specs.
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

The strongest production story today is a repo that maintains a good `route-families.json` manifest and uses the deterministic `impact -> plan -> gate` loop in CI. [Mattermost](https://github.com/mattermost/mattermost) is the most battle-tested public example for coverage gating, generation, and healing. See the [Mattermost Playwright integration](https://github.com/mattermost/mattermost/tree/master/e2e-tests/playwright) for a real-world setup.

## License

Apache 2.0

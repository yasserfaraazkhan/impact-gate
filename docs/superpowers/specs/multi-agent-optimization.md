# Multi-Agent Optimization & OSS Launch Readiness Spec

**Version:** 1.0
**Date:** 2026-03-19
**Status:** Draft
**Package:** @yasserkhanorg/e2e-agents (v1.8.5 → v2.0.0)

---

## Executive Summary

This spec defines 6 phases of optimization to transform e2e-agents from a capable but rough-edged tool into an open-source-ready product with excellent DX, measurable performance, cost transparency, extensibility, community infrastructure, and enterprise credibility. Each phase builds on the previous — DX first (people must be able to use it), then performance and cost (it must be fast and affordable), then extensibility (others must be able to extend it), then community and enterprise polish (it must be trustworthy).

---

## Current State Snapshot

| Metric | Current Value |
|--------|--------------|
| Version | 1.8.5 |
| Codebase | ~23,400 LOC TypeScript |
| Tests | 240+ across 47 suites |
| CLI commands | 12 (impact, plan, generate, heal, analyze, train, crew, feedback, traceability-capture, traceability-ingest, finalize, llm-health) |
| Crew agents | 10 (impact-analyst, cross-impact, regression-advisor, coverage-evaluator, strategist, test-designer, generator, executor, healer, explorer) |
| Workflows | 3 (full-qa, quick-check, design-only) |
| Providers | 4 (Anthropic, OpenAI, Ollama, Custom) |
| Caching | Anthropic prompt caching + file-based API surface cache |
| Budget controls | Per-phase check in crew orchestrator only |
| Progress feedback | Logger with timer support, no streaming progress |
| Framework support | Playwright, Cypress (auto-detected) |
| Docs | README (408 lines), 2 doc files, no docs site |
| CI templates | GitHub Actions examples in README |
| Community files | LICENSE (Apache 2.0), CONTRIBUTING.md exists, no issue templates |

---

## Phase 1: DX & Onboarding

**Goal:** First useful output in under 2 minutes with zero config.

### 1.1 Zero-Config Quick Start

**Current:** Requires `e2e-ai-agents.config.json` with `path`, `testsRoot`, `framework`, `since`, etc. No config = no run.

**Target:** `npx @yasserkhanorg/e2e-agents impact` works out of the box.

**Implementation:**

Add `resolveDefaults()` in `src/cli/defaults.ts`:

```typescript
interface ResolvedDefaults {
  path: string;           // cwd or git root
  testsRoot: string;      // auto-detected from common patterns
  framework: FrameworkType; // auto-detected from package.json/files
  since: string;          // origin/main or origin/master (whichever exists)
}

function resolveDefaults(explicit: Partial<ParsedArgs>): ResolvedDefaults {
  // 1. path: use cwd, walk up to git root
  // 2. testsRoot: scan for e2e/, tests/, cypress/, playwright/, specs/
  // 3. framework: check package.json deps for @playwright/test, cypress
  // 4. since: git remote show origin → HEAD branch
}
```

**Files touched:**
- `src/cli/defaults.ts` — New file, default resolution logic
- `src/cli/cli.ts` — Call `resolveDefaults()` before command dispatch
- `src/cli/parse_args.ts` — Make `path` and `testsRoot` optional

**Acceptance criteria:**
- `npx @yasserkhanorg/e2e-agents impact` in a Playwright project produces impact output with zero config
- `npx @yasserkhanorg/e2e-agents impact` in a non-test project prints actionable error: "No test directory found. Expected one of: e2e/, tests/, cypress/, playwright/. Use --tests-root to specify."

### 1.2 Interactive Init Wizard

**Current:** `init` command creates a config file. No guidance, no detection.

**Target:** `e2e-ai-agents init` guides users through setup with auto-detection.

**Implementation:**

Enhance `src/cli/commands/init.ts`:

```
$ e2e-ai-agents init

Detected:
  Framework: Playwright (from @playwright/test in package.json)
  Test dir:  e2e/ (14 spec files found)
  Git base:  origin/main

? LLM provider:
  > Ollama (free, local — recommended for getting started)
    Anthropic Claude (best quality, requires API key)
    OpenAI GPT-4 (requires API key)
    Skip (deterministic analysis only)

? Run route-family training now? (Y/n)

✓ Created e2e-ai-agents.config.json
✓ Trained 8 route families → .e2e-ai-agents/route-families.json
```

**Dependency:** Uses Node.js `readline` (no new deps). The wizard is a nice-to-have — the zero-config path (1.1) is the priority.

**Files touched:**
- `src/cli/commands/init.ts` — Rewrite with interactive prompts
- `src/cli/defaults.ts` — Shared detection logic (reused from 1.1)

**Acceptance criteria:**
- Wizard detects framework, test dir, and git base correctly for Playwright and Cypress projects
- Config file written is valid and works with all commands
- Cancel (Ctrl+C) at any point leaves no partial files
- `--yes` flag skips all prompts and uses detected defaults

### 1.3 Graceful Fallback Without Route Families

**Current:** Many commands warn or fail without `route-families.json`. `plan --crew` requires it.

**Target:** Every command works without route families, with degraded but useful output.

**Implementation:**

In `src/engine/impact_engine.ts` and `src/crew/orchestrator.ts`:

- If no manifest: fall back to directory-based family grouping
- Group changed files by top-level directory under `testsRoot`
- Mark results as `"confidence": "low"` and `"source": "heuristic"`
- Print one-time suggestion: "Tip: Run `e2e-ai-agents train` to improve accuracy."

**Files touched:**
- `src/engine/impact_engine.ts` — Add `buildHeuristicFamilies()` fallback
- `src/crew/orchestrator.ts` — Remove hard requirement for manifest
- `src/knowledge/route_families.ts` — Add `RouteFamily.fromDirectoryHeuristic()`

**Acceptance criteria:**
- `e2e-ai-agents impact --path .` works without `route-families.json`, producing results with `"source": "heuristic"`
- `e2e-ai-agents crew --workflow quick-check` works without manifest (currently requires it)
- Output includes one-time tip about `train` command
- Heuristic results are clearly marked as lower confidence

### 1.4 Dry Run Mode

**Current:** `--dry-run` flag exists in `parse_args.ts` and `CrewConfig` has `dryRun?: boolean`, but the feature is incomplete — it does not produce useful preview output.

**Target:** `--dry-run` on all AI commands shows what would happen.

**Implementation:**

```
$ e2e-ai-agents crew --workflow design-only --dry-run

Dry run — no LLM calls will be made.

Changed files (3):
  src/components/channels/header.tsx
  src/components/channels/sidebar.tsx
  api/channels.go

Affected families (2):
  channels (3 files, 12 specs)
  sidebar (1 file, 4 specs)

Workflow: design-only
Phases: preprocess → understand (impact-analyst, cross-impact) → strategize (strategist, test-designer)
Estimated cost: $0.30-0.80
Estimated time: 3-8 min
```

**Files touched:**
- `src/cli/parse_args.ts` — `--dry-run` already exists; no change needed
- `src/crew/orchestrator.ts` — Complete dry-run short-circuit after preprocess
- `src/cli/commands/crew.ts` — Format dry-run output with family/phase/cost preview

**Acceptance criteria:**
- `--dry-run` on crew, generate, heal commands produces summary without LLM calls
- Output includes: changed files, affected families, workflow phases, estimated cost range
- Zero tokens consumed, zero API calls made

### 1.5 Example Projects

**Target:** 2 example repos demonstrating the full workflow.

**Implementation:**

Create `examples/` directory:

```
examples/
├── playwright-react/
│   ├── package.json
│   ├── src/
│   ├── e2e/
│   ├── e2e-ai-agents.config.json
│   ├── .e2e-ai-agents/route-families.json (pre-trained)
│   └── README.md (step-by-step walkthrough)
├── cypress-nextjs/
│   ├── ...
│   └── README.md
```

Each example includes:
- Pre-trained route families
- A sample diff (as a `.patch` file) to demo `impact` and `plan`
- Expected output snapshots for validation
- `npm run demo` script that applies the patch and runs analysis

**Files touched:**
- `examples/playwright-react/` — New directory
- `examples/cypress-nextjs/` — New directory

**Acceptance criteria:**
- Each example has a working `npm run demo` that produces impact output
- Examples pass CI (built and tested in GitHub Actions)
- README in each example walks through the full workflow end-to-end

---

## Phase 2: Performance Optimization

**Goal:** 2x faster crew workflows, streaming progress, intelligent caching.

### 2.1 Pipeline-Level Parallelism

**Current:** Crew runs phases sequentially. Within a phase, agents run in parallel via `Promise.all()`. But families are processed as a batch — all families must complete a phase before the next starts.

**Target:** Independent family branches can run the full pipeline concurrently.

**Implementation:**

Add `StreamingPipeline` in `src/crew/streaming_pipeline.ts`:

```typescript
class StreamingPipeline {
  // Instead of: all families → phase 1 → all families → phase 2
  // Do: family A → phase 1 → phase 2 (in parallel with family B → phase 1 → phase 2)

  async run(families: FamilyGroup[], workflow: WorkflowDefinition, ctx: CrewContext) {
    const concurrency = Math.min(families.length, 4); // max 4 concurrent family pipelines
    const semaphore = new Semaphore(concurrency);

    return Promise.all(families.map(family =>
      semaphore.acquire(() => this.runFamilyPipeline(family, workflow, ctx))
    ));
  }
}
```

**Constraint:** Cross-impact agent needs results from ALL families' impact phase before it can run. Solution: split pipeline into two segments:
1. Per-family: impact-analyst runs per family in parallel (the `understand` phase's per-family work)
2. Cross-family barrier: once all family impacts are collected, cross-impact + regression-advisor run (cross-family analysis), then strategist + test-designer (sequential)

**Note:** `coverage-evaluator` exists as an agent class but is not currently dispatched in any workflow. If per-family coverage evaluation is desired, it must first be added to workflow definitions in `workflows.ts`.

**Files touched:**
- `src/crew/streaming_pipeline.ts` — New file
- `src/crew/orchestrator.ts` — Use streaming pipeline when families > 1
- `src/crew/workflows.ts` — Annotate which phases are per-family vs cross-family

**Acceptance criteria:**
- 2-family workflow completes in <70% of sequential time (measured via benchmark)
- Cross-impact results are identical whether run via streaming pipeline or sequential pipeline
- Budget tracking remains accurate across parallel family branches
- `--verbose` shows per-family progress interleaved correctly

### 2.2 Response Caching

**Current:** Only Anthropic prompt caching (provider-level) and API surface file cache. No cross-run result caching.

**Target:** Cache LLM responses with content-addressed keys. Reuse across runs when inputs haven't changed.

**Implementation:**

Add `src/cache/response_cache.ts`:

```typescript
interface CacheEntry {
  key: string;          // Content-addressed: SHA-256 of (agentRole + familyName + fileContentHashes + model)
  response: string;     // LLM response text
  usage: TokenUsage;    // Token stats (for cost tracking even on cache hit)
  createdAt: number;
  ttlMs: number;        // Default 24h for analysis, 1h for generation
}

class ResponseCache {
  private dir: string;  // .e2e-ai-agents/cache/

  async get(agent: string, family: string, fileHashes: string[], model: string): Promise<CacheEntry | null>;
  async set(entry: CacheEntry): Promise<void>;
  async invalidateFamily(familyName: string): Promise<void>;
  async prune(): Promise<number>; // Remove expired entries, return count
}
```

**Cache key strategy:** Keys are based on (agentRole + familyName + SHA-256 of family's source file contents + model), NOT raw prompt text. This means if no files in a family changed between runs, cached results are reused even though the prompt includes different diff context. The diff_loader pre-computes file content hashes during preprocess.

**Integration points:**
- Cache wrapper sits above `BaseProvider` as a decorator (not inside `generateText()`, since that method is abstract). New `CachedProvider` wraps any `LLMProvider`.
- `CrewOrchestrator.preprocess()` — Compute file content hashes per family, pass to cache
- Config: `"cache": { "enabled": true, "ttlHours": 24, "dir": ".e2e-ai-agents/cache" }`

**Files touched:**
- `src/cache/response_cache.ts` — New file
- `src/cache/cached_provider.ts` — New file (decorator wrapping LLMProvider)
- `src/agent/config.ts` — Add cache config section
- `src/crew/orchestrator.ts` — Wire CachedProvider when cache enabled

**Acceptance criteria:**
- Re-running the same workflow on unchanged families produces 100% cache hit rate
- Cache miss on any file change within a family
- `--no-cache` flag bypasses cache entirely
- Cache entries respect TTL and are pruned on next run

### 2.3 Streaming Progress

**Current:** Logger outputs at INFO/DEBUG level. No real-time progress for long-running operations.

**Target:** TTY-aware progress output showing phase, agent, family, tokens, cost, elapsed time.

**Implementation:**

Add `src/progress.ts`:

```typescript
class ProgressReporter {
  private isTTY: boolean;

  phaseStart(phase: string, agentCount: number): void;
  agentComplete(agent: string, family: string, tokens: number, cost: number): void;
  phaseComplete(phase: string, elapsed: number): void;

  // TTY output (overwritten in-place):
  // [2/5 agents] understand: impact-analyst processing channels... ($0.04, 12s)

  // Non-TTY output (append-only):
  // [understand] impact-analyst complete: channels (1,200 tokens, $0.02, 8s)
}
```

**Integration:**
- `CrewOrchestrator` emits events to `ProgressReporter`
- EventEmitter pattern for programmatic API consumers
- `--progress` flag (default: on for TTY, off for `--json`)
- `--quiet` flag suppresses all progress

**Files touched:**
- `src/progress.ts` — New file
- `src/crew/orchestrator.ts` — Emit progress events
- `src/cli/parse_args.ts` — Add `--progress` and `--quiet` flags

**Acceptance criteria:**
- TTY mode: progress line updates in-place (no scroll spam)
- Non-TTY mode: one line per agent completion (CI-friendly)
- `--json` mode: no progress output (clean JSON only)
- `--quiet` suppresses all non-error output
- Cost and token counts shown are accurate (match final summary)

### 2.4 Token Budget Optimization

**Current:** Prompts include full file contents. System prompts are repeated per-agent.

**Target:** Reduce token usage through smarter context packing. Measure actual savings (target TBD after profiling token distribution).

**Implementation:**

1. **Relevant chunk extraction** — Instead of full file contents, extract only the changed hunks + 20 lines of surrounding context
   - Modify `src/engine/diff_loader.ts` to produce `RelevantChunk[]` instead of full file strings

2. **Shared system prompt** — Factor repeated instructions into a single system prompt per workflow
   - Benefits Anthropic prompt caching (first request pays full, subsequent get 90% discount)
   - Modify `src/prompts/*.ts` to separate `staticSystemPrompt` from `dynamicUserPrompt`

3. **Context summarization for healing loops** — On retry 2+, summarize previous attempts instead of including full history
   - Modify `src/agents/healer.ts` to compress prior attempt context

**Files touched:**
- `src/engine/diff_loader.ts` — Add `extractRelevantChunks()`
- `src/prompts/*.ts` — Split static/dynamic prompt sections
- `src/agents/healer.ts` — Summarize prior attempts on retry

**Acceptance criteria:**
- Profile token distribution before/after (log input/output tokens per agent)
- Shared system prompt achieves Anthropic prompt caching on 2nd+ agent call (verify via `cachedTokens > 0`)
- Healer retry 2+ uses summarized context (verify via token count reduction)
- No regression in output quality (manual review of 3 sample runs)

### 2.5 Lazy Loading

**Current:** Already largely lazy (providers created on demand). Some synchronous file operations on import.

**Target:** Sub-200ms startup for all commands. No I/O until command dispatch.

**Implementation:**

- Profile startup with `--cpu-prof` to identify hot paths
- Defer `glob` import (largest dependency) until first use
- Defer schema validation until first write
- Ensure `import { ... } from './knowledge/...'` doesn't trigger file reads at module level

**Files touched:**
- `src/index.ts` — Audit top-level imports
- `src/knowledge/*.ts` — Ensure no side effects on import

**Acceptance criteria:**
- `time node dist/cli.js --help` completes in < 200ms
- No file I/O or network calls until command dispatch begins
- Measured with `--cpu-prof` before and after

---

## Phase 3: Cost Optimization

**Goal:** Full cost visibility, hard budget controls everywhere, intelligent model routing.

### 3.1 Cost Report Command

**Current:** `metrics.jsonl` and `metrics-summary.json` exist but aren't user-facing.

**Target:** `e2e-ai-agents cost-report` shows human-readable cost breakdown.

**Implementation:**

Add `src/cli/commands/cost_report.ts`:

```
$ e2e-ai-agents cost-report --days 7

E2E Agents Cost Report (last 7 days)
═════════════════════════════════════

Total: $4.82 across 23 runs

By workflow:
  quick-check  │ 18 runs │ $1.44 │ avg $0.08/run
  design-only  │  4 runs │ $2.38 │ avg $0.60/run
  full-qa      │  1 run  │ $1.00 │ avg $1.00/run

By agent (top 5):
  test-designer    │ $1.20 │ 25%
  strategist       │ $0.95 │ 20%
  impact-analyst   │ $0.72 │ 15%
  cross-impact     │ $0.58 │ 12%
  generator        │ $0.51 │ 11%

By family (top 5):
  channels         │ $0.84 │ 17%
  auth             │ $0.62 │ 13%
  messaging        │ $0.55 │ 11%
  settings         │ $0.41 │  9%
  notifications    │ $0.38 │  8%
```

**Data source:** Reads from `.e2e-ai-agents/metrics.jsonl` (already written by `plan` command).

**Prerequisite:** Enhance `metrics.jsonl` to include per-agent and per-family cost breakdowns. Without this, the "By agent" and "By family" tables are impossible. This enhancement must ship before or with the cost-report command.

**Files touched:**
- `src/cli/commands/cost_report.ts` — New file
- `src/cli/cli.ts` — Register `cost-report` command
- `src/crew/orchestrator.ts` — Write per-agent cost to metrics (prerequisite)

**Acceptance criteria:**
- `e2e-ai-agents cost-report` with no prior runs prints "No metrics found"
- After 3+ crew runs, report shows accurate per-workflow, per-agent, and per-family breakdowns
- `--days N` filters correctly
- `--json` outputs machine-readable format
- Totals match sum of individual entries

### 3.2 Universal Budget Controls

**Current:** `budgetUSD` in `CrewConfig` only. Checked per-phase in crew orchestrator.

**Target:** `--budget` flag on all AI commands. Graceful degradation at 80% threshold.

**Implementation:**

1. Add `--budget <usd>` to global flags in `src/cli/parse_args.ts`
2. Add budget check to `BaseProvider.generateText()`:
   ```typescript
   if (this.usageStats.totalCost >= this.budgetUSD) {
     throw new BudgetExceededError(this.usageStats.totalCost, this.budgetUSD);
   }
   ```
3. Graceful degradation: At 80% budget consumed, emit event. `CrewOrchestrator` catches it and switches remaining agents to cheapest available model.

**Config:**
```json
{
  "budget": {
    "default": 0.50,
    "crew": {
      "quick-check": 0.25,
      "design-only": 2.00,
      "full-qa": 5.00
    }
  }
}
```

**Files touched:**
- `src/cli/parse_args.ts` — Add global `--budget` flag
- `src/base_provider.ts` — Budget check before each call
- `src/crew/orchestrator.ts` — Graceful degradation at 80%
- `src/agent/config.ts` — Per-workflow budget config

**Acceptance criteria:**
- `--budget 0.10` stops execution when threshold hit, with clear message
- Graceful degradation at 80% requires Model Router (3.3) to be implemented first — without it, just hard-stop at budget
- Budget applies to all AI commands (not just crew)
- Cost tracking survives provider errors (failed request = 0 cost, not missing from total)

**Dependency:** Graceful degradation (model switching at 80%) depends on Phase 3.3 (Model Router). Implement hard-stop first, add degradation after 3.3.

### 3.3 Model Router

**Current:** Single model per provider. No task-based model selection.

**Target:** Route simple tasks to cheap models, complex tasks to expensive models.

**Implementation:**

Add `src/model_router.ts`:

```typescript
type TaskComplexity = 'classification' | 'extraction' | 'generation' | 'reasoning';

interface ModelRoute {
  complexity: TaskComplexity;
  model: string;        // e.g., 'claude-haiku-4-5-20251001'
  costPer1MTokens: number;
}

class ModelRouter {
  route(task: AgentTask): ModelRoute {
    // impact-analyst: classification → Haiku ($0.25/1M)
    // strategist: classification → Haiku
    // test-designer: generation → Sonnet ($3/1M)
    // generator: generation → Sonnet
    // healer: reasoning → Sonnet
    // cross-impact: extraction → Haiku
    // regression-advisor: extraction → Haiku
  }
}
```

**Config override:**
```json
{
  "modelRouting": {
    "classification": "claude-haiku-4-5-20251001",
    "extraction": "claude-haiku-4-5-20251001",
    "generation": "claude-sonnet-4-6",
    "reasoning": "claude-sonnet-4-6"
  }
}
```

**Estimated savings:** 40-60% cost reduction on quick-check and design-only workflows (most agents are classification/extraction). To be validated with benchmark.

**Architecture note:** Currently the provider is resolved once in `src/cli/commands/crew.ts` and passed through CrewContext. Model routing requires per-agent provider resolution. Solution: `CrewOrchestrator` creates per-agent providers via `ModelRouter.resolveProvider(task)`, which returns a provider instance configured for the appropriate model. The router wraps the factory, not the provider.

**Files touched:**
- `src/model_router.ts` — New file
- `src/crew/orchestrator.ts` — Use router for per-agent model/provider selection
- `src/agent/config.ts` — Add modelRouting config section
- `src/crew/protocol.ts` — Add `complexity` field to `AgentTask`

**Acceptance criteria:**
- Classification agents (impact-analyst, strategist, cross-impact, regression-advisor) use Haiku when routing enabled
- Generation agents (test-designer, generator, healer) use Sonnet
- Config override works: setting `"classification": "claude-sonnet-4-6"` forces all classification to Sonnet
- Output quality validated: run quick-check with and without routing, compare results on 3 sample repos
- Cost reduction measured and logged in metrics

### 3.4 Cost Estimation

**Current:** No pre-execution cost estimate.

**Target:** `--estimate` flag shows projected cost without making LLM calls.

**Implementation:**

```
$ e2e-ai-agents crew --workflow design-only --estimate

Cost Estimate
═════════════
Workflow: design-only
Families affected: 3 (channels, auth, messaging)

Estimated token usage:
  System prompts:  ~4,000 tokens (cached after first)
  Context (diffs): ~8,500 tokens
  Agent prompts:   ~12,000 tokens
  Responses:       ~15,000 tokens (estimated)

Estimated cost: $0.35-0.80
  With model routing: $0.15-0.40 (Haiku for classification)
  With caching: $0.10-0.30 (if route families unchanged)

Proceed? (Y/n)
```

**Implementation:** Count input tokens from actual prompts (free — just tokenization). Estimate output tokens from historical averages per agent (stored in metrics).

**Files touched:**
- `src/crew/estimator.ts` — New file
- `src/cli/commands/crew.ts` — Add `--estimate` handling

### 3.5 Free Tier Definition

**Commands that work with zero LLM spend:**

| Command | LLM Required? | Notes |
|---------|--------------|-------|
| `impact` | No | Deterministic engine only |
| `plan` (without `--crew`) | No | Deterministic plan builder |
| `train --no-enrich` | No | Scanner-only, no LLM enrichment |
| `traceability-capture` | No | Parses Playwright JSON |
| `traceability-ingest` | No | Merges manifests |
| `feedback` | No | Ingests outcomes |
| `cost-report` | No | Reads metrics files |
| `llm-health` | Minimal | Single health check call |

**Action:** Document the free tier prominently in README and docs site. Marketing angle: "Full impact analysis and planning — free. AI enrichment when you need it."

**Files touched:**
- `README.md` — Add "Free Tier" section

---

## Phase 4: Extensibility & Framework Support

**Goal:** Plugin architecture for frameworks, agents, providers, and output formats.

### 4.1 Framework Adapter Interface

**Current:** Framework detection in `src/cli/defaults.ts` (to be created) and scattered across pipeline stages.

**Target:** Clean `FrameworkAdapter` interface with built-in and community adapters.

**Implementation:**

Add `src/adapters/framework_adapter.ts`:

```typescript
interface FrameworkAdapter {
  name: string;                          // 'playwright', 'cypress', etc.
  detect(projectRoot: string): boolean;  // Auto-detection from project files

  // Test discovery
  specGlob: string;                      // e.g., '**/*.spec.ts'
  extractScenarios(fileContent: string): Scenario[];

  // Test execution
  buildRunCommand(specPath: string, options: RunOptions): string;
  parseTestOutput(stdout: string, stderr: string): TestResult[];

  // Config
  configFileName: string;                // e.g., 'playwright.config.ts'
}
```

**Built-in adapters:**
- `src/adapters/playwright.ts`
- `src/adapters/cypress.ts`

**Community adapter registration:**
```json
{
  "framework": "custom",
  "frameworkAdapter": "./my-adapter.js"
}
```

**Files touched:**
- `src/adapters/framework_adapter.ts` — New interface
- `src/adapters/playwright.ts` — Extract from existing code
- `src/adapters/cypress.ts` — Extract from existing code
- `src/agent/config.ts` — Add custom adapter config
- `src/training/scanner.ts` — Use adapter's specGlob

### 4.2 Agent Plugin System

**Current:** 10 hardcoded agents in `src/agents/`. Crew workflow definitions reference them by enum.

**Target:** Pluggable agents that can be added via config.

**Implementation:**

Extend `AgentProtocol` to support external plugins:

```typescript
// Plugin definition (user creates this file)
// my-security-agent.ts
import { AgentPlugin, AgentTask, AgentResult, CrewContext } from '@yasserkhanorg/e2e-agents';

export default {
  role: 'security-scanner',
  phase: 'strategize',        // Which phase to run in
  runAfter: ['strategist'],   // Dependencies

  async execute(task: AgentTask, ctx: CrewContext): Promise<AgentResult> {
    // Custom logic — can use ctx.provider for LLM calls
    return { role: 'security-scanner', status: 'success', output: findings, warnings: [] };
  }
} satisfies AgentPlugin;
```

**Config:**
```json
{
  "crew": {
    "plugins": ["./agents/my-security-agent.js"]
  }
}
```

**Files touched:**
- `src/crew/protocol.ts` — Export `AgentPlugin` interface
- `src/crew/orchestrator.ts` — Load and register plugins
- `src/crew/workflows.ts` — Allow dynamic phase injection
- `src/index.ts` — Export plugin types

**Design constraint:** Once plugins receive `CrewContext`, its interface becomes a public API contract. Field additions are non-breaking; field removals or type changes are breaking. Document which `CrewContext` fields are stable vs experimental.

**Acceptance criteria:**
- A working example plugin (e.g., `examples/plugins/log-agent.js`) ships with the package
- Plugin loading fails gracefully with clear error if module not found or invalid interface
- Plugin agent appears in progress output and cost report
- Integration test verifies plugin lifecycle (load → register → execute → report)

### 4.3 Output Format Plugins

**Current:** JSON artifacts + markdown summaries. GitHub Actions output variables.

**Target:** Pluggable reporters for different CI systems and notification channels.

**Implementation:**

Add `src/reporters/reporter.ts`:

```typescript
interface Reporter {
  name: string;
  format(results: CrewResults): string | Buffer;
  extension: string;   // '.xml', '.json', '.md', '.sarif'
}
```

**Built-in reporters:**
- `json` (existing)
- `markdown` (existing)
- `github` (existing GitHub Actions output)
- `junit` — JUnit XML for Jenkins/GitLab
- `sarif` — SARIF for GitHub Security tab

**Config:**
```json
{
  "reporters": ["json", "markdown", "junit"]
}
```

**CLI:** `--reporter junit,sarif`

**Files touched:**
- `src/reporters/reporter.ts` — New interface
- `src/reporters/junit.ts` — New file
- `src/reporters/sarif.ts` — New file
- `src/crew/orchestrator.ts` — Call reporters after workflow completion

### 4.4 Provider Plugin Interface

**Current:** 4 built-in providers. `CustomProvider` supports OpenAI-compatible APIs.

**Target:** Document `CustomProvider` prominently. Add plugin interface for non-OpenAI-compatible providers.

**Implementation:**

The `LLMProvider` interface already exists and is clean. The main work is:
1. Export it from the package entry point
2. Document how to implement a custom provider
3. Add config support for external provider modules

```json
{
  "llmProvider": {
    "type": "custom",
    "module": "./my-provider.js"
  }
}
```

**Files touched:**
- `src/index.ts` — Export provider interface and types
- `src/provider_factory.ts` — Load external provider modules

### 4.5 Monorepo Support

**Current:** Path normalization works. No formal multi-workspace support.

**Target:** Explicit monorepo config with per-workspace route families.

**Implementation:**

```json
{
  "workspaces": [
    { "name": "web", "path": "packages/web", "testsRoot": "packages/web/e2e" },
    { "name": "mobile", "path": "packages/mobile", "testsRoot": "packages/mobile/e2e" }
  ]
}
```

- `e2e-ai-agents impact` analyzes only workspaces with changed files
- `e2e-ai-agents train --workspace web` trains a single workspace
- Each workspace gets its own `route-families.json`

**Files touched:**
- `src/agent/config.ts` — Add workspace config
- `src/cli/parse_args.ts` — Add `--workspace` flag
- `src/engine/impact_engine.ts` — Filter by workspace

**Priority:** Deferred to post-2.0 unless user demand emerges. High complexity (per-workspace route families, cross-workspace impact), low immediate value for OSS launch.

---

## Phase 5: Community & OSS Readiness

**Goal:** Make it easy and inviting for others to contribute.

### 5.1 Documentation Site

**Technology:** Starlight (Astro-based, lightweight, great for technical docs).

**Structure:**
```
docs-site/
├── astro.config.mjs
├── src/content/docs/
│   ├── getting-started/
│   │   ├── installation.md
│   │   ├── quick-start.md
│   │   ├── zero-config.md
│   │   └── first-crew-run.md
│   ├── guides/
│   │   ├── impact-analysis.md
│   │   ├── crew-workflows.md
│   │   ├── training.md
│   │   ├── ci-integration.md
│   │   ├── cost-management.md
│   │   └── extending.md
│   ├── reference/
│   │   ├── cli.md
│   │   ├── config.md
│   │   ├── api.md
│   │   ├── agents.md
│   │   └── providers.md
│   ├── architecture/
│   │   ├── overview.md
│   │   ├── engine.md
│   │   ├── crew.md
│   │   └── pipeline.md
│   └── contributing/
│       ├── development.md
│       ├── adapters.md
│       ├── agents.md
│       └── providers.md
```

**Deployment:** GitHub Pages via GitHub Actions on push to `main`.

### 5.2 GitHub Community Infrastructure

**New files:**

```
.github/
├── ISSUE_TEMPLATE/
│   ├── bug_report.yml
│   ├── feature_request.yml
│   └── config.yml
├── PULL_REQUEST_TEMPLATE.md
├── DISCUSSION_TEMPLATE/
│   └── ideas.yml
├── FUNDING.yml (optional)
CONTRIBUTING.md          ← already exists, enhance with dev setup guide
CODE_OF_CONDUCT.md
SECURITY.md
```

**Labels (created via `gh label create`):**

| Label | Color | Description |
|-------|-------|-------------|
| `good-first-issue` | #7057ff | Good for newcomers |
| `help-wanted` | #008672 | Extra attention is needed |
| `area:dx` | #c5def5 | Developer experience |
| `area:perf` | #c5def5 | Performance |
| `area:cost` | #c5def5 | Cost optimization |
| `framework:playwright` | #e4e669 | Playwright adapter |
| `framework:cypress` | #e4e669 | Cypress adapter |
| `agent:*` | #d4c5f9 | Crew agent related |
| `provider:*` | #f9d0c4 | LLM provider related |

### 5.3 Good First Issues (Curated List)

**Easy (1-2 hours):**
1. Add `--output` flag to save impact results to a file
2. Improve error message when git ref doesn't exist
3. Add JUnit XML reporter
4. Add `--version` flag to CLI
5. Document Ollama setup with recommended models per task

**Medium (half day):**
6. Implement Vitest framework adapter
7. Add WebdriverIO framework adapter
8. Implement SARIF output format
9. Add Slack webhook reporter
10. Create `e2e-ai-agents demo` command using bundled examples

**Hard (1-2 days, for experienced contributors):**
11. Implement Gemini/Bedrock provider adapter
12. Add Slack webhook reporter with configurable templates
13. Create a new crew agent (accessibility auditor)
14. Add `e2e-ai-agents demo` interactive walkthrough command
15. Implement SARIF output with severity mapping from crew findings

### 5.4 Developer Tooling

**New scripts in `package.json`:**

```json
{
  "scripts": {
    "dev": "tsc --watch",
    "dev:test": "node --test --watch test-dist/",
    "example": "node dist/cli.js impact --path examples/playwright-react",
    "example:crew": "node dist/cli.js crew --workflow quick-check --path examples/playwright-react --tests-root examples/playwright-react/e2e"
  }
}
```

**Devcontainer config** (`.devcontainer/devcontainer.json`):
- Node 22
- Pre-installed: TypeScript, git
- Post-create: `npm install && npm run build`
- VS Code extensions: ESLint, TypeScript

### 5.5 Release & Governance

**Existing:** GitHub Actions `publish.yml` on `v*` tags.

**Additions:**
- `CHANGELOG.md` — Keep a changelog format, updated with each release
- `ROADMAP.md` — Public roadmap linking to this spec's phases
- `docs/decisions/` — Architecture Decision Records (ADRs) for major choices

### 5.6 Discoverability

**README badges:**
```markdown
[![npm version](https://img.shields.io/npm/v/@yasserkhanorg/e2e-agents)](https://www.npmjs.com/package/@yasserkhanorg/e2e-agents)
[![CI](https://github.com/yasserfaraazkhan/e2e-agents/actions/workflows/test.yml/badge.svg)](...)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](...)
[![Node](https://img.shields.io/node/v/@yasserkhanorg/e2e-agents)](...)
```

**npm keywords** (in `package.json`):
```json
["e2e", "testing", "playwright", "cypress", "ai", "llm", "test-generation", "impact-analysis", "coverage", "qa", "automation", "mcp"]
```

---

## Phase 6: Enterprise Credibility

**Goal:** Quantified performance claims, production resilience, observability, and security hardening.

### 6.1 Benchmark Suite

**Implementation:**

Add `benchmarks/` directory:

```
benchmarks/
├── run.ts                    # Benchmark runner
├── fixtures/
│   ├── small/               # 50 tests, 20 source files
│   ├── medium/              # 500 tests, 200 source files
│   └── large/               # 5000 tests, 1000 source files
├── results/
│   └── baseline.json        # Published baseline results
└── README.md                # Methodology
```

**Metrics captured per run:**
- Wall-clock time (p50, p95)
- Token usage (input, output, cached)
- Cost (USD)
- Precision (correct impact predictions vs actual test failures)
- Recall (missed impacts vs actual test failures)
- Families processed per second

**CI integration:** Run benchmarks on each release, publish results to docs site.

**Acceptance criteria:**
- Benchmark suite runs deterministic analysis (no LLM) on all 3 fixture sizes
- Results include p50/p95 wall-clock time, families/second throughput
- LLM benchmarks run against real Anthropic API with fixed seed where possible
- Baseline results published in `benchmarks/results/baseline.json` and docs site
- CI job runs benchmarks on release tags and fails if >20% regression from baseline

### 6.2 Reliability Patterns

**Circuit breaker:**

```typescript
class CircuitBreaker {
  private failures: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  async call<T>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
    if (this.state === 'open') return fallback();
    try {
      const result = await fn();
      this.reset();
      return result;
    } catch (e) {
      this.failures++;
      if (this.failures >= 3) this.state = 'open';
      throw e;
    }
  }
}
```

**Application:** Wrap all LLM calls. Fallback = deterministic-only mode. User sees: "LLM provider unavailable. Running in deterministic mode (reduced accuracy)."

**Retry with jitter:** Extend `BaseProvider` with configurable retry:
```typescript
{
  maxRetries: 2,
  baseDelay: 1000,
  maxDelay: 10000,
  jitter: true
}
```

**Idempotent runs:** Pin `seed` parameter where providers support it (Anthropic does not currently; OpenAI does).

**Files touched:**
- `src/resilience/circuit_breaker.ts` — New file
- `src/resilience/retry.ts` — New file
- `src/base_provider.ts` — Integrate circuit breaker and retry

**Acceptance criteria:**
- After 3 consecutive LLM failures, circuit opens and falls back to deterministic mode
- Retry with jitter: 2 retries max, exponential backoff 1s-10s with random jitter
- User sees clear message: "LLM provider unavailable. Running in deterministic mode."
- Circuit half-opens after 60s and retries one request
- Existing QA agent retry logic (MAX_LLM_RETRIES = 2) migrated to shared retry module

### 6.3 Observability

**Structured logging improvements:**
- Add `runId` (UUID) to all log entries for correlation
- Add `agentRole` and `familyName` to crew agent logs

**OpenTelemetry (optional):**
- `--otel` flag enables trace export
- Each crew run = 1 trace
- Each phase = 1 span
- Each agent execution = 1 child span
- Each LLM call = 1 child span with token/cost attributes

**Implementation:** Use `@opentelemetry/api` (lightweight, peer dependency). No runtime cost when disabled.

**Run artifacts:**
```
.e2e-ai-agents/runs/<runId>/
├── config.json      # Resolved config snapshot
├── diff.patch       # Input diff
├── results.json     # Full output
├── metrics.json     # Token/cost/timing breakdown
└── trace.json       # OpenTelemetry trace (if --otel)
```

**Files touched:**
- `src/logger.ts` — Add runId, agentRole, familyName
- `src/observability/tracing.ts` — New file (optional OTel integration)
- `src/crew/orchestrator.ts` — Emit trace spans

**Note:** The run artifacts directory (`.e2e-ai-agents/runs/<runId>/`) is deferred. It overlaps with existing `metrics.jsonl` and adds a new persistence layer. Ship structured logging + OTel first; add artifacts only if users request reproducibility features.

**Acceptance criteria:**
- All log entries include `runId` field in JSON format
- Crew agent logs include `agentRole` and `familyName`
- `--otel` flag produces valid OpenTelemetry traces exportable to Jaeger/Zipkin
- When `--otel` is not set, zero runtime overhead from OTel code (lazy import)

### 6.4 Security Hardening

**Current state:** MCP server has good security (path validation, rate limiting, error sanitization). CLI has less scrutiny.

**Additions:**
1. **Dependency audit in CI:** Add `npm audit --audit-level=high` to test workflow
2. **SBOM generation:** Add `npm sbom` to publish workflow, attach to GitHub release
3. **API key leak audit:** Grep all prompts and logs for key patterns before sending
4. **Provenance:** Enable npm provenance on publish (`--provenance` flag)

**Files touched:**
- `.github/workflows/test.yml` — Add `npm audit` step
- `.github/workflows/publish.yml` — Add SBOM and provenance
- `src/base_provider.ts` — Sanitize prompts for key patterns before logging

### 6.5 Enterprise Integration

**CI gate mode:**
```bash
# Exits 1 if coverage below threshold
e2e-ai-agents gate --threshold 80 --path . --since origin/main
```

**GitHub Action (published to marketplace):**
```yaml
- uses: yasserfaraazkhan/e2e-agents-action@v1
  with:
    workflow: quick-check
    budget: 0.25
    fail-on: must-add-tests
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

**Implementation:** The `gate` command lives in this repo. The GitHub Action should be a separate repo (`e2e-agents-action`) to avoid mixing library and CI-tool concerns.

**Files touched:**
- `src/cli/commands/gate.ts` — New command (this repo)
- `action.yml` — Separate repo `yasserfaraazkhan/e2e-agents-action`

**Acceptance criteria:**
- `e2e-ai-agents gate --threshold 80` exits 0 when coverage >= 80%, exits 1 when below
- `gate` command works with deterministic analysis (no LLM required)
- GitHub Action (separate repo) wraps `npx` call with proper input/output mapping
- Action tested in a sample workflow before marketplace publication

---

## Implementation Priority & Dependencies

```
Phase 1 (DX)     ──── Phase 2 (Performance)  ──┐
                                                ├── Phase 4 (Extensibility)
Phase 3 (Cost)   ──────────────────────────────┘
                                                │
Phase 5 (Community)  ── can start early ────────┘
                                                │
Phase 6 (Enterprise) ──────────────────────────┘
```

**Phase 1** → **Phase 2**: defaults.ts detection logic is reused; heuristic families enable caching invalidation.
**Phase 3** can start in parallel with Phase 2 (no code dependencies between them).
**Phase 3.2** (graceful degradation) depends on **Phase 3.3** (model router). Implement hard-stop budget first.
**Phase 4** depends on Phase 1 (adapters need defaults.ts) and Phase 3 (plugins need cost tracking).
**Phase 5** can start early — docs, community files, and GitHub infrastructure are independent of code.
**Phase 6** depends on Phase 2 (benchmarks need caching) and Phase 3 (benchmarks need cost tracking).

---

## Version Strategy

| Phase | Version Bump | Notes |
|-------|-------------|-------|
| Phase 1 | 1.9.0 | New features, backwards compatible |
| Phase 2 | 1.10.0 | Performance improvements |
| Phase 3 | 1.11.0 | Cost features |
| Phase 4 | 2.0.0 | Plugin API = new public interface |
| Phase 5 | 2.0.0 | Ships with Phase 4 |
| Phase 6 | 2.1.0 | Enterprise features |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Zero-config detection fails for edge cases | High | Low | Always allow explicit config override |
| Response cache stale results | Medium | Medium | Conservative TTL + diff-based invalidation |
| Model router picks wrong model | Medium | Low | User override in config, fallback to default |
| Plugin API breaks between versions | Medium | High | Semver, integration tests for plugin interface |
| Benchmark results vary across hardware | High | Low | Document hardware specs, use relative comparisons |
| Community contributions need review bandwidth | High | Medium | Clear contribution guidelines, automated checks |

---

## Open Questions

1. **Docs site hosting:** GitHub Pages (free, simple) vs. Vercel (faster, preview deploys)?
2. **Telemetry:** Should we add opt-in anonymous usage telemetry for understanding adoption?
3. **GitHub Action:** Composite action (simpler) vs. JavaScript action (more control)?
4. **Monorepo examples:** Should example projects live in this repo or separate repos?
5. **Plugin registry:** Just npm packages, or a curated registry/awesome-list?

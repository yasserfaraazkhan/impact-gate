# Architecture

This document describes the internal structure of `@yasserkhanorg/e2e-agents` for contributors and integrators. For usage instructions, see the [README](README.md). For development setup, see [.github/DEVELOPMENT.md](.github/DEVELOPMENT.md).

## High-Level Module Map

The codebase lives under `src/` and is organized into focused modules. Each module has a single responsibility and communicates through typed interfaces.

### CLI (`src/cli/`)

Entry point for all user interaction. `src/cli.ts` is the binary entry (`e2e-ai-agents`). Argument parsing lives in `parse_args.ts`, and each command has its own file under `commands/` (e.g., `impact.ts`, `crew.ts`, `train.ts`, `cost_report.ts`). The CLI layer resolves defaults from `defaults.ts`, validates inputs, and dispatches to the appropriate engine or crew command. It never contains business logic itself.

### Engine (`src/engine/`)

The deterministic analysis core. Four files handle the entire impact-to-plan pipeline without LLM calls:

- `diff_loader.ts` — parses git diffs into structured changed-file lists
- `impact_engine.ts` — maps changed files to impacted route families using the knowledge layer, dependency graphs, and traceability data
- `ai_enrichment.ts` — optional LLM pass that refines impact mappings when a provider is available
- `plan_builder.ts` — consumes impact results and produces coverage plans with gap analysis, run sets, and confidence scores

The engine is designed to work entirely offline when `--no-enrich` is used.

### Crew (`src/crew/`)

Multi-agent orchestration layer introduced in v1.8.0. The `orchestrator.ts` manages agent registration, workflow execution, and inter-agent messaging. Key files:

- `context.ts` — `CrewContext` shared state object passed between agents (impact results, strategy entries, test designs, findings, cost tracking)
- `protocol.ts` — defines `Agent`, `AgentPlugin`, `AgentMessage`, `AgentTask`, and `AgentResult` interfaces
- `workflows.ts` — declares named workflows (`quick-check`, `design-only`, `full-qa`) as ordered agent phase lists
- `types.ts` — domain types: `TestCase`, `TestDesign`, `CrossImpact`, `StrategyEntry`, `Finding`, `RegressionRisk`
- `sanitize.ts` — cleans and validates LLM-produced JSON before it enters the context
- `provider.ts` — crew-specific provider wrapper with budget enforcement

### Agents (`src/agents/`)

Ten specialized agents, each implementing the `Agent` interface from `crew/protocol.ts`:

| Agent | Role | Phase |
|-------|------|-------|
| `impact-analyst` | Maps changed files to impacted flows | understand |
| `cross-impact` | Detects ripple effects across route families | understand |
| `regression-advisor` | Scores regression risk from history and heuristics | understand |
| `strategist` | Decides per-flow approach (full-test / smoke / skip) | strategize |
| `test-designer` | Produces structured `TestCase[]` with steps and assertions | design |
| `coverage-evaluator` | Identifies remaining coverage gaps after design | design |
| `generator` | Generates Playwright spec code from test designs | generate |
| `executor` | Runs generated specs and collects results | execute |
| `healer` | Analyzes failures and patches broken specs | heal |
| `explorer` | Autonomous browser exploration for the QA agent | explore |

Each agent receives an `AgentTask` and a `CrewContext`, performs its work (deterministic or LLM-assisted), and returns an `AgentResult`.

### Pipeline (`src/pipeline/`)

The original 5-stage test generation and healing pipeline, predating the crew system. Stages are numbered files:

- `stage0_preprocess.ts` — config resolution, git diff loading, route-family loading
- `stage1_impact.ts` — delegates to the engine for impact analysis
- `stage2_coverage.ts` — gap detection and scenario suggestion
- `stage3_generation.ts` — LLM-driven spec generation with iterative run-fix loops
- `stage4_heal.ts` — flaky/failing spec repair from Playwright reports

`orchestrator.ts` chains the stages together. `spec_verifier.ts` validates generated specs against the discovered API surface to block hallucinated methods.

### Knowledge (`src/knowledge/`)

Static and computed knowledge about the target codebase:

- `route_families.ts` — loads, validates, and queries the `route-families.json` manifest (the primary mapping from files to features). Includes `serializeManifest()` for clean JSON output.
- `api_surface.ts` — discovers Playwright page-object methods and custom helpers available in the target project
- `spec_index.ts` — indexes existing test spec files for deduplication and coverage analysis
- `context_loader.ts` — aggregates knowledge sources into a single context object for agents
- `kg_bridge.ts` — bridge between Understand-Anything knowledge graphs and route families. Transforms KG nodes/edges into `RouteFamilyManifest`. Validates node fields (rejects path traversal, null bytes, truncates long strings).
- `kg_types.ts` — TypeScript interfaces matching the Understand-Anything `knowledge-graph.json` schema
- `cluster_utils.ts` — shared cluster ID derivation (camelCase→snake_case normalization, path-based grouping). Used by both `kg_bridge.ts` and `training/kg_scanner.ts`.

### Providers (`src/*_provider.ts`)

LLM provider abstraction layer. Four concrete providers plus shared infrastructure:

- `base_provider.ts` — abstract base with budget enforcement (`checkBudget()`), token counting, and cost tracking
- `anthropic_provider.ts` — Anthropic Claude (supports vision and prompt caching)
- `openai_provider.ts` — OpenAI GPT models
- `ollama_provider.ts` — local Ollama instance (free)
- `custom_provider.ts` — any OpenAI-compatible endpoint
- `provider_factory.ts` — factory with auto-detection from environment variables, hybrid mode support
- `provider_interface.ts` — the `LLMProvider` interface and all shared types
- `model_router.ts` — routes tasks to cost-appropriate models (e.g., cheaper model for simple classifications)

### Training (`src/training/`)

Builds the `route-families.json` knowledge manifest:

- `scanner.ts` — four strategies: directory matching, test-derived, server-derived, name-matched. Configurable server infra files and tiers via `ScannerConfig`.
- `kg_scanner.ts` — knowledge-graph-based scanning. Converts Understand-Anything KG into the same `ScanResult` format as the filesystem scanner, so the merge/enrich/validate pipeline works unchanged.
- `enricher.ts` — LLM pass adding routes, priorities, user flows, and component names
- `merger.ts` — merges scanner output with enrichment results and existing manifests
- `validator.ts` — measures manifest accuracy against real git history
- `types.ts` — training-specific type definitions

### Resilience (`src/resilience/`)

Fault tolerance for LLM calls:

- `circuit_breaker.ts` — trips after repeated failures, enters half-open state, auto-recovers
- `retry.ts` — exponential backoff with jitter for transient errors

### Cache (`src/cache/`)

Response caching to avoid redundant LLM calls:

- `response_cache.ts` — content-addressed cache with TTL, stored on disk under `.e2e-ai-agents/cache/`
- `cached_provider.ts` — wraps any `LLMProvider` with transparent caching

### Prompts (`src/prompts/`)

Prompt construction for each LLM agent. Each prompt builder accepts an optional `GenerationProfile` for project-agnostic output:

- `impact.ts`, `coverage.ts`, `generation.ts`, `heal.ts`, `test-designer.ts`, `strategist.ts`, `cross-impact.ts` — prompt builders with `sanitizeForPrompt()` applied to all user-controlled fields
- `generation_profile.ts` — `GenerationProfile` system for project-agnostic test generation. Profiles for Mattermost, generic Playwright, pytest, and supertest/vitest. Auto-derives profile from KG metadata.
- `json_extract.ts` — shared `extractJsonFromResponse<T>()` for parsing JSON from LLM text responses

### Adapters (`src/adapters/`)

Framework-specific logic behind a uniform contract. All adapters return structured `RunCommand {executable, args}` (no shell strings):

- `framework_adapter.ts` — `FrameworkAdapter` interface, `RunCommand` type, `detectFramework()` and `detectTestMode()` auto-detection. Exports shared `UI_FRAMEWORKS` and `API_FRAMEWORKS` constants.
- `playwright.ts` — Playwright adapter (spec glob, config file names, run command builder)
- `cypress.ts` — Cypress adapter
- `pytest.ts` — Python pytest adapter with detection via pyproject.toml/conftest.py
- `supertest.ts` — Node.js API testing adapter (vitest or jest runner) with detection via package.json

### Reporters (`src/reporters/`)

Output format plugins for crew results:

- `reporter.ts` — `Reporter` interface with `name`, `extension`, and `format()` method
- `junit.ts` — JUnit XML output for CI systems
- `sarif.ts` — SARIF format for code scanning integrations (GitHub Advanced Security, etc.)

## Data Flow

The high-level execution path for both the pipeline and crew:

```
CLI args
  --> parse_args.ts: validate and normalize
  --> defaults.ts: apply config file + environment defaults
  --> command dispatch (e.g., crew.ts, impact.ts)
       |
       |--> Engine path (impact/plan commands):
       |      diff_loader --> impact_engine --> plan_builder --> artifacts
       |
       |--> Crew path (crew command):
       |      CrewOrchestrator.run(workflow)
       |        --> phase "understand": impact-analyst, cross-impact, regression-advisor
       |        --> phase "strategize": strategist
       |        --> phase "design": test-designer, coverage-evaluator
       |        --> phase "generate": generator (optional, workflow-dependent)
       |        --> phase "execute": executor (optional)
       |        --> phase "heal": healer (optional)
       |        --> artifacts written to .e2e-ai-agents/
       |
       |--> Pipeline path (analyze command):
              stage0 --> stage1 --> stage2 --> stage3 --> stage4 --> artifacts
```

All artifact output goes to `<testsRoot>/.e2e-ai-agents/`. See the Artifacts table in the README for the full list.

## How Providers Work

Every LLM interaction goes through the `LLMProvider` interface defined in `provider_interface.ts`. The system never calls vendor SDKs directly outside of provider implementations.

**Factory pattern.** `LLMProviderFactory.create()` accepts a config object with a `type` field (`anthropic`, `openai`, `ollama`, `custom`) or uses `createFromEnv()` to auto-detect based on which environment variables are set (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL`). The factory also supports hybrid mode, where a free local provider (Ollama) handles routine calls and a premium provider (Anthropic) handles complex tasks or vision requests.

**Budget enforcement.** `BaseProvider.checkBudget()` is called before every LLM request. If the accumulated cost exceeds the `--budget-usd` limit, the call is rejected with a clear error. This prevents runaway costs during CI runs.

**Model routing.** The `model_router.ts` module can route different task types (classification, generation, analysis) to different models or providers to optimize cost. Simple tasks go to cheaper/faster models; complex tasks go to more capable ones.

## How to Add Things

### Adding a New CLI Command

1. Create `src/cli/commands/your_command.ts` exporting an async handler function
2. Add the command name to the type union in `src/cli/types.ts`
3. Register it in the dispatch logic in `src/cli.ts`
4. Add any new flags to `src/cli/parse_args.ts`
5. Add default values in `src/cli/defaults.ts` if applicable

### Adding a New Crew Agent

1. Create `src/agents/your-agent.ts` implementing the `Agent` interface from `src/crew/protocol.ts`
2. Define the agent's role in the `AgentRole` union in `src/crew/types.ts`
3. Register the agent in the orchestrator (either in the command handler or via `orchestrator.registerAgent()`)
4. Add the role to the appropriate workflow phase in `src/crew/workflows.ts`
5. Extend `CrewContext` in `src/crew/context.ts` if the agent produces new shared state

### Adding a New Provider

1. Create `src/your_provider.ts` extending `BaseProvider` (from `base_provider.ts`)
2. Implement `generateText()` and optionally `analyzeImage()` and `streamText()`
3. Define a config type in `src/provider_interface.ts`
4. Register in the factory switch in `src/provider_factory.ts`
5. Export from `src/index.ts`

See the CONTRIBUTING.md "Adding a New Provider" section for a code template.

### Adding a Framework Adapter

1. Create `src/adapters/your_framework.ts` implementing `FrameworkAdapter`
2. Add detection logic (typically checking `package.json` for the framework dependency)
3. Register in the detection chain in `src/adapters/framework_adapter.ts`

### Adding an Output Reporter

1. Create `src/reporters/your_format.ts` implementing the `Reporter` interface
2. Implement the `format(results: CrewResults): string` method
3. Register in the reporter selection logic

## Key Interfaces

These are the five most important interfaces in the codebase. Understanding them covers the main extension points.

**`LLMProvider`** (`src/provider_interface.ts`) — the contract every LLM backend must satisfy: `generateText()`, `analyzeImage()`, `streamText()`, `capabilities`, `getUsageStats()`, `resetUsageStats()`.

**`Agent`** (`src/crew/protocol.ts`) — the contract for crew agents: `role: AgentRole`, `execute(task, ctx): Promise<AgentResult>`, optional `onMessage(msg)` for inter-agent communication.

**`AgentPlugin`** (`src/crew/protocol.ts`) — extends `Agent` with `phase` and optional `runAfter` for external plugin registration into workflow phases.

**`FrameworkAdapter`** (`src/adapters/framework_adapter.ts`) — abstracts test framework specifics: `detect()`, `specGlob`, `extractTestPattern`, `configFileNames`, `buildRunCommand()`.

**`Reporter`** (`src/reporters/reporter.ts`) — output format plugin: `name`, `extension`, `format(results): string`.

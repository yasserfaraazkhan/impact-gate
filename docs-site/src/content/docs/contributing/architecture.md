---
title: "Architecture"
description: "Module map, data flow, and key interfaces"
---

The codebase is organized into focused modules under `src/`, each with a single responsibility communicating through typed interfaces.

## Module Map

### Engine (`src/engine/`)

The deterministic analysis core. Handles the full impact-to-plan pipeline without LLM calls:

- **diff_loader** -- parses git diffs into structured changed-file lists
- **impact_engine** -- maps changed files to impacted route families
- **ai_enrichment** -- optional LLM pass for refining impact mappings
- **plan_builder** -- produces coverage plans with gap analysis and confidence scores

### Crew (`src/crew/`)

Multi-agent orchestration layer. The orchestrator manages agent registration, workflow execution, and inter-agent messaging:

- **context** -- shared `CrewContext` state passed between agents
- **protocol** -- `Agent`, `AgentPlugin`, `AgentMessage`, and `AgentResult` interfaces
- **workflows** -- named workflow definitions as ordered agent phase lists
- **sanitize** -- validates LLM-produced JSON before it enters the context

### Knowledge (`src/knowledge/`)

Static and computed knowledge about the target codebase:

- **route_families** -- loads and queries the route-family manifest
- **api_surface** -- discovers Playwright page-object methods
- **spec_index** -- indexes existing test specs
- **context_loader** -- aggregates knowledge sources for agents
- **cluster_utils** -- derives cluster IDs from knowledge-graph nodes and file paths for family grouping
- **kg_bridge** -- bridge between Understand-Anything knowledge graphs and route families; loads the KG, classifies project type (frontend/backend/fullstack), and transforms nodes/edges into a `RouteFamilyManifest`
- **kg_types** -- TypeScript interfaces for the Understand-Anything knowledge-graph schema (`KnowledgeGraph`, `KGNode`, `KGEdge`, `DiffOverlay`, etc.)

### Adapters (`src/adapters/`)

Framework-specific adapters implementing the `FrameworkAdapter` interface. Each adapter provides detection, spec-glob patterns, and run-command construction:

- **playwright** -- Playwright/`@playwright/test` projects
- **cypress** -- Cypress projects
- **pytest** -- Python pytest projects (detects `conftest.py`, `pytest.ini`, `pyproject.toml`)
- **supertest** -- Node.js API testing with supertest (runs via Vitest or Jest)

### Providers (`src/*_provider.ts`)

LLM abstraction layer with budget enforcement, token counting, and model routing. Four providers (Anthropic, OpenAI, Ollama, Custom) plus a factory with auto-detection.

## Data Flow

```
CLI args
  -> parse_args: validate and normalize
  -> defaults: apply config + environment defaults
  -> command dispatch
       |
       |-- Engine path: diff_loader -> impact_engine -> plan_builder -> artifacts
       |
       |-- Crew path: orchestrator.run(workflow)
       |     -> understand: impact-analyst, cross-impact, regression-advisor
       |     -> strategize: strategist
       |     -> design: test-designer, coverage-evaluator
       |     -> generate: generator (optional)
       |     -> execute: executor (optional)
       |     -> heal: healer (optional)
       |
       |-- Pipeline path: stage0 -> stage1 -> stage2 -> stage3 -> stage4
```

All artifacts are written to `<testsRoot>/.e2e-ai-agents/`.

## Key Interfaces

**`LLMProvider`** -- contract for LLM backends: `generateText()`, `analyzeImage()`, `streamText()`, `capabilities`, `getUsageStats()`

**`Agent`** -- contract for crew agents: `role`, `execute(task, ctx)`, optional `onMessage()` for inter-agent communication

**`AgentPlugin`** -- extends `Agent` with `phase` and `runAfter` for external plugin registration

**`FrameworkAdapter`** -- abstracts test framework specifics: `detect()`, `specGlob`, `buildRunCommand()`. Four adapters ship built-in (Playwright, Cypress, pytest, supertest).

**`Reporter`** -- output format plugin: `name`, `extension`, `format(results)`

## Extension Points

- **New agent**: implement `Agent`, register in orchestrator, add to workflow phases
- **New provider**: extend `BaseProvider`, register in factory
- **New adapter**: implement `FrameworkAdapter`, add detection logic
- **New reporter**: implement `Reporter`, register in selection logic

# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-03-12

### 1.0 — Production-Ready Release

First stable release. The entire architecture has been rewritten since v0.3.x with a deterministic impact engine, AI enrichment, agentic test generation, and a staged pipeline. Used in production by [Mattermost](https://github.com/mattermost/mattermost) for CI-integrated E2E coverage gating.

### Highlights

- **Deterministic impact engine** — route-family-based analysis replaces the heuristic runner system
- **AI enrichment** — LLM-powered flow mapping, scenario detection, and gap analysis
- **Agentic test generation** — `generate` command with generate-run-fix loop (up to N attempts)
- **5-stage pipeline** — `impact → plan → generate → heal → finalize`
- **MCP server** — 6 tools for Playwright test agents with security-hardened write restrictions
- **CI coverage gate** — GitHub Actions workflow with PR comment summaries and policy enforcement

### Architecture (since v0.3.x)

#### New Modules
- `src/engine/` — deterministic impact engine, AI enrichment, diff loader, plan builder
- `src/knowledge/` — route families, API surface discovery, spec index, context loader
- `src/pipeline/` — 5-stage orchestrator (preprocess, impact, coverage, generation, heal)
- `src/prompts/` — structured LLM prompts for impact, coverage, generation, heal
- `src/validation/` — output schema validation, generation guardrails
- `src/agentic/` — Playwright runner, fix loop, agentic workflow runner
- `src/cli/` — decomposed CLI with declarative flag parser and per-command modules

#### Removed (replaced by engine/)
- `src/agent/runner.ts`, `analysis.ts`, `dependency_graph.ts`, `flow_catalog.ts`, `flow_mapping.ts`, `framework.ts`, `gap_suggestions.ts`, `generator.ts`, `operational_insights.ts`, `report.ts`, `selectors.ts`, `subsystem_risk.ts`, `tests.ts`, `traceability.ts`, `blast_radius.ts`, `flags.ts`

#### Decomposed God Files
- **cli.ts**: 1,311 → 148 LOC — thin dispatcher + 12 focused command modules under `src/cli/`
- **pipeline.ts**: 1,869 → 304 LOC — thin orchestrator + 8 focused modules (`api_catalog`, `spec_generator`, `native_flow`, `llm_agents_flow`, `process_runner`, `validation_runner`, `pipeline_types`, `pipeline_utils`)
- **parse_args.ts**: 438 → 262 LOC — declarative flag table replaces 66 if-blocks

### Security

- **MCP write_file hardened** — symlink resolution via `realpathSync`, writes restricted to `*.spec.ts`/`*.test.ts` and `.e2e-ai-agents/` only
- **pdf-parse removed** — CVE-2024-1538, was unused

### Features

- `generate` command — agentic Playwright test generation with generate-run-fix loop
- `impact` command — standalone deterministic impact analysis
- `--no-ai` flag — run without LLM enrichment
- `--max-attempts` — configurable retry limit for agentic generation
- `--flow-catalog` — external route-family manifest
- Advisory scenarios for covered features with collapsible PR comment sections
- GitHub admonition styling for gaps and advisory scenarios
- Content-aware AI mapping with missing scenario detection
- Green safe-to-merge for CI-only PRs with no app file changes

### Fixes

- Playwright-only coverage correctly treated as covered
- Empty specDirs on feature no longer falls back to parent family
- AI returning zero flows treated as no-impact (not AI unavailable)
- Filename collision in Playwright runner report paths
- Cleaner PR comments — concise reasons, inline scenarios, coverage breakdown

### Testing

- 185 tests across 34 suites (up from 44 tests in v0.3.0)
- New test coverage: impact engine, plan builder, AI enrichment, route families, agentic runner, pipeline orchestrator, stage3 generation, stage4 heal, diff loader, fix loop, Playwright runner

### CI

- Node.js 20.x + 22.x matrix in test workflow
- Type check + test on push/PR to master

## [0.3.0] - 2026-02-09

### Major Improvements

This release focuses on code quality, performance, and maintainability through systematic refactoring and comprehensive testing.

### Fixed

- **Test script**: Fixed `npm test` script to correctly target test files (`test/*.js`)
- **CI/CD configuration**: Fixed GitHub Actions workflow to use correct branch (`master` instead of `main`)

### Changed

- Extracted shared provider utilities to `src/provider_utils.ts` (204 lines deduplicated)
- Created `src/base_provider.ts` abstract base class (159 lines deduplicated)
- Performance optimizations: 40% faster stats, 30% faster key validation, 90% faster repo context (cache)
- Structured logging system (`src/logger.ts`) with LOG_LEVEL support
- TTL-based caching (`src/agent/cache_utils.ts`)
- Test coverage increased from 8 to 44 tests (80%+)

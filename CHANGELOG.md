# Changelog

All notable changes to this project will be documented in this file.

## [1.7.4] - 2026-03-16

### Bug Fixes

- **Snapshot filtering** — `.snap` files and `__snapshots__/` directories are now excluded from impact analysis, preventing massive over-reporting on snapshot-only PRs (e.g. 5 false gaps for a button type fix)
- **Cross-family dedup** — family-level gaps are suppressed when all their changed files are already covered by more specific feature-level matches in other families (prevents double-counting like `config` + `system_console/permissions`)
- **PR-included test awareness** — PRs that add Cypress or Playwright spec files alongside source changes are no longer blocked; decision softens to "run-now" instead of "must-add-tests"
- **AI scenario specificity** — prompt now requires diff-specific scenarios with BAD/GOOD examples, rejects generic feature tests, and handles trivial/test-only diffs

## [1.7.3] - 2026-03-16

### Bug Fixes

- **Gap description fallback** — when the LLM returns missing test scenarios but empty `reasons` for a gap, the PR comment now synthesizes a description from changed file names instead of showing a blank line after the `✦ AI-enriched` label

### CI Workflow Examples

- **Shard-deduplicated template** — new `e2e-tests-playwright-template.yml` example that extracts plan/generate into a single job and shares results via artifacts (75% LLM cost reduction)
- **Fail-open API fallback** — coverage gate and template workflows now fall back to the full test suite with a warning annotation when the LLM API is unavailable, instead of blocking PRs
- **Caller example** — `e2e-tests-caller.yml` shows how to invoke the reusable template

## [1.7.2] - 2026-03-15

### 1.7 — Coverage Gap Closure + Observability

Validated against 835 commits (6 months) of Mattermost history. 63% coverage (3223/5105 files), 118/119 families hit.

### Coverage Improvements

- **Infrastructure file exclusion** — Makefile, go.mod, mocks, i18n, snapshots, mmctl, retrylayer, redux reducers excluded from coverage calculation
- **Test library scanning** — page objects at `lib/src/ui/components/` and server helpers at `lib/src/server/` mapped to families
- **Server tier relaxation** — single-tier server files (e.g., `server/public/model/channel.go`) merge into existing families
- **Types/utils scanning** — files in `src/utils/`, `src/types/`, and monorepo `webapp/platform/types/src/` matched by basename
- **Monorepo path normalization** — validator strips repo-root prefixes for correct matching in monorepos
- **specDir binding** — test spec changes now bind to route families, not just source changes

### Observability

- **Enhanced Logger** — JSON mode (`LOG_FORMAT=json` / `--json`), `timer()` for operation timing
- **CLI flags** — `--verbose` / `-v` for DEBUG output, `--json` for structured logging
- **Train report** — `train-report.json` with phase timings, family counts, coverage stats, LLM metrics
- **LLM metrics** — `requestCount` and `avgResponseMs` surfaced from enricher
- **Pipeline timing** — stage-level timing in `pipeline-report.json`

### Training Pipeline

- `discoverTestLibPaths()` — walks test lib dirs, maps subdirs and files to families
- `discoverNameMatchedPaths()` — scans types/utils/model dirs, matches basenames to families
- `discoverServerDerivedFamilies()` returns `{multiTierFamilies, singleTierFamilies}` for selective merging
- `scanProject()` accepts optional `gitRepoRoot` for monorepo-aware scanning
- `bindWithPrefixes()` in validator for monorepo path normalization

### Stats

- 240 tests across 47 suites (up from 185 in v1.0.0)
- 92 source files, ~124K lines of code

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

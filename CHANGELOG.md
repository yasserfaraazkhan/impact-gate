# Changelog

All notable changes to this project will be documented in this file.

## [2.1.6] - 2026-03-28

### Release Focus

This patch release makes the launch-facing surfaces clearer and more confident for teams evaluating `impact-gate` as a release-readiness tool, not just a pull-request gate.

### Highlights

- **Release-readiness positioning in first-touch docs** — README, quick start, and CLI reference now show how to compare the current candidate against a previous shipped tag and turn that diff into a prioritized test plan.
- **Public repo hygiene improved** — added `CODE_OF_CONDUCT.md`, updated `CONTRIBUTING.md`, and updated `SECURITY.md` so the community and support surfaces match the current 2.x line.
- **Docs-site prep tightened** — docs workflow now uses Node 22 and `npm ci`, `.astro/` is ignored, and the docs site has an explicit Astro content config plus a checked-in lockfile for reproducible installs.
- **NPM metadata now matches the story** — package description now includes release-ready test planning so npm and GitHub better reflect the product's real value.

### Verification

- `npm run lint` — **passes**
- `npm test` — **469 passing, 0 failing**
- `npm run build` in `docs-site` — **still failing** due to a Starlight/Astro docs-entry issue during static route generation, so this release is suitable as a package/docs patch but not yet a full public-docs launch.

## [2.1.5] - 2026-03-28

### Fix

- **[P1] Guard against overwriting dirty files** — `write_file` now checks `git status --porcelain` before the first write to a file. If the file already has uncommitted user changes, the write is blocked. Subsequent writes to files the agent already owns are allowed. Combined with scoped `git_restore`, the fix loop is now safe on dirty branches.

## [2.1.4] - 2026-03-28

### Fix

- **[P0] git_restore scoped to agent files only** — `git_restore` now only discards files the fix agent wrote (`pendingWrittenFiles`), not the entire working tree. Prevents accidental loss of unrelated user work on dirty branches.

## [2.1.3] - 2026-03-28

### Fixes (from Codex review round 2)

- **[P1] Dirty edits after failed validation** — Added `git_restore` tool that discards uncommitted changes. System prompt now instructs the LLM to restore the working tree if validation fails before commit, so failed fix attempts never leave broken edits behind.
- **[P1] Regression mode uses stale findings** — Orchestrator now computes remaining findings (excluding verified fixes) and passes them to both `compareBaselines` and `saveBaseline`, so regression output and saved baselines accurately reflect post-fix state.

## [2.1.2] - 2026-03-28

### Fixes (from Codex review)

- **[P0] git_revert safety** — Fix loop now tracks which commits it created. `git_revert` refuses to revert commits not created by the QA fix loop, preventing accidental rollback of user history.
- **[P1] Post-fix health score** — Verified fixes are now excluded from the post-fix health score computation, so the score accurately reflects remaining issues.
- **[P1] Verification requires explicit confirmation** — `verify_in_browser` now requires a `fixed` boolean parameter. A screenshot alone no longer counts as proof. Verdict upgrades require the LLM to explicitly confirm the bug is gone.
- **[P2] Links health bucket reachable** — Added `links` as a canonical finding category so broken links contribute to the links health score (10% weight) instead of being absorbed into functional.
- **[P2] Baseline comparison fingerprinting** — Regression diffing now uses `flow|type|summary` as the fingerprint instead of summary alone, preventing unrelated issues with generic descriptions from being collapsed.

## [2.1.1] - 2026-03-28

### Fix

- **Security** — Update `minimatch` from ^10.0.0 to ^10.2.3 to resolve ReDoS vulnerabilities (GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74).

## [2.1.0] - 2026-03-28

### QA Agent: Health Scoring, Fix Loop, and Regression Baselines

The autonomous QA agent (`impact-gate-qa`) now includes gstack-inspired quality features.

#### New Features

- **Health score engine** — weighted 0-100 score across 8 categories (console, links, visual, functional, UX, performance, content, accessibility). Deductions per finding severity.
- **Expanded finding taxonomy** — 7 canonical categories replace the original 4 types. Legacy types (`bug`, `visual-regression`, `ux-issue`, `gap`) are mapped automatically.
- **Fix loop (Phase 2.5)** — LLM-driven bug fixing with atomic commits, browser verification, and self-regulation (WTF heuristic stops when quality degrades).
- **Regression baselines** — save/load/compare health scores across runs with `--regression`.
- **Enhanced reports** — health score breakdown, fix results table, regression comparison, ship readiness summary.
- **Verdict upgrades** — verdict now factors in health score and verified fixes. All critical/high fixed = verdict can upgrade from no-go.
- **`install-skill` CLI command** — `npx impact-gate install-skill qa` copies the `/qa` Claude Code skill into your project.

#### New CLI Flags (`impact-gate-qa`)

- `--fix-tier <quick|standard|exhaustive>` — control which findings get fixed
- `--no-fix` — skip the fix loop entirely
- `--regression` — compare against the previous baseline

#### Schema

- Report schema bumped to `1.1.0` (backward compatible with 1.0.0 consumers)

## [2.0.0] - 2026-03-27

### Release Focus

This major release completes the outward rename from `e2e-agents` to `impact-gate` and aligns the package name, CLI names, docs, and repo identity with the product's actual core value: **diff-aware E2E impact analysis and coverage gating for Playwright/Cypress teams. Optional AI features can suggest, generate, and heal tests once your project has a route-families.json manifest.**

### Highlights

- **New package name** — publish under `@yasserkhanorg/impact-gate` instead of `@yasserkhanorg/e2e-agents`.
- **New primary CLI names** — the main executables are now `impact-gate`, `impact-gate-qa`, and `impact-gate-mcp`.
- **Legacy aliases remain for migration** — `e2e-ai-agents`, `e2e-qa-agent`, and `e2e-agents-mcp` still resolve to the same binaries during the transition.
- **Repo and docs now match the new identity** — GitHub URLs, docs-site branding, package metadata, and user-facing examples now point to `impact-gate`.
- **Config migration is gentle** — `impact-gate.config.json` is the preferred config name, while legacy config filenames remain supported.
- **Artifact compatibility is preserved** — `.e2e-ai-agents/` remains unchanged for now so existing CI jobs and local workflows do not break during the rename.

### Migration Notes

- Install the renamed package with `npm i -D @yasserkhanorg/impact-gate`.
- Prefer the new commands in docs, scripts, and CI:
  - `impact-gate`
  - `impact-gate-qa`
  - `impact-gate-mcp`
- Existing artifact paths and older config filenames continue to work during this transition release.

### Verification

- `npm test` — **469 passing, 0 failing**
- `npm pack --dry-run` — **passes**
- CLI smoke checks:
  - `node dist/cli.js --help` -> exit `0`
  - `node dist/qa-agent/cli.js --help` -> exit `0`

## [1.10.2] - 2026-03-27

### Release Focus

This follow-up patch release finishes the CI-first cleanup by making the package language, docs-site homepage/navigation, package metadata, and release notes say the same thing everywhere users first land.

### Highlights

- **Final wording consistency pass** — README, docs-site, `package.json`, and release notes now use the same top-line description and the same product-shape labels: Core CI Workflow, Optional AI Workflow, Setup and Calibration, and Advanced / Experimental.
- **Docs-site entry points are now aligned** — the homepage hero, sidebar navigation, and supporting copy all lead with `impact -> plan -> gate` and keep advanced capabilities clearly secondary.
- **Version bump for a clean release path** — this release publishes the CI-first cleanup under `v1.10.2` rather than rewriting the existing `v1.10.1` tag.

### Verification

- `npm test` — **469 passing, 0 failing**
- CLI smoke checks still match the intended behavior:
  - `node dist/cli.js --help` -> exit `0`
  - `node dist/cli.js` -> exit `1`

## [1.10.1] - 2026-03-27

### Release Focus

This patch release tightens the product around its clearest promise: **Diff-aware E2E impact analysis and coverage gating for Playwright/Cypress teams. Optional AI features can suggest, generate, and heal tests once your project has a route-families.json manifest.**

### Highlights

- **Repositioned the package around the CI-first workflow** — README, docs-site homepage, CLI help, and command reference now point users to `impact -> plan -> gate` first instead of treating every feature as equally primary.
- **Advanced features are now labeled honestly** — crew workflows, MCP integrations, plugins, and the autonomous QA agent are clearly presented as advanced/experimental instead of default entry points.
- **Documentation now matches actual behavior** — quick start, installation, CLI reference, CI guide, deployment guide, and comparison docs were rewritten to remove misleading or overstated claims.

### CLI & Behavior

- **`--help` now exits successfully** — `npx impact-gate --help` returns exit code `0`; invoking the CLI without a command still returns exit code `1`.
- **Help output now reflects the product shape** — commands are grouped into Core CI Workflow, Optional AI Workflow, Setup and Calibration, and Advanced / Experimental sections.
- **`llm-health` now checks the configured or auto-detected provider** — this command no longer implies “probe everything”; it reports the health of the provider path the package would actually use.
- **Crew plugins are exposed through the CLI** — added `--plugins` to the `crew` command so the plugin system is documented and wired end-to-end.

### Generalization & Defaults

- **Generic Playwright is now the default prompt fallback** — generation and healing prompts no longer silently assume Mattermost conventions when no Mattermost profile is selected.
- **Framework support is less hidden** — CLI/config framework handling now accepts and auto-detects `pytest` and `supertest` in addition to Playwright, Cypress, and Selenium.
- **Profiles are clarified** — `profile` is now documented as analysis behavior (`default` or `mattermost`), separate from framework detection.

### Docs & Messaging

- **Homepage and sidebar realigned** — the docs-site hero, description, and navigation now reinforce the CI-first story instead of leading with crew workflows.
- **Threshold docs corrected** — examples now use `--threshold 80` and explicitly describe threshold values as percentage-style (`0-100`).
- **Impact vs. plan artifacts clarified** — `impact` is documented as stdout-first; `plan` is documented as the command that writes `.e2e-ai-agents/plan.json` and `.e2e-ai-agents/ci-summary.md`.
- **Comparison page toned down** — replaced absolute, credibility-damaging language with narrower, more defensible wording.
- **Version and deployment metadata updated** — docs now consistently reflect `1.10.1`.

### Internal Consistency

- **Provider interface now includes health checks** — `checkHealth()` is part of the provider contract, and cached/hybrid providers now implement it cleanly.
- **Public package description updated** — `package.json` now describes the package in the same CI-first terms used by the README and docs.

### Verification

- `npm test` — **469 passing, 0 failing**
- `npm pack --dry-run` — **passes**
- CLI smoke checks:
  - `node dist/cli.js --help` -> exit `0`
  - `node dist/cli.js` -> exit `1`

## [1.10.0] - 2026-03-27

### Oracle Mechanism: Assertion Patterns

- **Assertion patterns in route-families manifest** — Families and features can now define `assertionPatterns` that specify *what correct behavior looks like* (state-change, cross-user, persistence, negative, permission, data-integrity, error-handling). These patterns are injected into the generation prompt, requiring the AI to produce business-logic assertions instead of just `toBeVisible()` checks.
- **End-to-end wiring** — Assertion patterns flow from manifest -> stage1 impact -> FlowDecision -> generation prompt. Previously the field was declared but never populated.
- **Single type source** — `AssertionPattern` type defined once in `route_families.ts`, re-exported from `output_schema.ts` to prevent type drift.

### TypeScript AST-Based API Surface Extraction

- **Replaced regex extraction with TypeScript Compiler API** — `api_surface.ts` now uses `ts.createProgram()` and `ts.TypeChecker` to parse page object source files. This catches:
  - Arrow function properties (`name = async () => {}`)
  - Inherited methods from base classes (e.g., `ConfirmModal extends BaseModal`)
  - Full method signatures with parameter names, types, optional flags, and return types
  - Barrel export files (`index.ts`) are no longer skipped
- **Prompt now shows full signatures** — e.g., `async postMessage(text: string, options?: PostOptions): Promise<void>` instead of `postMessage()`
- **Regex fallback** — Config flag `useRegexFallback` for environments where TS compilation is unavailable
- **`MethodSignature` now includes** `params?: MethodParam[]`, `returnType?: string`, `async?: boolean` — all populated from the AST

### Hallucination Detection

- **Expanded detection patterns** — `detectHallucinatedMethods()` now uses 4 regex patterns instead of 1, catching `await X.Y()`, `const z = X.Y()`, `*Page.method()` (any page object), and `pw/page/this` chained calls
- **Block instead of warn** — When hallucinated methods are detected and `warnOnHallucinations` is not set, specs are moved to `generated-needs-review/` instead of being written to the specs directory
- **Dynamic page object matching** — `\w+Page` pattern replaces hardcoded `channelsPage`

### Coverage Evaluation

- **Total character budget** — Added `MAX_TOTAL_SPEC_CHARS = 200000` (~50K tokens) budget to prevent context window blowout for families with many large spec files
- **Two-tier approach** — All spec titles sent to LLM (compact), full content for top 30 specs only. Specs beyond the content limit appear as title-only summaries.
- **Semantic matching rules** — 6 new rules added to coverage prompt: happy-path doesn't cover negative, one role doesn't cover another, creation doesn't cover editing, "when in doubt choose partial"
- **Increased spec cap** — From 15 to 30 specs per family (with budget guard)

### Historical Failure Correlation

- **New module: `failure_history.ts`** — Tracks which tests fail when certain files change over time
  - `recordFailures()` — Call after test runs to record correlations
  - `getConfidenceBoost()` — Returns 0-20 confidence boost based on historical patterns
  - `getPredictedFailures()` — Returns most likely failing specs for a set of changed files
  - Auto-prunes correlations older than 90 days
  - Stored at `.e2e-ai-agents/failure-history.json`
- **Wired into confidence scoring** — `EvidenceCheck` in `guardrails.ts` now accepts `historyBoost`, and `computeConfidence()` includes it in the score. Files that historically cause test failures get higher confidence -> more likely to trigger test generation.

### Bug Fixes

- **`async` field inconsistency** — Normalized to `true` or `undefined` across all extraction branches (previously could be `false` in JSON cache)
- **`serializeManifest` dropped `assertionPatterns`** — Added to optional arrays list for proper round-trip serialization
- **API test prompt missing assertion patterns** — `buildApiTestPrompt()` now includes assertion pattern block

Tests: 469 pass, 0 failures.

## [1.9.5] - 2026-03-23

### Architecture

- **GenerationProfile threaded through pipeline** — `PipelineConfig` now accepts an optional `profile` field. The pipeline orchestrator resolves it once and passes it to coverage, generation, and heal stages. Non-Mattermost projects no longer get hardcoded Mattermost conventions in pipeline-generated prompts.
- **Consolidated `TestType`/`TestMode`** — Removed duplicate `TestMode` alias from `framework_adapter.ts`; now imports `TestType` from `route_families.ts` as the single canonical type.
- **Shared framework constants** — Extracted `UI_FRAMEWORKS` and `API_FRAMEWORKS` arrays from both `framework_adapter.ts` and `generation_profile.ts` into shared exports to prevent list divergence.
- **`normalizeId` deduplicated** — `training/scanner.ts` now aliases `normalizeToClusterId` from `cluster_utils.ts` instead of maintaining a duplicate function.
- **Unused `edgesBySource` parameter removed** from `buildFamilyFromCluster` in `kg_bridge.ts`.
- **Public API exports** — `index.ts` now exports KG types/bridge, `GenerationProfile`, `RunCommand`, `detectFramework`, `detectTestMode`, `serializeManifest`, and `scanFromKnowledgeGraph`.

### Security

- **`sanitizeForPrompt` coverage complete** — Applied to `agentic/runner.ts` (scenario name, evidence, scenarios), `agentic/fix_loop.ts` (error, stack, testTitle, expected, actual), and `prompts/heal.ts` (flowName, userActions, evidence in flow context).
- **MCP server git `--` separator fixed** — Removed misplaced `--` before revision ranges in `git diff` commands that caused git to interpret refs as filenames.

### Code Quality

- **Shared JSON response extractor** — New `prompts/json_extract.ts` with `extractJsonFromResponse<T>()` replaces 5 identical JSON-from-LLM parsing implementations across impact, coverage, strategist, test-designer, and cross-impact parsers.
- **Dynamic version in train report** — Uses `getVersion()` from new `version.ts` module instead of hardcoded string.

### Testing

- **63 new tests** (406 → 469) covering 7 previously untested modules:
  - `cluster_utils.test.ts` — cluster ID derivation and normalization
  - `kg_bridge.test.ts` — KG loading, classification, transformation, node validation
  - `kg_scanner.test.ts` — KG-to-ScanResult conversion
  - `generation_profile.test.ts` — profile resolution, Mattermost detection
  - `adapters.test.ts` — pytest/supertest adapters, RunCommand, detectTestMode
  - `bootstrap.test.ts` — BootstrapError behavior
  - `serialize_manifest.test.ts` — manifest serialization, empty field stripping

Tests: 469 pass, 0 failures.

## [1.9.4] - 2026-03-23

### Code Quality & Dead Code Elimination

- **Deduplicated `isTestFile`** — Consolidated 3 diverging copies into single export in `agent/git.ts` with superset patterns (`.snap`, `__snapshots__/`).
- **Deduplicated `runGitRaw`** — Exported from `agent/git.ts`; `engine/diff_loader.ts` now imports it.
- **Deduplicated `serializeManifest`** — Extracted superset version to `knowledge/route_families.ts`; both `train` and `bootstrap` commands import it.
- **Deduplicated `deriveClusterId`** — Extracted to shared `knowledge/cluster_utils.ts`; fixed dead camelCase regex that never matched after `.toLowerCase()`.
- **Removed module-level mutable state** in `training/scanner.ts` — `activeInfraFiles`/`activeTiers` replaced with function parameters.

### Bug Fixes

- **`detectTestMode` returned `'ui'` for API-only projects** — Projects with only supertest now correctly return `'api'` instead of `'ui'`.
- **`bootstrap --kg-path` ignored** — `loadKnowledgeGraph` now accepts an optional custom path; the `--kg-path` flag works as documented.
- **Train report version was hardcoded `'1.7.0'`** — Now tracks the actual package version.
- **Division-by-zero** in `HybridProvider.getUsageStats()` — Added `totalRequests > 0` guard.
- **`number-raw` CLI parsing** — Clarified guard logic; NaN/Infinity values properly rejected.
- **O(n²) file dedup in `groupBindings`** — Replaced `Array.includes()` with `Set` for O(1) lookups.

### Security Hardening

- **`buildRunCommand` returns structured `RunCommand`** — All 4 framework adapters now return `{executable, args}` instead of a joined shell string, preventing potential command injection.
- **KG node validation** — `loadKnowledgeGraph` now validates individual nodes: rejects path traversal (`..`, absolute paths, null bytes), truncates excessively long strings, filters invalid nodes.
- **`sanitizeForPrompt` applied across all prompts** — `generation.ts`, `coverage.ts`, `heal.ts` now sanitize user-controlled fields (evidence, userActions, failure details) to defend against prompt injection.
- **KG `buildGlobFromPath`** — Rejects paths containing `..` or null bytes.

### Generalization (Project-Agnostic)

- **Hardcoded "Mattermost" removed from prompts** — `impact.ts`, `cross-impact.ts`, `agentic/runner.ts` now use configurable `projectName` with Mattermost as default fallback.
- **`GenerationProfile` system** — New `generation_profile.ts` with profiles for Mattermost, generic Playwright, and API testing (vitest+supertest, pytest).
- **Prompt builders parameterized** — `test-designer`, `coverage`, `heal`, `generation` prompts accept optional `GenerationProfile`.
- **`bootstrap` command** — New CLI command that transforms Understand-Anything knowledge graphs into route-families.json.
- **Pytest and Supertest adapters** — New framework adapters with proper `detect()` implementations.

### Performance

- **Scanner uses `withFileTypes`** — `walkDirs` now uses `readdirSync({withFileTypes: true})` to avoid separate `lstatSync` calls.

### Documentation & Packaging

- **`.npmignore` expanded** — Excludes `docs/`, `docs-site/`, `test/`, `scripts/`, `.claude/`, `.env` from npm tarball.
- **SECURITY.md** — Replaced placeholder email with GitHub Security Advisories link.
- **DEVELOPMENT.md** — Updated test count from 339+ to 406+.
- **comparison.md** — Updated version reference from v1.8.0 to v1.9.4.
- **`minimatch` added to dependencies** — Was used but only available as transitive dependency of `glob`.
- **`model_router.ts` decoupled** — No longer imports from `crew/types.ts`; uses `string` for agent role keys.
- **Unknown CLI flags** now produce a warning instead of being silently ignored.

### Breaking Changes

- `FrameworkAdapter.buildRunCommand()` now returns `RunCommand` (`{executable, args}`) instead of `string`. Consumers using the return value directly as a shell command must update to use the structured form.
- `loadKnowledgeGraph()` signature changed: now accepts optional `customPath` second parameter.
- `runBootstrapCommand()` no longer accepts `autoConfig` parameter; throws `BootstrapError` instead of calling `process.exit()`.

Tests: 406 pass, 0 failures.

## [1.9.3] - 2026-03-19

### Budget Enforcement (breaking fix)

- **Shared BudgetLedger** — All agents in a crew run share a single budget ledger instead of each having an independent budget check. Parallel agents can no longer independently overshoot the budget by N×limit.
- **Pre-reservation with reconciliation** — Before each LLM call, the provider reserves estimated cost (4096 output tokens × model rate). Parallel agents see in-flight holds and stop before overshoot. Reservations self-heal on failed calls.
- **NaN/negative cost guard** — `BudgetLedger.record()` silently ignores non-finite and negative values to prevent silent budget bypass.

### Resilience

- **CircuitBreaker wired into provider call path** — `BaseProvider.retryCall()` now composes retry-inside-circuit-breaker. After 3 consecutive transient failures, the circuit opens and calls fail fast instead of waiting through retries.
- **Shared circuit breaker per provider type** — All `AnthropicProvider` instances share one breaker (static `Map`). If Anthropic is down, 3 parallel agents discover it in 3 total failures, not 3×3=9.
- **`shouldCount` predicate on CircuitBreaker** — Budget, auth, and validation errors no longer trip the circuit. Only transient provider failures (429, 5xx, network errors) count toward the threshold.

### Plugin System

- **Plugin `phase`/`runAfter` now wired** — `loadPlugins()` reads `plugin.phase` and injects the plugin into the matching workflow phase. Plugins with `runAfter` run sequentially after their dependencies; plugins without run in parallel.
- **Dependency validation** — Warns when `runAfter` references agents not found in the target phase or agent registry.
- **Path traversal blocked** — Plugin paths that resolve outside `process.cwd()` are rejected (prevents `../../etc/evil.js`).

### Security

- **`sanitizeObject` circular reference protection** — `WeakSet`-based tracking prevents stack overflow on self-referencing objects.
- **Plugin sandbox tightened** — relative-path check plus resolved-path containment check.

### Cache

- **Automatic `cache.prune()`** — Expired cache entries are pruned at the start of every `crew` command. Errors are logged instead of silently swallowed.

### CI/CD

- **Test step in publish.yml** — `npm test` runs before `npm publish`, preventing broken releases.

### Testing

- **41 new tests** (406 total, 0 failures):
  - `sanitize.test.ts` — 23 tests: all secret patterns, concurrent regex safety, `sanitizeObject` with nested/null/circular inputs
  - `cli_errors.test.ts` — 18 tests: all exit codes, `classifyError` for every error category

### Exports

- `BudgetLedger` exported from package index for custom provider integrations.
- `CrewContext.budgetLedger` marked `@internal`.

## [1.7.7] - 2026-03-16

### Bug Fixes

- **Comment-only diff filter** — files where the diff only touches comment lines (typo fixes, doc updates) are excluded from impact analysis, preventing false gaps for non-behavioral changes like `// toa → // to a`

## [1.7.6] - 2026-03-16

### Bug Fixes

- **Precise PR test file detection** — `getChangedFiles()` now returns only files matching `TEST_FILE_PATTERNS` (not all filtered files), eliminating base-branch noise that caused false "PR includes E2E tests" softening
- **Targeted gap softening** — PR-included E2E specs are now bound to families via the manifest; only gaps with matching PR specs are softened, preventing unrelated specs from suppressing real gaps
- **Advisory escalation for dedup** — when a family-level gap is suppressed by cross-family dedup, its scenarios are promoted to "new behavior detected" on the covered flow instead of vanishing silently
- **AI prompt context** — userFlows from the manifest are now included in the AI enrichment prompt, giving the LLM behavioral context for store/model-only diffs

## [1.7.5] - 2026-03-16

### Bug Fixes

- **PR-included test files now visible to engine** — `getChangedFiles()` now passes the full unfiltered file list alongside the filtered source files, so the engine can detect when a PR adds Cypress/Playwright specs even though `isRelevantFile()` pre-filters them

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

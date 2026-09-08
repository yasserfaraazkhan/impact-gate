---
title: "Development"
description: "Dev setup, build system, testing, and common pitfalls"
---

## Prerequisites

- Node.js >= 20
- npm or yarn
- Git

## Setup

```bash
git clone https://github.com/yasserfaraazkhan/impact-gate.git
cd impact-gate
npm ci
npm run build
```

## Build System

The project ships both CommonJS and ESM builds from TypeScript source under `src/`. The build compiles to `dist/` with type declarations.

```bash
# Full build
npm run build

# Watch mode for development
npx tsc -p tsconfig.json --watch
```

## Running Tests

```bash
# Run all tests
npm test

# Compile and run a specific test file after building the source
npm run build:test
node --test test-dist/impact_engine.test.js

# Type check the source
npm run lint
```

Tests live under `test/` and compile to `test-dist/`. `npm test` builds CJS/ESM, scripts and tests before running the complete suite. Advisory regressions are in `test/advisory_planning.test.ts` and verify Git identity, conservative fallback, path validation and the absence of provider, test and status writes.

## Documentation development

```sh
npm ci --prefix docs-site
npm run dev:local --prefix docs-site
# Validate the production site, including generated guide navigation
npm run build --prefix docs-site
```

The [advisory guide](../../guides/mattermost-advisory/) documents the isolated Mattermost caller. Merging to `master` deploys changed docs through the existing Pages workflow; npm publication uses a separate version-tag workflow.

## Project Structure

```
src/
  cli/           # CLI entry point, argument parsing, command handlers
  engine/        # Deterministic impact analysis core
  crew/          # Multi-agent orchestration
  agents/        # 10 specialized crew agents
  pipeline/      # 5-stage generation/healing pipeline
  knowledge/     # Route families, API surface, spec index
  training/      # Scanner, enricher, validator for manifests
  providers/     # LLM provider implementations
  adapters/      # Framework-specific adapters
  reporters/     # Output format plugins
  resilience/    # Circuit breaker, retry logic
  cache/         # Response caching
```

## Adding a CLI Command

1. Create `src/cli/commands/your_command.ts` with an async handler
2. Add the command name to the `Command` type union in `src/cli/types.ts`
3. Register dispatch logic in `src/cli.ts`
4. Add flags to `src/cli/parse_args.ts`
5. Add defaults in `src/cli/defaults.ts` if needed

## Common Pitfalls

- **Missing route-families.json**: Ordinary impact analysis may use heuristic fallback; it does not establish behavior coverage. Run `train --no-enrich` to create mapping candidates. Advisory mode instead requires explicit suite configuration and retains full fallback for nonempty diffs.
- **Budget exceeded mid-run**: Set `--budget-usd` high enough for the workflow. Use `--dry-run` to preview cost estimates.
- **Provider not found**: Ensure the correct environment variable is set. Use `llm-health` to verify.
- **Stale cache**: The response cache under `.e2e-ai-agents/cache/` may serve outdated results. Delete the directory to clear it.

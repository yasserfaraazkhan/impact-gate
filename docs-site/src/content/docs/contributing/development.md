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
git clone https://github.com/yasserfaraazkhan/e2e-agents.git
cd e2e-agents
npm install
npm run build
```

## Build System

The project ships both CommonJS and ESM builds from TypeScript source under `src/`. The build compiles to `dist/` with type declarations.

```bash
# Full build
npm run build

# Watch mode for development
npm run dev
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- test/impact_engine.test.ts

# Run with verbose output
npm test -- --verbose
```

Tests live under `test/` and cover the engine, pipeline orchestrator, and crew components.

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

- **Missing route-families.json**: Impact analysis returns empty results without the manifest. Run `train --no-enrich` first.
- **Budget exceeded mid-run**: Set `--budget-usd` high enough for the workflow. Use `--dry-run` to preview cost estimates.
- **Provider not found**: Ensure the correct environment variable is set. Use `llm-health` to verify.
- **Stale cache**: The response cache under `.e2e-ai-agents/cache/` may serve outdated results. Delete the directory to clear it.

# Development Guide

This guide covers the practical setup and workflow for contributing to `@yasserkhanorg/e2e-agents`. For architecture and module descriptions, see [ARCHITECTURE.md](../ARCHITECTURE.md). For contribution guidelines and code standards, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

- **Node.js >= 20** (check with `node --version`)
- **npm** (ships with Node.js)
- **TypeScript** knowledge (strict mode, no implicit `any`)
- **Git** for version control

Optional for testing LLM features:
- An Anthropic, OpenAI, or Ollama API key (see README for environment variable names)

## Setup

```bash
git clone https://github.com/yasserfaraazkhan/e2e-agents.git
cd e2e-agents
npm install
npm run build
```

## Build System

The project ships both CommonJS and ESM builds from a single TypeScript source. This dual-build approach allows the CLI to run directly in Node.js (CJS) while bundler consumers can tree-shake with the ESM entry.

### Build Commands

| Command | What It Does |
|---------|-------------|
| `npm run build` | Full build: CJS + ESM (runs `prebuild` clean first) |
| `npm run build:cjs` | CommonJS build via `tsc -p tsconfig.json` — output in `dist/` |
| `npm run build:esm` | ESM build via `tsc -p tsconfig.esm.json` — output in `dist/esm/` |
| `npm run build:test` | Compile test files with `--noCheck` — output in `test-dist/` |
| `npm run build:scripts` | Compile utility scripts via `tsc -p tsconfig.scripts.json` |
| `npm run clean` | Remove `dist/` directory |
| `npm run lint` | Type-check without emitting (`tsc --noEmit`) |

### Why Dual Build

- **CJS (`dist/`)**: The `e2e-ai-agents` CLI binary uses `require()`. Node.js resolves the `"main"` field in `package.json` to `dist/index.js`.
- **ESM (`dist/esm/`)**: Library consumers using `import` get the `"module"` entry at `dist/esm/index.js`, enabling tree-shaking and native ES module support.

Both builds are generated from the same source; the only difference is the `module` and `moduleResolution` settings in the respective tsconfig files.

## Testing

### Running Tests

```bash
# Run all tests (builds first via pretest hook)
npm test

# Run a single test file (must build first)
npm run build && npm run build:test
node --test test-dist/impact_engine.test.js

# Run tests matching a name pattern
node --test --test-name-pattern="impact" test-dist/*.test.js
```

### Test Infrastructure

- **Runner**: Node.js built-in test runner (`node:test`) — no Jest, Mocha, or other frameworks
- **Assertions**: Node.js built-in `node:assert/strict`
- **Test files**: Live in `test/` as `.test.ts` files, compiled to `test-dist/` as `.test.js`
- **Count**: 469+ tests across the full suite

### Adding a New Test

1. Create `test/your_feature.test.ts`
2. Import from `node:test` and `node:assert/strict`:
   ```typescript
   import {describe, it, beforeEach} from 'node:test';
   import assert from 'node:assert/strict';
   ```
3. Import the module under test from the compiled output:
   ```typescript
   import {YourModule} from '../dist/your_module.js';
   ```
4. Write test cases using `describe` / `it` blocks
5. Run: `npm run build && npm run build:test && node --test test-dist/your_feature.test.js`

Note that test files import from `../dist/`, not from `../src/`. Tests run against the compiled JavaScript, not the TypeScript source.

## Common Pitfalls

### Always build before testing

`npm test` runs `pretest` automatically, which builds everything. But if you run `node --test` directly, you must build first. Stale `dist/` or `test-dist/` output is a common source of confusing test failures.

### ESM imports need `.js` extensions

TypeScript source files must use `.js` extensions in import paths, even though the source files are `.ts`:

```typescript
// Correct
import {logger} from './logger.js';

// Wrong — will fail at runtime
import {logger} from './logger';
import {logger} from './logger.ts';
```

This is required by the Node.js ESM resolver and applies to both the CJS and ESM builds.

### Multiple tsconfig files

The project has several tsconfig files (`tsconfig.json`, `tsconfig.esm.json`, `tsconfig.test.json`, `tsconfig.scripts.json`). Editing one may affect others if they share `extends` or `references`. When changing compiler options, verify that all build commands still succeed:

```bash
npm run build && npm run build:test && npm run build:scripts
```

### Type-check before committing

Run `npm run lint` to type-check without building. This is faster than a full build and catches type errors early.

## Development Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feat/your-feature
   ```

2. **Make changes in `src/`** — all production code lives here

3. **Type-check**
   ```bash
   npm run lint
   ```

4. **Build and test**
   ```bash
   npm test
   ```

5. **Commit with a conventional prefix**
   ```bash
   git commit -m "feat: add new provider for XYZ"
   ```
   Supported prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `perf:`

6. **Push and open a PR**
   ```bash
   git push origin feat/your-feature
   ```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for PR process details and code standards.

## Useful Commands Reference

| Task | Command |
|------|---------|
| Full build | `npm run build` |
| Type-check only | `npm run lint` |
| Run all tests | `npm test` |
| Run one test | `node --test test-dist/your_file.test.js` |
| Clean build artifacts | `npm run clean` |
| Start MCP server locally | `npm run mcp:server` |

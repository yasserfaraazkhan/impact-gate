---
title: "Zero Config"
description: "How auto-detection works and when you need a config file"
---

The CLI auto-detects most settings so you can run commands without any configuration file.

## What Gets Auto-Detected

### Test Framework

The CLI reads your project files and `package.json` dependencies to detect:
- **Playwright** if `@playwright/test` or `playwright` is present
- **Cypress** if `cypress` is present
- **pytest** if `conftest.py`, `pytest.ini`, or pytest config in `pyproject.toml` / `setup.cfg` is present
- **supertest** if `supertest` is in your npm dependencies (runs via Vitest or Jest)
- **Selenium** if `selenium-webdriver` or `webdriverio` is present

### Tests Root

Scans for common directory conventions in order:

```
e2e-tests/playwright, e2e-tests, e2e, tests/e2e, test/e2e,
tests, test, specs, playwright, cypress
```

The first match becomes `--tests-root`.

### Git Base Branch

Queries `git remote show origin` for the HEAD branch, falling back to the current branch. Used as the default `--since` value for diff-based analysis.

### Project Root

Walks up from the current directory until it finds `package.json` or `.git`.

## When You Need a Config File

Create `e2e-ai-agents.config.json` in your project root when you need to:

- Set a **profile** (e.g., `mattermost` for strict mode)
- Configure **dependency graph** depth or traceability settings
- Enable the **pipeline** for test generation
- Define **policy enforcement** rules (advisory, warn, or block)
- Point to a **separate server path** for backend analysis
- Override framework or tests-root detection

The CLI searches for `e2e-ai-agents.config.json` or `.e2e-ai-agents.config.json` starting from the current directory and walking upward.

## Bootstrap: Alternative Setup with a Knowledge Graph

If your project already has an [Understand-Anything](https://github.com/nicholasgriffintn/understand-anything) knowledge graph, the `bootstrap` command can generate your route-families manifest automatically instead of running `train`:

```bash
npx e2e-ai-agents bootstrap --path .
```

Bootstrap reads the knowledge graph, classifies your project (frontend, backend, or fullstack), and produces `.e2e-ai-agents/route-families.json` with prioritized families derived from the graph's nodes and edges. It also auto-detects your test framework and test mode (`ui`, `api`, or `both`).

Use `--dry-run` to preview the manifest before writing, or `--max-families 30` to limit the output. See the [CLI reference](/reference/cli/#bootstrap) for all flags.

## Explicit Flags Always Win

Any CLI flag overrides both auto-detected values and config file settings:

```bash
npx e2e-ai-agents impact \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --framework playwright \
  --since origin/release-9.0
```

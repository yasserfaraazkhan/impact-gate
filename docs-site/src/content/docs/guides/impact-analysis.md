---
title: "Impact Analysis"
description: "Understand how changed files map to impacted test flows"
---

Impact analysis answers a fundamental question: **given a code change, which E2E tests need to run?**

## How It Works

The impact engine takes a git diff and maps each changed file to the route families it belongs to. A route family represents a product feature (e.g., "channels", "messaging", "settings") with associated source paths, test directories, and user flows.

```
channel.go changed
  -> belongs to "channels" family
    -> specs live in specs/functional/channels/
      -> run those tests, flag coverage gaps
```

### Three Mapping Strategies

1. **Route families** -- the `route-families.json` manifest maps source file patterns to features
2. **Dependency graph** -- static reverse-dependency analysis catches transitive impacts (a utility changed, so all consumers are affected)
3. **Traceability** -- file-to-test mappings from CI execution history provide empirical evidence of which tests exercise which files

## Running Impact Analysis

```bash
npx e2e-ai-agents impact --path . --since origin/main
```

The `impact` command prints a deterministic summary to stdout. Use `plan` when you want `.e2e-ai-agents/plan.json` and `.e2e-ai-agents/ci-summary.md` artifacts with `impactedFamilies`, `runSet`, `confidence`, and `decision`.

## Building the Route Families Manifest

For accurate results, build a manifest that maps your codebase to features:

```bash
# Offline scan (free, no API key)
npx e2e-ai-agents train --no-enrich --path .

# With LLM enrichment for better metadata
npx e2e-ai-agents train --path .
```

The scanner uses directory matching, test-derived discovery, server-derived grouping, and name matching to build file-to-family mappings. LLM enrichment adds URL routes, priority levels, and human-readable flow descriptions.

## Interpreting Results

Each impacted family in the output includes:
- **confidence** -- how certain the mapping is (heuristic, traceability, or AI-confirmed)
- **impactLevel** -- direct change vs. transitive dependency
- **runSet** -- the specific spec files to execute
- **gaps** -- user flows with no test coverage for the changed code

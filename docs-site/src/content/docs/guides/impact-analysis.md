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
3. **Traceability** -- explicit per-test source-file coverage maps can supply file-to-test links; execution history alone does not prove those links

## Running Impact Analysis

The recommended way to run impact analysis is through the `review` command, which combines impact analysis, behavior analysis, coverage planning, and defect prediction:

```bash
# Unified review: impact + coverage gaps + defect risk + recommendations
npx impact-gate review --path . --since origin/main

# Review + generate test files for uncovered flows
npx impact-gate review --path . --since origin/main --generate
```

For lower-level access, the `impact` command outputs just the impact analysis:

```bash
npx impact-gate impact --path . --since origin/main
```

Use `plan --no-ai` for deterministic `.e2e-ai-agents/plan.json` and `.e2e-ai-agents/ci-summary.md` artifacts with a run set, heuristic confidence and a decision. The complete diff retains CI, dependency, config, E2E and unknown files; unassessed changes request the full suite. Invalid refs fail rather than becoming empty diffs.

For the isolated JSON-only caller, use [Mattermost advisory planning](../mattermost-advisory/). It reads explicit suite configuration, selects committed static spec paths and keeps every nonempty diff on full fallback without model, test or status writes.

## Building the Route Families Manifest

For accurate results, build a manifest that maps your codebase to features:

```bash
# Offline scan (free, no API key)
npx impact-gate train --no-enrich --path .

# With LLM enrichment for better metadata
npx impact-gate train --path .
```

The scanner uses directory matching, test-derived discovery, server-derived grouping, and name matching to build file-to-family mappings. LLM enrichment adds URL routes, priority levels, and human-readable flow descriptions.

## Interpreting Results

Interpret family mappings as candidate relationships, not proof of behavior coverage. The plan contains:

- **confidence** -- a heuristic score, not a measured probability; advisory reports use `null` and `confidenceKind: "unavailable"`
- **runSet** -- a run-set category such as `full` or `targeted`
- **recommendedTests** -- selected spec paths
- **requiredNewTests** and **gapDetails** -- mapping gaps requiring review; spec presence alone does not prove a changed behavior is asserted

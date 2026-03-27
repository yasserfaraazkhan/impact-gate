---
title: "Troubleshooting"
description: "Common problems, what they usually mean, and how to fix them"
---

## Impact Analysis Returns Almost Nothing

Common causes:

- no `route-families.json` yet
- changed files are not represented in the manifest
- `--path` or `--tests-root` points at the wrong place
- the diff base from `--since` is not what you expected

Start with:

```bash
npx impact-gate impact --path . --since origin/main
npx impact-gate train --no-enrich --path .
```

## Confidence Feels Too Low

Low confidence usually means the tool lacks evidence, not that it is broken.

Improve confidence by:

- refining `route-families.json`
- ingesting traceability data from CI
- narrowing the diff base
- fixing unmapped source paths

## Too Many Files Show Up As Unmapped

This usually points to a manifest-quality problem.

Review:

- missing frontend/server paths
- renamed directories
- new features without family coverage
- helper files that should be attached through dependency or name matching

## `generated-needs-review/` Keeps Filling Up

That means the hallucination guardrails are doing their job.

Common reasons:

- missing or incomplete page-object extraction
- stale route-family context
- generation being asked to cover flows with weak evidence
- project-specific helpers not reflected in the local API surface

Treat this as a signal to improve grounding, not as a reason to disable the guardrails.

## AI Provider Problems

Check the configured provider first:

```bash
npx impact-gate llm-health
```

Then verify that the correct environment variable is actually set for your shell or CI runtime.

## CI Output Is Hard To Interpret

Look at the written artifacts instead of relying only on console output:

- `.e2e-ai-agents/plan.json`
- `.e2e-ai-agents/ci-summary.md`
- `.e2e-ai-agents/metrics-summary.json`

Those are usually the clearest source of truth.

## Release Diff Looks Too Broad

This usually means the release comparison is correct but your knowledge layer is too coarse.

Try:

- tightening route-family scopes
- improving spec directory mappings
- adding traceability data
- checking whether the chosen base tag is too old

## What To Fix First

If you are onboarding a repository, improve things in this order:

1. route-family manifest quality
2. tests-root and framework detection
3. traceability ingestion
4. CI artifacts and gate thresholds
5. optional AI generation and healing

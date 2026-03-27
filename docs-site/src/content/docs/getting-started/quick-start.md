---
title: "Quick Start"
description: "Get from install to impact results and release-ready test planning in three steps"
---

Go from zero to impact analysis in under a minute. All three steps below are free-tier and require no API key.

## Step 1: Install

```bash
npm install -D @yasserkhanorg/impact-gate
```

## Step 2: Run Impact Analysis

Point the tool at your project and diff against your base branch:

```bash
npx impact-gate impact --path . --since origin/main
```

This parses the git diff, maps changed files to route families, and reports which E2E test flows are impacted.

For release readiness, point the same workflow at the previous shipped tag or release branch:

```bash
npx impact-gate impact --path . --since v2.1.0
```

## Step 3: View the Results

The `impact` command prints a deterministic summary to stdout. To write coverage artifacts with gap analysis, run `plan`:

```bash
npx impact-gate plan --path . --since origin/main
```

This produces:
- **`.e2e-ai-agents/plan.json`** -- structured plan with run sets and confidence scores
- **`.e2e-ai-agents/ci-summary.md`** -- markdown summary suitable for PR comments

Use the exact same command for a release-diff test plan:

```bash
npx impact-gate plan --path . --since v2.1.0
```

That gives you a release-focused view of impacted flows, current coverage, and what still needs tests or manual validation before shipping.

## What Next?

- Run `train --no-enrich` to build the route-families manifest for better accuracy
- Add `gate --threshold 80` in CI once `plan` output looks trustworthy
- **Non-Mattermost projects**: if you have an Understand-Anything knowledge graph, run `bootstrap` instead of `train` to auto-generate route families from the graph. See [Zero Config -- Bootstrap](./zero-config/#bootstrap-alternative-setup-with-a-knowledge-graph) for details.
- Try `crew --workflow quick-check` later if you want AI-powered strategy recommendations on top of the core CI loop
- Add a [CI integration](../guides/ci-integration/) to gate PRs on coverage
- Set up [cost controls](../guides/cost-management/) before enabling AI features

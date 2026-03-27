---
title: "Quick Start"
description: "Get from install to impact results in three steps"
---

Go from zero to impact analysis in under a minute. All three steps below are free-tier and require no API key.

## Step 1: Install

```bash
npm install @yasserkhanorg/e2e-agents
```

## Step 2: Run Impact Analysis

Point the tool at your project and diff against your base branch:

```bash
npx e2e-ai-agents impact --path . --since origin/main
```

This parses the git diff, maps changed files to route families, and reports which E2E test flows are impacted.

## Step 3: View the Results

The `impact` command prints a deterministic summary to stdout. To write coverage artifacts with gap analysis, run `plan`:

```bash
npx e2e-ai-agents plan --path . --since origin/main
```

This produces:
- **`.e2e-ai-agents/plan.json`** -- structured plan with run sets and confidence scores
- **`.e2e-ai-agents/ci-summary.md`** -- markdown summary suitable for PR comments

## What Next?

- Run `train --no-enrich` to build the route-families manifest for better accuracy
- Add `gate --threshold 80` in CI once `plan` output looks trustworthy
- **Non-Mattermost projects**: if you have an Understand-Anything knowledge graph, run `bootstrap` instead of `train` to auto-generate route families from the graph. See [Zero Config -- Bootstrap](/getting-started/zero-config/#bootstrap-alternative-setup-with-a-knowledge-graph) for details.
- Try `crew --workflow quick-check` later if you want AI-powered strategy recommendations on top of the core CI loop
- Add a [CI integration](/guides/ci-integration) to gate PRs on coverage
- Set up [cost controls](/guides/cost-management) before enabling AI features

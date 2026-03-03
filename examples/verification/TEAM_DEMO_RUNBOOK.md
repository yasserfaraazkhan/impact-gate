# Team Demo Runbook: `@yasserkhanorg/e2e-agents`

## 1) Demo goal (what the team should leave with)

- This tool turns code changes into a risk-aware test plan.
- It identifies impacted flows, maps tests, and surfaces gaps.
- It can propose/generate tests for uncovered high-priority flows.
- It can feed CI decisions (`smoke`, `targeted`, `full`) and PR comments.

## 2) Environment checklist (do this before the meeting)

From your app repo (example: Mattermost monorepo):

```bash
node -v
npm -v
git fetch origin
```

Expected:

- Node is `>=20` (recommended `22`).
- You have an up-to-date base ref (`origin/master` or your team default).
- A tests root exists and is valid.

Optional confidence check from this package repo:

```bash
cd /Users/yasserkhan/Documents/mattermost/e2e-agents
node dist/cli.js --help
```

## 3) 15-minute live script

### Minute 0-2: set context

Say:

- "I’ll show how we move from changed files to a justified run-set and optional test generation."
- "The key artifacts are `impact.json`, `gap.json`, and `plan.json`."

### Minute 2-6: recommendation phase (`suggest`)

Run in app repo:

```bash
npx e2e-ai-agents suggest \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --since origin/master \
  --flow-catalog ./e2e-tests/playwright/.e2e-ai-agents/flows.json
```

Show:

- `./e2e-tests/playwright/.e2e-ai-agents/plan.json`
- `./e2e-tests/playwright/.e2e-ai-agents/impact.json`
- `./e2e-tests/playwright/.e2e-ai-agents/gap.json`

Call out in `plan.json`:

- `runSet` (`smoke|targeted|full`)
- confidence/policy reasons
- `recommendedTests`
- `nextActions`

### Minute 6-10: generation approval phase (`approve-and-generate`)

Run:

```bash
npx e2e-ai-agents approve-and-generate \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --since origin/master \
  --pipeline \
  --pipeline-mcp
```

Say:

- "`suggest` decides what to run; `approve-and-generate` acts on uncovered risk."
- "Pipeline is focused on missing P0/P1 flows, not blanket regeneration."

### Minute 10-12: safe handoff (`finalize-generated-tests --dry-run`)

Run:

```bash
npx e2e-ai-agents finalize-generated-tests \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --dry-run
```

Say:

- "Dry-run previews git mutations."
- "In CI or after review, remove `--dry-run` and optionally add `--create-pr`."

### Minute 12-15: CI integration story

Show:

- `examples/github-actions/pr-impact.yml`
- `examples/github-actions/auto-heal-pr.yml`

Say:

- "The action consumes plan outputs and gates execution by `runSet`."
- "Traceability can be captured from Playwright JSON and ingested over time."

## 4) Golden talking points (short, technical)

- Deterministic mapping is strongest with `--flow-catalog`.
- Without catalog, it falls back to heuristics and traceability.
- `impact` is diff-based; `--allow-fallback` supports repos with no useful diff context.
- Output is auditable (`impactModel`, `runMetadata`, policy reasons).

## 5) What to do if live demo fails

Fallback A (no git diff available):

```bash
npx e2e-ai-agents suggest \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --allow-fallback
```

Fallback B (MCP unavailable):

```bash
npx e2e-ai-agents approve-and-generate \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --since origin/master \
  --pipeline \
  --pipeline-mcp \
  --pipeline-mcp-allow-fallback
```

Fallback C (show static artifacts only):

- Open previously generated `impact.json`, `gap.json`, and `plan.json`.
- Walk the decision path from changed files -> impacted flows -> recommended tests.

## 6) Quick Q&A prep

- "How is confidence derived?" -> Combination of mapping quality, warnings, risk policy, and coverage signals.
- "Can this be advisory-only?" -> Yes, use policy `enforcementMode=advisory` and avoid fail-on flags.
- "How do we keep mappings accurate?" -> Maintain flow catalog + continuously ingest traceability from CI.
- "What is the smallest adoption slice?" -> Start with `suggest` in PRs, no generation, no blocking.

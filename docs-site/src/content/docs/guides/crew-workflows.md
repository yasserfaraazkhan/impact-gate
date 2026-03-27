---
title: "Crew Workflows"
description: "Choose between quick-check, design-only, and full-qa workflows"
---

The Crew system orchestrates 10 specialized AI agents for deep test analysis. Three preset workflows control how many agents run and what artifacts they produce.

## Workflows at a Glance

| Workflow | Agents | Cost | Time | Output |
|----------|--------|------|------|--------|
| `quick-check` | 4 (understand + strategize) | ~$0.10 | ~1 min | Strategy recommendations |
| `design-only` | 6 (+ design phase) | $0.50-2.00 | 5-40 min | Structured test designs |
| `full-qa` | 10 (+ generate, execute, heal) | $2-5 | 10-60 min | Generated and healed specs |

## quick-check

Best for PR triage. Runs impact analysis, cross-impact detection, regression risk scoring, and strategy recommendations. No test code is generated.

```bash
npx impact-gate crew --workflow quick-check \
  --path . --tests-root ./e2e-tests --since origin/main
```

## design-only

Adds structured test case design on top of quick-check. Produces `TestCase[]` objects with preconditions, steps, expected outcomes, and rationale. Useful for handing off to human test authors or reviewing AI-suggested coverage.

```bash
npx impact-gate crew --workflow design-only \
  --path . --tests-root ./e2e-tests --since origin/main
```

## full-qa

End-to-end: designs tests, generates Playwright specs, executes them, and heals any failures. Use this when you want the tool to produce runnable test code.

```bash
npx impact-gate crew --workflow full-qa \
  --path . --tests-root ./e2e-tests --since origin/main
```

## Common Options

```bash
# Cap spending
--budget-usd 2.00

# JSON output for CI parsing
--json

# Preview without LLM calls
--dry-run

# View cost breakdown after a run
npx impact-gate cost-report --path .
```

## When to Use Each

- **PR review gate**: `quick-check` -- fast, cheap, gives strategy guidance
- **Sprint planning**: `design-only` -- structured test cases for the team to review
- **Automated test creation**: `full-qa` -- generates and validates runnable specs

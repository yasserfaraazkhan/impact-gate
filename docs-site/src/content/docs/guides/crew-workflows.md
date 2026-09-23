---
title: "Crew Workflows"
description: "Experimental multi-agent workflows for analysis and test proposals"
---

The experimental Crew system coordinates existing analysis and generation agents. Three presets control the phases that run. Start with supported `review` and `gate` for diff reporting and spec-mapping policy; use Crew when the additional stages serve a concrete need. Agent count alone does not establish better tests.

## Workflows at a Glance

| Workflow | Stages | Intended output |
| --- | --- | --- |
| `quick-check` | Understand and strategize | Strategy recommendations |
| `design-only` | Also design scenarios | Structured test designs |
| `full-qa` | Also generate, execute, and attempt repair | Test proposals and execution results |

Provider cost and duration depend on input size, selected models, and execution outcomes. These are experimental capabilities, not measured latency or cost guarantees.

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

Attempts test design, Playwright generation, execution, and repair. Inspect every result and its verification state. Generated artifacts carrying verification evidence bypass the later legacy healer to avoid invalidating that evidence. Missing evidence and browser-served application targets remain unverified; see [AI guardrails](../ai-guardrails/).

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

- **Analysis experiment**: `quick-check` gives strategy guidance; it is not a release gate
- **Sprint planning**: `design-only` -- structured test cases for the team to review
- **Test authoring experiment**: `full-qa` produces proposals with explicit verification limits

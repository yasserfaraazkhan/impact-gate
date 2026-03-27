---
title: "How Impact Gate Works"
description: "The end-to-end model behind diff analysis, planning, gating, and optional AI"
---

`impact-gate` is easiest to understand as a pipeline:

1. **Read a diff**
2. **Map changed files to user-facing product areas**
3. **Compare those areas to existing E2E coverage**
4. **Produce a plan and a gate decision**
5. **Optionally use AI to generate or heal tests with guardrails**

## Core Mental Model

The product is not "an AI test generator" first. Its strongest path is deterministic:

- read a git diff
- determine what changed
- determine what should run
- determine what is missing
- decide whether the current PR or release candidate is ready

That deterministic path is why `impact`, `plan`, and `gate` are the core commands.

## Step 1: Diff In

Everything starts with a git comparison. In practice, teams use:

- `origin/main` for pull requests
- a previous release tag for release readiness
- a hotfix branch base for emergency verification

Example:

```bash
npx impact-gate plan --path . --since v2.1.0
```

## Step 2: Knowledge Layer

The diff is interpreted through project knowledge:

- **route families** map code paths to features and flows
- **dependency graph** catches transitive impacts
- **traceability** adds file-to-test evidence from CI history
- **historical failure data** can raise confidence that an area needs attention

This is what turns "these files changed" into "these user flows and tests matter."

## Step 3: Coverage Planning

`plan` produces a structured answer to:

- what is impacted
- what should run now
- what confidence we have in that decision
- what flows appear under-covered
- whether new tests or more manual verification are needed

The main artifacts are written under `.e2e-ai-agents/`.

## Step 4: Gate Decision

`gate` turns the plan into a CI decision. This is where you decide how strict to be:

- advisory while onboarding
- threshold-based blocking once the manifest is trustworthy
- stronger enforcement for release branches or critical paths

## Step 5: Optional AI With Guardrails

AI enters after the deterministic evidence is already established.

The AI layer is used to:

- enrich flow understanding
- generate specs for uncovered gaps
- heal failing generated specs
- power deeper exploratory or crew workflows

But the project does not treat raw LLM output as trustworthy by default. The generation path uses local API-surface grounding, prompt sanitization, hallucination detection, quarantine into `generated-needs-review/`, compile checks, and smoke-run verification.

See [AI Guardrails](../guides/ai-guardrails/) for the full safety model.

## Why This Matters

This design keeps the strongest story grounded in engineering evidence:

- the diff explains why you are testing
- the manifest explains what feature was affected
- the plan explains what is covered
- the gate explains whether confidence is high enough
- the AI layer helps only after that foundation is already in place

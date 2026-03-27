---
title: "Release Readiness"
description: "Use impact-gate to compare releases and build a ship-focused test plan"
---

One of the strongest workflows in `impact-gate` is release comparison:

- compare the current release candidate to the last shipped tag
- determine which flows changed
- review which tests already cover those flows
- see where more testing or manual validation is still needed before ship

## Typical Release Diff

```bash
npx impact-gate plan --path . --since v2.1.0
```

That tells the tool: "treat `v2.1.0` as the already-shipped baseline, and build the test plan for everything that changed after it."

## When Teams Use This

- release branch vs previous stable tag
- release candidate vs last production release
- hotfix branch vs current production tag
- milestone validation before a coordinated rollout

## Recommended Workflow

1. Run `impact` to see the raw impacted families.
2. Run `plan` to produce run sets and gap analysis.
3. Review `.e2e-ai-agents/ci-summary.md` and `.e2e-ai-agents/plan.json`.
4. Run `gate` if you want an explicit threshold-based pass/fail decision.
5. If gaps are important and the manifest is good, use AI generation to create targeted tests.

## Artifacts To Review

The release-readiness path is most useful when you inspect the written artifacts, not just stdout:

- `.e2e-ai-agents/plan.json`
- `.e2e-ai-agents/ci-summary.md`
- `.e2e-ai-agents/metrics-summary.json`

These artifacts are useful for release notes, QA sign-off, and CI reporting.

## Example Release Checklist

- Has every P0 or P1 impacted family been reviewed?
- Is the run set small enough to be actionable?
- Are there any `must-add-tests` decisions?
- Are there changed files with no family mapping?
- Are there risky areas with low confidence?
- Do the generated or existing specs still need manual verification?

## Recommended CI Pattern

Use the deterministic plan on every release-candidate branch first. Then add AI generation or healing only when the route-family manifest is already reliable enough to trust.

That keeps the release process grounded in evidence rather than turning release readiness into a prompt-only exercise.

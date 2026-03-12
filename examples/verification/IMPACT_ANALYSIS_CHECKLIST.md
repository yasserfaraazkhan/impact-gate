# Impact Analysis Checklist

This checklist turns impact analysis into a repeatable gate for this repo.

## 1) Required Inputs

Before evaluating recommendations, ensure these inputs exist:

- Git diff baseline (`--since <ref>`) so changed files are deterministic.
- `impact.json` from `suggest` / `impact` run.
- `plan.json` from `suggest` run.
- Optional but strongly recommended:
  - flow catalog (`--flow-catalog`) for deterministic flow mapping.
  - traceability manifest (`.e2e-ai-agents/traceability.json`) from recent CI execution.
  - subsystem risk map (`.e2e-ai-agents/subsystem-risk-map.json`) for high-blast-radius overrides.

## 2) Scoring Model (Implemented in Code)

Flow/file scoring is computed in [src/agent/analysis.ts](/Users/yasserkhan/Documents/mattermost/e2e-agents/src/agent/analysis.ts):

- Base per-file score starts at `1`.
- Additive boosts:
  - screen-level change: `+3`
  - component change: `+2`
  - UI logic file (`tsx/jsx`): `+2`
  - state/data-flow file: `+2`
  - style-only file: `+1`
  - interaction signal (`onClick`, submit handlers, etc.): `+2`
  - critical keyword hit: `+2`
  - subsystem-risk score delta from map: `+N/-N`
- Priority thresholds (defaults in [src/agent/config.ts](/Users/yasserkhan/Documents/mattermost/e2e-agents/src/agent/config.ts)):
  - `P0` if score `>= 7`
  - `P1` if score `>= 4`
  - otherwise `P2`
- Optional subsystem risk rules can raise priority floor (`P2 -> P1`, `P1 -> P0`).

## 3) Output JSON Contract

Outputs are written to `<tests-root>/.e2e-ai-agents/`:

- `impact.json` schema: [schemas/impact.schema.json](/Users/yasserkhan/Documents/mattermost/e2e-agents/schemas/impact.schema.json)
- `plan.json` schema: [schemas/plan.schema.json](/Users/yasserkhan/Documents/mattermost/e2e-agents/schemas/plan.schema.json)

Minimum acceptance checks:

- `impact.mode = "impact"` and non-empty `flows`.
- `impact.runMetadata` has `runId`, timestamps, `sinceRef`, `appPath`, `testsRoot`.
- `impact.impactModel` present with mapping and confidence metadata.
- `plan.source = "impact"` and `runSet in {smoke,targeted,full}`.
- `plan.requiredNewTests.length === impact.gaps.length`.
- `plan.metrics` totals align with `impact` totals.

## 4) Test-Selection Rules

Selection logic is enforced in [src/agent/plan.ts](/Users/yasserkhan/Documents/mattermost/e2e-agents/src/agent/plan.ts):

- If any trigger rule fires, `runSet = full`.
  - Trigger examples: low confidence, warning threshold, P0+gaps, risky file matches, low traceability coverage, truncated dependency graph.
- Else if `recommendedTests` is non-empty, `runSet = targeted`.
- Else `runSet = smoke`.
- Decision action:
  - `must-add-tests` if any uncovered `P0/P1` flow exists.
  - `safe-to-merge` only when run set is smoke, confidence clears policy threshold, and warnings/gaps are zero.
  - otherwise `run-now`.

## 5) Run the Checklist Gate

Command:

```bash
node scripts/impact-checklist.js --root <tests-root>
```

Strict mode (treat warnings as non-passing):

```bash
node scripts/impact-checklist.js --root <tests-root> --strict
```

The command writes:

- `<tests-root>/.e2e-ai-agents/impact-checklist.json`

Exit codes:

- `0`: pass (or warn when not strict)
- `1`: at least one hard failure
- `2`: no hard failures, but warnings exist in `--strict` mode

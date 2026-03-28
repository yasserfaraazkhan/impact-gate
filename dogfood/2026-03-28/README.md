# Impact Gate Dogfood Run — 2026-03-28

This run dogfoods `impact-gate` in three phases:

1. A bundled Playwright example for a clean public proof.
2. `impact-gate` on itself for zero-config / heuristic fallback validation.
3. A bundled Cypress example for framework-parity proof.

The goal was twofold:

- produce reusable launch evidence for `impact -> plan -> gate`
- surface product and example drift honestly before broader promotion

## Phase 1: Playwright Example

Target repo:

- `examples/playwright-react`

Synthetic diff introduced:

- `src/components/auth/LoginForm.tsx`
- changed `Login` -> `Login with device memory`

Commands run:

```bash
npm run demo:impact
npm run demo:plan
npx impact-gate gate --path . --tests-root e2e --threshold 80 --since HEAD~1
```

Expected outcome:

- `auth` is the impacted family
- the login spec is in the run set
- `plan` is coherent
- `gate` is deterministic

What happened:

- The first true consumer-path install failed because the packaged CLI required `typescript` at runtime, but the package only shipped it as a dev dependency.
- After fixing that packaging issue, the bundled example still did not exercise the intended happy path because its manifest had drifted from the current product contract:
  - the manifest lived at repo root instead of `testsRoot/.e2e-ai-agents/route-families.json`
  - the manifest used the old bare-array shape instead of `{ "families": [...] }`
  - `specDirs` were written relative to the app root (`e2e/auth`) instead of relative to `testsRoot` (`auth`)
- After correcting those example-only issues in a temp proof workspace, the core flow behaved correctly.

Final proof result:

- `impact`: `auth` impacted, `PW=1`, coverage `covered`
- `plan`: `run-now`, confidence `92`, full run set
- `gate`: `100%` coverage, threshold `80%`, `PASSED`

Verdict:

- The product path is credible.
- The bundled example needs maintenance to stay aligned with the current manifest contract.

Evidence:

- `dogfood/2026-03-28/evidence/playwright/impact.log`
- `dogfood/2026-03-28/evidence/playwright/plan.log`
- `dogfood/2026-03-28/evidence/playwright/gate.log`
- `dogfood/2026-03-28/evidence/playwright/plan.json`
- `dogfood/2026-03-28/evidence/playwright/ci-summary.md`
- `dogfood/2026-03-28/evidence/playwright/public-install-failure.log`
- `dogfood/2026-03-28/evidence/playwright/stale-manifest-location-and-shape.log`
- `dogfood/2026-03-28/evidence/playwright/stale-specdirs-impact.log`

## Phase 2: Impact Gate On Itself

This phase is validation, not marketing.

The repo is a TypeScript package with Node tests and docs churn, not a native Playwright/Cypress application, so the expected behavior is heuristic grouping and lower-confidence interpretation.

### Docs / Workflow Slice

Target repo state:

- clean clone at current public HEAD
- diff base: `44fd711`

Observed result:

- `impact` built `1` heuristic family from `1` changed file
- grouped the change into `docs-site`
- `plan` still returned `run-now` with confidence `95`

Takeaway:

- heuristic grouping was understandable
- the tool truthfully said no route-family manifest was present
- but the recommendation is too optimistic for a non-ideal repo shape

### Source Slice

Target repo state:

- clean clone checked out at `ad8bab2`
- diff base: `4058ff5`

Observed result:

- `impact` built `2` heuristic families from `13` changed files
- grouped them into `cli` and `qa-agent`
- `plan` again returned `run-now` with confidence `95`

Takeaway:

- the fallback grouping is understandable and useful enough for orientation
- it tells a truthful story about *where* churn is concentrated
- but the plan layer is still overconfident on this repo shape

Important product observation:

- in both self-repo slices, `impact` reported only uncovered heuristic families
- the generated `plan.json` still reported `run-now` and “Impacted features are covered by existing tests”
- that is a product messaging / decisioning gap for non-ideal targets

Verdict:

- zero-config heuristic fallback is useful for orientation
- it is not yet a trustworthy decision layer for a package repo without native route families / app-shaped E2E coverage

Evidence:

- `dogfood/2026-03-28/evidence/self/docs-impact.log`
- `dogfood/2026-03-28/evidence/self/docs-plan.log`
- `dogfood/2026-03-28/evidence/self/docs-plan.json`
- `dogfood/2026-03-28/evidence/self/docs-ci-summary.md`
- `dogfood/2026-03-28/evidence/self/source-impact.log`
- `dogfood/2026-03-28/evidence/self/source-plan.log`
- `dogfood/2026-03-28/evidence/self/source-plan.json`
- `dogfood/2026-03-28/evidence/self/source-ci-summary.md`

## Phase 3: Cypress Example

Target repo:

- `examples/cypress-nextjs`

Synthetic diff introduced:

- `src/pages/dashboard.tsx`
- changed `Dashboard` -> `Dashboard with trendline cards`

Commands run:

```bash
npm run demo:impact
npm run demo:plan
npx impact-gate gate --path . --tests-root cypress --threshold 80 --since HEAD~1
```

Expected outcome:

- `dashboard` is the impacted family
- Cypress parity holds

What happened:

- the bundled example had drifted from the current Cypress manifest contract:
  - manifest at repo root instead of `testsRoot/.e2e-ai-agents/route-families.json`
  - old bare-array manifest shape
  - used `specDirs` instead of `cypressSpecDirs`
  - `webappPaths` pointed at `src/pages/dashboard/**`, but the example file is `src/pages/dashboard.tsx`
- after correcting those example-only issues in a temp proof workspace, the product path behaved correctly

Final proof result:

- `impact`: `dashboard` impacted, `Cy=1`, coverage `partial`
- `plan`: `targeted`, confidence `92`, `run-now`
- `gate`: `100%` coverage, threshold `80%`, `PASSED`

Verdict:

- the deterministic story is not Playwright-only
- the bundled Cypress example needs the same maintenance pass as the Playwright example

Evidence:

- `dogfood/2026-03-28/evidence/cypress/impact.log`
- `dogfood/2026-03-28/evidence/cypress/plan.log`
- `dogfood/2026-03-28/evidence/cypress/gate.log`
- `dogfood/2026-03-28/evidence/cypress/plan.json`
- `dogfood/2026-03-28/evidence/cypress/ci-summary.md`
- `dogfood/2026-03-28/evidence/cypress/stale-cypress-mapping-impact.log`

## Findings

### Fixed During Dogfood

1. The packaged CLI required `typescript` at runtime, but `package.json` only shipped it as a dev dependency.

### Captured For Follow-up

1. Bundled example manifests have drifted from the current route-family contract.
2. Self-repo fallback is understandable, but `plan` remains too optimistic when heuristic families are uncovered.
3. The self-repo output location under `test/.e2e-ai-agents` is surprising for package-style repos and should be documented or revisited.

## Recommended Next Actions

1. Fix both bundled examples in-repo so they match the current manifest contract.
2. Add a repeatable dogfood script that runs the three phases automatically.
3. Revisit self-repo / heuristic-only decision messaging so uncovered P2 heuristic families do not read as “covered by existing tests.”
4. Consider a dedicated package-install smoke test in CI so runtime dependency drift is caught before publish.

## Follow-through After The Run

The repo was updated after this dogfood pass to keep the public examples and docs aligned with the current contract:

1. Both bundled examples now use `impact-gate.config.json`.
2. Their manifests now live under `<testsRoot>/.e2e-ai-agents/route-families.json`.
3. The manifests now use the top-level `{ "families": [...] }` shape.
4. The Cypress example now uses `cypressSpecDirs` and exact page-file bindings.
5. The public docs now describe heuristic fallback more honestly.

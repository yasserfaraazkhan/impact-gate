# Example: Cypress + Next.js

This example demonstrates the `impact-gate` workflow on a minimal Cypress + Next.js project. It includes a pre-trained route-families manifest, sample page components, and Cypress test specs so you can run impact analysis and coverage planning immediately.

## What's Included

- **2 route families** (`dashboard`, `profile`) pre-configured in `cypress/.e2e-ai-agents/route-families.json`
- **Next.js page placeholders** in `src/pages/` mapped to each family
- **Cypress specs** in `cypress/e2e/` covering dashboard overview and profile editing
- **Config file** (`impact-gate.config.json`) with `framework: "cypress"`

## How to Run

Install dependencies (optional for analysis):

```bash
npm install
```

### 1. Impact Analysis

Determine which test families are affected by recent code changes:

```bash
npm run demo:impact
```

This runs `impact-gate impact` against the last commit. It reads the route-families manifest from `cypress/.e2e-ai-agents/route-families.json`, compares it to the git diff, and reports which families and specs are impacted. No API key needed.

### 2. Coverage Plan

Generate a coverage plan with gap analysis:

```bash
npm run demo:plan
```

This identifies missing test coverage and recommends scenarios to add. Outputs a structured plan to `cypress/.e2e-ai-agents/plan.json`.

### 3. Crew Dry Run

Preview what the multi-agent crew would do without making LLM calls:

```bash
npm run demo:dry-run
```

This simulates the `quick-check` workflow, showing which agents would run and what inputs they would receive.

## Try With Your Own Changes

1. Edit a source file, for example `src/pages/dashboard.tsx`
2. Stage and commit: `git add -A && git commit -m "test change"`
3. Run impact analysis: `npm run demo:impact`
4. Observe that the `dashboard` family is flagged as impacted

## Project Structure

```
cypress-nextjs/
  impact-gate.config.json        # CLI configuration
  src/pages/
    dashboard.tsx                # Mapped to "dashboard" family
    profile.tsx                  # Mapped to "profile" family
  cypress/e2e/
    .e2e-ai-agents/
      route-families.json        # Pre-trained family manifest
    dashboard/overview.cy.ts     # Cypress spec for dashboard
    profile/edit.cy.ts           # Cypress spec for profile
```

## Next Steps

- See the [main README](../../README.md) for full CLI reference and CI integration
- Try `impact-gate train --path . --no-enrich` to rebuild the manifest from scratch
- Compare with the [Playwright + React example](../playwright-react/) for a different framework setup
- The current manifest shape is `{ "families": [...] }`, and Cypress examples use `cypressSpecDirs` relative to `cypress/`

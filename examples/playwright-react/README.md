# Example: Playwright + React

This example demonstrates the full `impact-gate` workflow on a minimal Playwright + React project. It includes a pre-trained route-families manifest, sample source components, and E2E test specs so you can run impact analysis, coverage planning, and crew dry-runs out of the box.

## What's Included

- **3 route families** (`auth`, `channels`, `settings`) pre-configured in `.e2e-ai-agents/route-families.json`
- **Source placeholders** in `src/components/` mapped to each family
- **Playwright specs** in `e2e/` covering login, channel listing, and profile settings
- **Config file** (`impact-gate.config.json`) pointing to the local project structure

## How to Run

Install dependencies (not strictly required for analysis, but sets up the project):

```bash
npm install
```

### 1. Impact Analysis

Determine which test families are affected by recent code changes:

```bash
npm run demo:impact
```

This runs `impact-gate impact` against the last commit. It reads the route-families manifest, compares it to the git diff, and reports which families and specs are impacted. No API key needed.

### 2. Coverage Plan

Generate a coverage plan with gap analysis:

```bash
npm run demo:plan
```

This builds on the impact results to identify missing test coverage and recommend which scenarios to add. Outputs a structured plan to `.e2e-ai-agents/plan.json`.

### 3. Crew Dry Run

Preview what the multi-agent crew would do without making LLM calls:

```bash
npm run demo:dry-run
```

This simulates the `quick-check` workflow, showing which agents would run and what inputs they would receive. Useful for understanding the crew pipeline before spending API credits.

### 4. Interactive Demo Script

Run the bundled demo script for a formatted walkthrough:

```bash
npm run demo
```

## Try With Your Own Changes

1. Edit any source file, for example `src/components/auth/LoginForm.tsx`
2. Stage and commit the change: `git add -A && git commit -m "test change"`
3. Run impact analysis again: `npm run demo:impact`
4. Observe that the `auth` family is now flagged as impacted

This feedback loop is the core workflow: change code, run impact, see which tests matter.

## Project Structure

```
playwright-react/
  impact-gate.config.json    # CLI configuration
  .e2e-ai-agents/
    route-families.json         # Pre-trained family manifest
  src/components/
    auth/LoginForm.tsx          # Mapped to "auth" family
    channels/ChannelList.tsx    # Mapped to "channels" family
    settings/ProfileSettings.tsx # Mapped to "settings" family
  e2e/
    auth/login.spec.ts          # Playwright spec for auth
    channels/channel-list.spec.ts
    settings/profile.spec.ts
```

## Next Steps

- See the [main README](../../README.md) for full CLI reference and CI integration
- Try `impact-gate train --path . --no-enrich` to rebuild the manifest from scratch
- Add an `ANTHROPIC_API_KEY` and run `npm run demo:plan` for AI-enriched recommendations

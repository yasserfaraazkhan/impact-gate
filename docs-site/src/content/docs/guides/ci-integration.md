---
title: "CI Integration"
description: "Run impact analysis and coverage gating in GitHub Actions"
---

Add E2E coverage checks to your pull request workflow to catch untested changes before they merge.

## GitHub Actions Example

```yaml
name: E2E Coverage Check
on:
  pull_request:
    branches: [main, master]

jobs:
  e2e-coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install e2e-agents
        run: npm install @yasserkhanorg/e2e-agents

      - name: Run coverage check
        run: |
          npx e2e-ai-agents plan \
            --since origin/${{ github.base_ref }} \
            --fail-on-must-add-tests \
            --github-output "$GITHUB_OUTPUT"
```

## Gate Command

The `gate` command provides a pass/fail check based on a confidence threshold:

```bash
npx e2e-ai-agents gate --threshold 80 --path .
```

This exits non-zero if overall coverage falls below the threshold, making it suitable as a required status check. `--threshold` uses percentage-style values (`0-100`).

## CI Artifacts

Every run produces files under `.e2e-ai-agents/`:

| File | Purpose |
|------|---------|
| `.e2e-ai-agents/plan.json` | Structured plan with run sets, confidence, and decisions |
| `.e2e-ai-agents/ci-summary.md` | Markdown summary for PR comments |
| `.e2e-ai-agents/metrics-summary.json` | Aggregated run metrics |
| `.e2e-ai-agents/metrics.jsonl` | Append-only metric log |

## JSON Output for Parsing

Use `--json` to get structured log output suitable for CI pipelines:

```bash
npx e2e-ai-agents plan --json --path . --since origin/main
```

## Free-Tier CI

For zero-cost CI runs, skip AI enrichment:

```bash
npx e2e-ai-agents impact --path . --since origin/${{ github.base_ref }}
npx e2e-ai-agents plan --path . --since origin/${{ github.base_ref }}
```

These commands use deterministic analysis only and require no API key. Add provider env vars only when you intentionally want AI enrichment on top of this baseline.

# Deployment Guide

This document covers installation, upgrades, rollback procedures, degraded-mode operation, CI integration, and monitoring for `@yasserkhanorg/e2e-agents`.

## Installation

```bash
npm install @yasserkhanorg/e2e-agents
```

Requires Node.js >= 20. The package ships both CommonJS and ESM builds and exposes three CLI binaries: `e2e-ai-agents`, `e2e-qa-agent`, and `e2e-agents-mcp`.

After installation, verify the CLI is available:

```bash
npx e2e-ai-agents --help
```

For first-time setup, run the init command to generate a config file:

```bash
npx e2e-ai-agents init --path /path/to/project
```

## Compatibility Matrix

| e2e-agents | Node.js   | Playwright | Cypress  |
|------------|-----------|------------|----------|
| 1.9.x      | >= 20.0.0 | >= 1.40.0  | >= 13.0  |

**LLM providers:** Anthropic SDK ^0.73.0, OpenAI SDK ^4.73.0, or any local Ollama instance. The `agent-browser` peer dependency (>= 0.18.0) is optional and only required for the autonomous QA agent (`e2e-qa-agent`).

## Upgrading

1. Install the latest version:

```bash
npm install @yasserkhanorg/e2e-agents@latest
```

2. Run your project's test suite to verify compatibility:

```bash
npm test
```

3. Check the CHANGELOG.md for breaking changes between your previous version and the new one. Pay special attention to changes in `CrewContext` fields if you use the programmatic API or custom plugins (see [PLUGIN_API_STABILITY.md](./PLUGIN_API_STABILITY.md)).

4. If you use the crew workflow, run a quick dry-run to confirm orchestration still works:

```bash
npx e2e-ai-agents crew --workflow quick-check --dry-run --path /path/to/project --tests-root ./e2e-tests --since origin/master
```

## Rollback

If an upgrade introduces issues, revert to the previous working version:

```bash
npm install @yasserkhanorg/e2e-agents@<previous-version>
```

Optionally clear cached analysis artifacts to avoid stale data from the newer version:

```bash
rm -rf .e2e-ai-agents/cache/
```

Route families (`route-families.json`), traceability data, calibration metrics, and feedback files are version-independent and safe to keep across upgrades and rollbacks.

## Degraded Mode

When LLM providers are unavailable — during outages, in air-gapped environments, or when no API keys are configured — you can run in degraded mode:

```bash
npx e2e-ai-agents impact --path /path/to/project
npx e2e-ai-agents plan --path /path/to/project
```

In degraded mode:

- **Deterministic analysis continues working.** The `impact` and `plan` commands use the route-families manifest, dependency graph, and traceability data to produce results without any LLM calls.
- **AI-powered features are skipped.** Crew workflows, test generation, healing, and LLM enrichment during training will not run.
- **Free-tier commands are unaffected.** Commands like `impact`, `plan`, `train --no-enrich`, `traceability-capture`, `traceability-ingest`, `feedback`, and `cost-report` all work without API keys.

This makes it safe to gate CI pipelines on impact analysis even if the LLM provider is temporarily unreachable.

## CI Integration

### GitHub Actions

```yaml
name: E2E Impact Analysis
on:
  pull_request:
    branches: [master, main]

jobs:
  impact-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run impact analysis
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npx e2e-ai-agents plan \
            --path . \
            --since origin/${{ github.base_ref }} \
            --fail-on-must-add-tests \
            --github-output "$GITHUB_OUTPUT"

      - name: Run crew analysis (optional)
        if: success()
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npx e2e-ai-agents crew \
            --workflow quick-check \
            --path . \
            --tests-root ./e2e-tests \
            --since origin/${{ github.base_ref }} \
            --budget-usd 0.50 \
            --json
```

**Error handling:** If `ANTHROPIC_API_KEY` is not set, AI-powered steps will fail but deterministic commands (`impact`, `plan` without `--aiFlow`) will still succeed. Consider splitting your workflow into a required deterministic job and an optional AI-powered job.

Artifacts are written to `.e2e-ai-agents/` and can be uploaded for later inspection:

```yaml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-analysis
          path: .e2e-ai-agents/
```

## Monitoring

### Cost Visibility

Track LLM spending across runs:

```bash
npx e2e-ai-agents cost-report --path /path/to/project
```

This reads the append-only `metrics.jsonl` log and summarizes token usage, cost per agent, and cost per provider. Use `--json` for machine-readable output suitable for dashboards.

### Provider Health

Verify that configured LLM providers are reachable:

```bash
npx e2e-ai-agents llm-health
```

This sends a minimal probe to each provider whose environment variable is set (Anthropic, OpenAI, and/or Ollama) and reports availability. It does not measure latency.

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (invalid arguments, missing config, runtime failure) |
| 2 | Budget exceeded or policy enforcement triggered (`--fail-on-must-add-tests`) |

Monitor exit codes in CI to distinguish between analysis failures and policy violations. A non-zero exit from `plan --fail-on-must-add-tests` means uncovered P0/P1 gaps were detected and should block the PR.

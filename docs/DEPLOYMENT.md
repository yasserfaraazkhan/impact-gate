# Deployment Guide

This document covers installation, upgrades, rollback procedures, degraded-mode operation, CI integration, and monitoring for `@yasserkhanorg/impact-gate`.

## Installation

```bash
npm install -D @yasserkhanorg/impact-gate
```

Requires Node.js >= 20. The package ships both CommonJS and ESM builds and exposes three CLI binaries: `impact-gate`, `impact-gate-qa`, and `impact-gate-mcp`.

After installation, verify the CLI is available:

```bash
npx impact-gate --help
```

For first-time setup, run the init command to generate a config file:

```bash
npx impact-gate init
```

## Compatibility Matrix

| impact-gate | Node.js   | Playwright | Cypress  |
|------------|-----------|------------|----------|
| 1.10.x     | >= 20.0.0 | >= 1.40.0  | >= 13.0  |

**LLM providers:** Anthropic SDK ^0.73.0, OpenAI SDK ^4.73.0, or any local Ollama instance. The `agent-browser` peer dependency (>= 0.18.0) is optional and only required for the autonomous QA agent (`impact-gate-qa`).

## Upgrading

1. Install the latest version:

```bash
npm install -D @yasserkhanorg/impact-gate@latest
```

2. Run your project's test suite to verify compatibility:

```bash
npm test
```

3. Check the CHANGELOG.md for breaking changes between your previous version and the new one. Pay special attention to changes in `CrewContext` fields if you use the programmatic API or custom plugins (see [PLUGIN_API_STABILITY.md](./PLUGIN_API_STABILITY.md)).

4. If you use the crew workflow, run a quick dry-run to confirm orchestration still works:

```bash
npx impact-gate crew --workflow quick-check --dry-run --path /path/to/project --tests-root ./e2e-tests --since origin/master
```

## Rollback

If an upgrade introduces issues, revert to the previous working version:

```bash
npm install -D @yasserkhanorg/impact-gate@<previous-version>
```

Optionally clear cached analysis artifacts to avoid stale data from the newer version:

```bash
rm -rf .e2e-ai-agents/cache/
```

Route families (`route-families.json`), traceability data, calibration metrics, and feedback files are version-independent and safe to keep across upgrades and rollbacks.

## Degraded Mode

When LLM providers are unavailable — during outages, in air-gapped environments, or when no API keys are configured — you can run in degraded mode:

```bash
npx impact-gate impact --path /path/to/project
npx impact-gate plan --path /path/to/project
```

In degraded mode:

- **Deterministic analysis continues working.** The `review`, `impact`, and `plan` commands use the route-families manifest, dependency graph, and traceability data to produce results without any LLM calls.
- **AI-powered features are skipped.** `review --generate`, `review --deep`, crew workflows, test generation, healing, and LLM enrichment during training will not run.
- **Free-tier commands are unaffected.** Commands like `review`, `impact`, `plan`, `predict`, `train --no-enrich`, `traceability-capture`, `traceability-ingest`, `feedback`, and `cost-report` all work without API keys.

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

      - name: PR Impact Review
        run: |
          npx impact-gate review \
            --path . \
            --since origin/${{ github.base_ref }} \
            --ci-comment-path comment.md

      - name: Coverage Gate
        run: |
          npx impact-gate gate --path . --threshold 80

      - name: Run crew analysis (optional)
        if: success()
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npx impact-gate crew \
            --workflow quick-check \
            --path . \
            --tests-root ./e2e-tests \
            --since origin/${{ github.base_ref }} \
            --budget-usd 0.50 \
            --json
```

**Error handling:** Deterministic commands (`impact`, `plan`, `gate`) work without API keys. Consider splitting your workflow into a required deterministic job and an optional AI-powered job for crew or generation features.

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
npx impact-gate cost-report --path /path/to/project
```

This reads the append-only `metrics.jsonl` log and summarizes token usage, cost per agent, and cost per provider. Use `--json` for machine-readable output suitable for dashboards.

### Provider Health

Verify that configured LLM providers are reachable:

```bash
npx impact-gate llm-health
```

This sends a minimal probe to the configured provider, or the auto-detected provider if you rely on environment discovery, and reports availability. It does not measure latency.

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (invalid arguments, missing config, runtime failure) |
| 2 | Budget exceeded or policy enforcement triggered (`--fail-on-must-add-tests`) |

Monitor exit codes in CI to distinguish between analysis failures and policy violations. A non-zero exit from `plan --fail-on-must-add-tests` means uncovered P0/P1 gaps were detected and should block the PR.

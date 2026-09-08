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

## Runtime and Frameworks

The current 2.x source requires Node.js >= 20.0.0 and ships CommonJS and ESM builds. Framework adapters support Playwright, Cypress, pytest and supertest discovery. Validate compatibility with your project's pinned framework version and runner configuration before enabling execution or generation.

**LLM providers:** Anthropic SDK ^0.73.0, OpenAI SDK ^4.73.0, or any local Ollama instance. The `agent-browser` peer dependency (>= 0.18.0) is optional and only required for the autonomous QA agent (`impact-gate-qa`).

The [Mattermost advisory pilot](../docs-site/src/content/docs/guides/mattermost-advisory.md) runs from a reviewed source commit with an isolated source checkout and explicit suite configuration. The example config is not shipped in the npm package. Merging source changes does not publish a new npm version.

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
npx impact-gate plan --no-ai --path /path/to/project
```

In degraded mode:

- **Deterministic analysis continues working.** Use `review` without AI flags, `impact`, or `plan --no-ai` for local analysis without model calls.
- **Choose commands explicitly.** `review --generate`, `review --deep`, crew workflows, generation, healing and training enrichment still require a provider. A missing key does not universally skip these features; use `train --no-enrich` for static training.
- **Advisory planning is isolated.** `plan --advisory` uses a configured suite and emits JSON without providers or artifact/status writers. Ordinary `plan --no-ai` still writes its normal artifacts.

The ordinary gate measures fully mapped feature spec presence, not executed behavior coverage. Partial mappings and unassessed files cannot count as full coverage. Keep execution and release decisions grounded in test results.

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
          npx impact-gate gate --path . --since origin/${{ github.base_ref }} --threshold 80

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

**Error handling:** Deterministic commands (`impact`, `plan --no-ai`, `gate`) work without API keys. Consider splitting your workflow into a required deterministic job and an optional AI-powered job for crew or generation features. Invalid Git refs are errors; they are not empty diffs or passing gates.

Ordinary planning artifacts are written under `<testsRoot>/.e2e-ai-agents/` and can be uploaded for later inspection. Adjust the path below to your tests root. Advisory commands instead emit JSON on stdout:

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
| 3 | Provider unavailable or authentication failure |
| 4 | Invalid manifest or configuration |

Inspect the report and error message as well as the exit code. A nonzero exit can mean invalid inputs or an analysis failure, not just a policy violation. A completed advisory report keeps `enforcement.shouldFail` false; this is not release approval.

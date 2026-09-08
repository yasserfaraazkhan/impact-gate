# Mattermost advisory pilot

Run the existing `plan` command against a clean, isolated Mattermost checkout:

```sh
env -i PATH="$PATH" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  node dist/cli.js plan --advisory --json \
  --config examples/mattermost/advisory.config.json \
  --path /path/to/isolated/mattermost \
  --since FULL_BASE_SHA --suite cypress-full-enterprise > plan.json
```

Repeat with `playwright-full-enterprise`, or the separately identified `*-full-fips` suites. `--since` must resolve to a commit; the report records both that commit and its merge base with the checked-out HEAD. Invalid Git refs, invalid configuration, missing committed files, dirty checkouts, and escaping paths return nonzero. A successful report does not assert coverage or release safety. Keep the existing full-suite dispatch unchanged during the pilot.

`--advisory` uses `getChangedFiles`, `analyzeImpact`, and `buildPlanFromImpact` without model calls, browser/MCP services, adaptive history, test execution, generation, healing, metrics, or GitHub status/output writes. JSON goes to stdout; diagnostics go to stderr. It also works through `suggest` and `gate`. Do not combine it with execution/generation/crew/output-writing flags. Shell redirection is the caller's only report write.

The configuration was inspected against Mattermost PR #38356, HEAD `5ed5f7d29ae67d6ecf7864022e37c66792280a45`, base `502cf7e3e5379ce054bee24e279ec1779911aa38`:

- `e2e-tests/cypress/cypress.config.ts`: `tests/integration/**/*_spec.{js,ts}`, support and plugin configuration.
- `e2e-tests/playwright/playwright.config.ts`: `specs`, standard Playwright spec/test extensions; project `chrome` uses `chromium` and depends on `setup`. The existing runner retains that setup dependency.
- `.github/workflows/e2e-tests-ci.yml` and the two `e2e-tests-*-template.yml` files: distinct enterprise/FIPS identities, Playwright `chrome`, visual exclusion, Cypress tag filters and full-suite dispatch. Cypress supplies no explicit browser option, and this run's TSIO evidence does not record its browser. The report labels that field accordingly.

The adapter inventories **committed static spec files**, not discovered test cases or executed coverage. In this revision Cypress has 658 matching files; its Stage/Group/Skip filters dispatch 447. Playwright has 291 nonvisual spec files. Full fallback selects the complete static inventory; Mattermost's existing runner still applies its configuration, setup, tag selection, retries and enterprise/FIPS environment. The planner never evaluates JavaScript configuration or test code. Re-review this small configuration when the upstream layout or dispatch configuration changes; the report fingerprints both it and the suite config file.

There are deliberately no product-to-spec mappings in this initial configuration: no human-reviewed coverage manifest was supplied. Product changes stay unknown and request the full suite. To add a reviewed **recommendation** mapping, add an entry to `advisory.mappings` with `sourcePattern`, suite ID, exact repository-relative `specs`, and `provenance: {kind: "human-reviewed-manifest", evidence: "review URL or document reference"}`. Presence is validated, but the planner cannot authenticate the human review; the manifest is a trusted, separately reviewed input. Static dependency inference and co-change mappings must use their distinct provenance kinds; they remain heuristic and trigger full fallback. Measured per-test coverage is unavailable to this caller. No finding of a spec file creates a measured coverage edge.

The existing non-advisory `gate` now fails unassessed changes, counts only fully mapped features toward its threshold, and labels its basis as spec presence. It cannot turn an invalid diff or unknown mapping into a coverage pass. Existing optional generative commands remain outside this pilot; no product-bug-to-fixme repair feature is exposed here.

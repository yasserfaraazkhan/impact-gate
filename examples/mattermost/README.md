# Mattermost advisory pilot

Run the existing `plan` command against a clean, isolated Mattermost checkout:

```sh
env -i PATH="$PATH" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  node dist/cli.js plan --advisory --json \
  --config examples/mattermost/advisory.config.json \
  --path /path/to/isolated/mattermost \
  --since FULL_BASE_SHA --suite cypress-full-enterprise > plan.json
```

Repeat with `playwright-full-enterprise`, or the separately identified `*-full-fips` suites. `--since` must resolve to a commit; the report records both that commit and its merge base with the checked-out HEAD. The advisory entry point independently checks the complete changed-file set and resolved identities. Run IDs include the requested base and merge base, so distinct comparisons cannot reuse a report ID just because they change the same paths. Invalid Git refs, invalid configuration, missing committed files, dirty checkouts, and escaping paths return nonzero. Bytes hidden by `skip-worktree` or `assume-unchanged` are checked against HEAD, including product files. Submodule pointer changes remain in the diff even when local Git configuration ignores submodules. A successful report does not assert coverage or release safety. Keep the existing full-suite dispatch unchanged during the pilot.

`--advisory` uses `getChangedFiles`, `analyzeImpact`, and `buildPlanFromImpact` without model calls, browser/MCP services, adaptive history, test execution, generation, healing, metrics, or GitHub status/output writes. JSON goes to stdout; diagnostics go to stderr. It also works through `suggest` and `gate`. Do not combine it with execution/generation/crew/output-writing flags. Shell redirection is the caller's only report write.

The configuration was inspected against Mattermost PR #38356, HEAD `5ed5f7d29ae67d6ecf7864022e37c66792280a45`, base `502cf7e3e5379ce054bee24e279ec1779911aa38`:

- `e2e-tests/cypress/cypress.config.ts`: `tests/integration/**/*_spec.{js,ts}`, support and plugin configuration.
- `e2e-tests/playwright/playwright.config.ts`: `specs`, standard Playwright spec/test extensions; project `chrome` uses `chromium` and depends on `setup`. The existing runner retains that setup dependency.
- `.github/workflows/e2e-tests-ci.yml` and the two `e2e-tests-*-template.yml` files: distinct enterprise/FIPS identities, Playwright `chrome`, visual exclusion, Cypress tag filters and full-suite dispatch. Cypress supplies no explicit browser option, and this run's TSIO evidence does not record its browser. The report labels that field accordingly.

The planner inventories **committed static spec files**, not discovered test cases or executed coverage. `specPattern` and `exclude` are relative to the suite root; source and cross-cutting patterns are relative to the repository. Matching includes dot files/directories. Negated or comment patterns beginning with `!` or `#` are rejected; use the explicit `exclude` array. The configured spec pattern also supports custom test names without silently intersecting them with a framework's default naming convention. In the originally inspected revision Cypress had 658 matching files; its Stage/Group/Skip filters dispatched 447. Playwright had 291 nonvisual spec files. Full fallback selects the complete static inventory; Mattermost's existing runner still applies its configuration, setup, tag selection, retries and enterprise/FIPS environment. The planner never evaluates JavaScript configuration or test code. Re-review this small configuration when the upstream layout or dispatch configuration changes; the report fingerprints both it and the suite config file.

There are deliberately no product-to-spec mappings in this initial configuration: no human-reviewed coverage manifest was supplied. Product changes stay unknown and request the full suite. Candidate entries in `advisory.mappings` carry `sourcePattern`, suite ID, exact repository-relative `specs`, and `provenance: {kind, evidence}`. Declaring `kind: "human-reviewed-manifest"` does not authenticate a review: those entries remain unverified candidates and trigger full fallback, just as static dependency inference and co-change heuristics do. The report preserves the declared provenance without promoting it to a verified mapping. There is no authenticated mapping mechanism in this pilot and no targeted recommendation for a nonempty diff. Measured per-test coverage is unavailable to this caller. No finding of a spec file creates a measured coverage edge.

Repository origin matching and configuration hashes bind the report to local inputs; they do not authenticate GitHub ownership, the configuration's reviewer, or the configured project/browser/variant against actual execution. The caller must obtain the checkout and manifest from trusted pinned revisions and compare actual run evidence separately. Suite configuration is read and fingerprinted as data, so runtime project eligibility and dispatch filters remain unverified by this planner.

The existing non-advisory `gate` now fails unassessed changes, counts only fully mapped features toward its threshold, and labels its basis as spec presence. It cannot turn an invalid diff or unknown mapping into a coverage pass. Existing optional generative commands remain outside this pilot; no product-bug-to-fixme repair feature is exposed here.

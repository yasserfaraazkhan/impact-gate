# Launch readiness: reviewable plans and reliable Playwright generation

## Audience and scope

This launch candidate serves developers adding tests, reviewers assessing PRs and
releases, and QA engineers exploring applications. The supported product remains
diff review and a spec-association gate. Generation, browser QA, and crew workflows
remain experimental; their reports must say what was actually verified.

Work started from upstream `ca855b1` on `codex/launch-readiness`. Pre-existing local
release QA files were preserved. The root agent coordinated three bounded agents:
generation reliability, browser handoff, and launch audit/documentation. Shared
builds were serialized; implementation was followed by cross-review.

## Evaluation and shortlist

Playwright already provides planner, generator, and healer agents ([official
documentation](https://playwright.dev/docs/test-agents)). Another orchestration
layer would duplicate that capability. Impact Gate's useful contribution is
change context, transparent mapping provenance, and inspectable generation input.

| Selected capability | Developer value | Acceptance evidence |
| --- | --- | --- |
| Export a scenario plan from a review | Inspect, edit, version, and reuse planned scenarios before provider spending; reviewers can discuss the same artifact | Deterministic export, no credentials, unchanged target repo, empty/invalid diff handling, preservation of unmatched recommendations |
| Respect the actual Playwright project | Generic projects use their fixtures and project configuration; Mattermost retains its explicit profile | Real Playwright execution without a named project, failure/repair/verification regression, profile assertions, preservation of existing specs |
| Turn browser findings into review proposals | QA findings retain reproduction steps and expected behavior in generator-compatible input | Typed handoff tests, correct source/config paths, provider-failure artifacts, unverified results excluded from accepted specs |

Supporting launch fixes cover ESM/MCP imports, runtime package version, npm package
entry points, actionable input errors, and documentation that matches the code.

## Simplification decisions

- Removed the browser handoff's `npx` subprocess and fragile console-output parser;
  it calls the existing generator and consumes structured results. Automatic QA
  generation selects at most five findings by severity; all remaining scenarios
  are saved, with deferred IDs and counts in the result.
- Reused the existing generation parser for repairs, preserving the selected
  profile instead of injecting a second framework's imports.
- Removed unused scenario grouping and duplicate MCP version-reading logic.
- Removed unsupported site claims, stale commands, and unexplained cost/time
  estimates. Kept existing public commands and exports for compatibility.
- Added no runtime dependency, agent framework, new verifier, or selection policy.

Deferred: autonomous certification of browser-served applications, a new global
agent scheduler, general mutation-testing infrastructure, and claims of measured
coverage or safe selective execution. These need evidence beyond this change.

## Workflow

```sh
# Build this source checkout; the published package does not include this work yet.
npm ci
npm run build

# Plan without a provider, then inspect/edit scenarios.json.
node dist/cli.js review --path /path/to/repo --since origin/main \
  --scenarios-output scenarios.json --json > review.json

# Optional generation; --dry-run still uses a provider and writes quarantined proposals.
node dist/cli.js generate --path /path/to/repo --since origin/main \
  --scenarios scenarios.json --dry-run
```

Scenario files contain proposals, not measured coverage or authorization to omit
tests. Reviewers can continue using `review --ci-comment-path` and `gate --json`.
Browser QA remains a separate experimental entry point documented in the browser
QA guide.

## Validation record

- `npm test`: **666 passed, zero failed/skipped** in the working checkout,
  including the pre-existing local release QA tests. This builds CommonJS, ESM,
  scripts, and tests before execution.
- `npm run lint`: passed. `git diff --check`: passed.
- Real Playwright regressions cover the default unnamed project, compilation
  failure reporting, generation/repair, mutation verification, existing-spec
  preservation, and concurrent-file creation without aborting the next scenario.
- QA handoff regressions cover configuration, external test roots, provider
  failure, verification states, and the five-finding cap with complete deferred
  scenario retention.
- Packed npm consumer smoke: CJS and ESM exports, MCP initialization/version,
  executable CLI files, and installed symlink invocation passed from a separate
  directory. Dependencies were supplied locally; no registry install was needed.
- Documentation: 27-page production build passed; edited-page internal links
  resolved. Unsupported marketing claims and stale help references were removed.
- `npm audit --audit-level=high`: **zero known vulnerabilities** in the locked
  package dependencies at verification time.
- Ran the built review command against this checkout and upstream `ca855b1`:
  strict JSON parsed successfully and exported 117 valid scenario groups. This
  includes pre-existing untracked work and broad heuristic candidates; it is an
  integration check, not evidence of scenario quality or coverage.
- Independent cross-review found and resolved concurrent-write batch abortion,
  config auto-detection overriding configured test roots, inconsistent malformed
  input errors, and unlimited browser-finding generation batches.

No Anthropic/OpenAI key or Ollama endpoint was configured. Provider responses in
automated acceptance tests are deterministic fixtures, not live-model evidence.

## Release boundary

The verifier accepts only supported tests that directly import changed local
source and pass baseline, mutation-kill, and restored-source runs. Browser-served,
remote, or prebuilt applications remain unverified and their proposals stay
quarantined. Existing specs are preserved. Passing a mapping gate establishes
spec association, not behavior coverage or release safety.

A live-provider application acceptance run and publication are separate from the
local regression and package checks. No live-model quality or production browser
coverage is inferred from deterministic provider fixtures.

The supported review/gate workflow has passed the local launch gates. Autonomous
browser QA and generation remain experimental; this work does not certify them
for general availability or publish a package.

h1. E2E Impact Analysis: Automated Coverage Gate

{info:title=Executive Summary}
This workflow runs on every pull request in the Mattermost repository. It maps changed files to E2E-critical feature flows, checks whether Playwright or Cypress coverage already exists, and posts a structured PR comment with the analysis and suggested next actions.

Version *v1.8.0* adds the optional *Multi-Agent Crew*, which goes beyond the binary CI gate by detecting cross-family impact, prioritizing test strategy, and designing structured test cases across 9 categories.
{info}

|| Field || Value ||
| Status | Active on {{feature-impact-analysis-e2e}} |
| Version | v1.8.0 |
| Last updated | March 17, 2026 |
| Primary outcome | Block PRs only when uncovered P0 or P1 gaps are detected |

h2. Links

|| Resource || Link ||
| Feature PR | [feat(e2e): E2E coverage CI gate with label/comment override #35542|https://github.com/mattermost/mattermost/pull/35542] |
| Engine repo | [yasserfaraazkhan/e2e-agents|https://github.com/yasserfaraazkhan/e2e-agents] |
| npm package | [@yasserkhanorg/e2e-agents|https://www.npmjs.com/package/@yasserkhanorg/e2e-agents] |
| CI workflow | {{.github/workflows/e2e-coverage-gate.yml}} |
| Manifest | {{e2e-tests/playwright/.e2e-ai-agents/route-families.json}} |

h2. What Problem This Solves

* Developers change application code without a fast way to know whether impacted user flows already have E2E coverage.
* Reviewers can miss hidden regressions when a change affects shared components, APIs, or state used by multiple features.
* Teams need a CI signal that is cheap enough to run on every PR, but still specific enough to say whether tests are missing.

h2. How the Gate Works

h3. End-to-End Flow

# A developer pushes code.
# A pre-commit advisory warns when webapp files change without E2E tests in the same commit.
# The CI workflow {{e2e-coverage-gate}} runs on the pull request.
# {{git diff}} identifies changed files.
# Filtering removes noise such as test files, snapshots, comment-only diffs, and config-only changes.
# {{route-families.json}} maps changed files to feature families and user flows.
# The engine checks whether Playwright or Cypress coverage already exists for each impacted flow.
# Cross-family deduplication suppresses false positives where one real covered feature also matches a generic family.
# AI enrichment adds behavioral context and candidate scenarios when an LLM key is available.
# The workflow computes a final coverage decision and posts a PR comment.

h3. Decision Outcomes

|| Status || Meaning ||
| *Safe to merge* | No application changes were detected, or all affected flows are already covered |
| *Run now* | Existing coverage exists, but advisory signals were detected, or the PR already includes relevant tests |
| *Must add tests* | Uncovered P0 or P1 gaps were detected and the PR should not merge without additional E2E coverage |

h2. Manifest Architecture

The {{route-families.json}} manifest is the system's knowledge map. It connects source files to feature families, test directories, routes, priorities, and user flows so the engine can reason about E2E impact deterministically before any LLM enrichment is applied.

h3. Example Manifest Entry

{code:language=json}
{
  "id": "channels",
  "routes": ["/{team}/channels/{channel}"],
  "webappPaths": ["webapp/channels/src/components/channel_*"],
  "serverPaths": ["server/channels/api4/channel*.go"],
  "specDirs": ["specs/functional/channels/"],
  "cypressSpecDirs": ["../cypress/tests/integration/channels/messaging/"],
  "priority": "P0",
  "features": [
    {
      "id": "channels/search",
      "webappPaths": ["webapp/channels/src/components/search*"],
      "specDirs": ["specs/functional/channels/search/"]
    }
  ]
}
{code}

h3. Example Resolution

If {{webapp/channels/src/components/channel_header.tsx}} changes, the engine:

# Maps the file to the {{channels}} family.
# Looks up the associated Playwright and Cypress directories.
# Determines whether existing specs cover the impacted flow.
# Reports the coverage status in the PR comment.

h2. Smart Filtering

The engine applies multiple filters to reduce false positives before it decides that tests are missing.

|| Filter || What it detects || Example ||
| Test file filtering | Ignores test artifacts that should not trigger impact analysis | {{.spec.ts}}, {{.test.tsx}}, {{_test.go}}, {{.snap}}, {{__snapshots__/}} |
| Comment-only diff | Excludes files where only comments changed | {{// toa}} changed to {{// to a}} |
| Cross-family deduplication | Suppresses generic family matches when a more specific covered feature exists | {{policies.tsx}} matching both {{config}} and {{system_console/permissions}} |
| PR-included test detection | Detects that the pull request already adds E2E coverage | {{attachment_footer_markdown_spec.ts}} added in the same PR |
| Advisory escalation | Flags behavior changes inside already-covered flows for manual attention | Permission logic change in a covered area |

h2. Developer Workflow

h3. Pre-Commit Advisory

When a developer commits webapp changes without E2E tests in the same commit, the local advisory prints:

{code}
WARNING: Webapp files changed in this commit:
  - webapp/channels/src/components/channel_header.tsx

WARNING: No E2E tests detected in this commit.
Do you want to proceed without E2E tests? (y/n):
{code}

h3. Local Commands

These commands are optional. The CI gate still runs on every PR even if a developer never uses the local workflow.

{code:language=bash}
cd e2e-tests/playwright

npm run impact:analyze    # Show impacted flows
npm run impact:ci         # CI-equivalent check; fails on coverage gaps
npm run impact:suggest    # Generate AI-assisted test scenarios
npm run impact:generate   # Generate missing specs (requires ANTHROPIC_API_KEY)
{code}

h3. CI Overrides

|| Method || Usage ||
| Label | {{skip-e2e-coverage-check}} |
| PR comment | {{/skip-e2e-check: reason}} |

h2. AI Enrichment

When an LLM API key is available, deterministic impact analysis is enriched with:

* *Behavioral analysis*: explains why a code change affects a feature flow.
* *Missing test scenarios*: generates diff-specific scenario suggestions.
* *Coverage mapping*: points to existing E2E scenarios that already validate the behavior.
* *Advisory scenarios*: suggests additional test ideas when new behavior appears inside a flow that already has coverage.

h2. Multi-Agent Crew (v1.8.0)

{panel:title=What the Crew Adds}
The CI gate answers, "Is there a meaningful coverage gap?" The Crew answers, "What exactly should we test, how deep should we test it, and which related areas are also at risk?"
{panel}

h3. What It Is

The Crew is an optional deep-analysis mode built on 10 specialized agents. It is designed for cases where a binary pass/fail gate is not enough and a developer or QA lead needs a concrete, prioritized test design.

h3. Why It Exists

The standard gate is fast and cheap, but it leaves important questions unanswered:

* Which exact test cases should be written?
* Should the team cover only the happy path or also permissions, race conditions, and edge cases?
* Does the change ripple into other flows through shared components, APIs, or state?
* Which flows should be tested first when time is limited?

h3. Crew Workflow

{code}
PR diff
  -> preprocess
  -> impact-analyst + cross-impact + regression-advisor  (parallel)
  -> strategist -> test-designer                         (sequential)
  -> generator                                           (parallel)
  -> executor -> healer                                  (sequential)
{code}

h3. Output by Phase

|| Phase || Agents || Output ||
| Preprocess | Built-in deterministic analysis | File-to-family binding, API surface catalog, spec index |
| Understand | Impact Analyst, Cross-Impact Analyst, Regression Advisor | Impacted flows, cross-family dependencies, historical risk signals |
| Strategize | Strategist, Test Designer | Prioritized approach per flow and structured test cases across 9 categories |
| Execute | Generator | Generated Playwright specs from structured test designs |
| Validate | Executor, Healer | Execution results and auto-fixed failing specs |

h3. Agent Roles

|| Agent || Purpose || Uses LLM? ||
| Impact Analyst | Identifies which user flows are affected by the change | Yes |
| Cross-Impact Analyst | Finds ripple effects across route families via shared code and APIs | Yes plus deterministic signals |
| Regression Advisor | Scores historical risk from flaky data and calibration metrics | No |
| Strategist | Chooses the test approach per flow | Yes |
| Test Designer | Produces structured test cases with steps and expected outcomes | Yes |
| Coverage Evaluator | Assesses existing coverage against impacted flows | Yes |
| Generator | Generates Playwright specs from the structured designs | Yes |
| Executor | Runs generated specs with Playwright | No |
| Healer | Attempts to auto-fix failing specs | Yes |
| Explorer | Performs browser-based autonomous exploration against a running app | Yes plus browser automation |

h3. Workflow Modes

|| Workflow || Phases || Use case || Typical cost ||
| {{quick-check}} | Preprocess, understand, strategize | Fast strategy recommendation | About $0.10 |
| {{design-only}} | Preprocess, understand, strategize, test design | Full test plan without spec generation | About $0.50 to $2.00 |
| {{full-qa}} | All phases | Design, generate, execute, and heal | About $2.00 to $5.00 |

h3. Capabilities the Crew Adds Beyond the CI Gate

h4. Cross-Family Impact Detection

The CI pipeline evaluates each route family independently. The Crew identifies shared dependencies across families, which matters when a single code change can break behavior in areas that do not look related from file paths alone.

Real example from PR {{#35613}}:

* Pipeline view: 1 file changed, 1 detected flow, 1 gap.
* Crew view: 50 cross-family impacts, including:
** {{permissions -> policies}}
** {{permissions -> system_users}}
** {{channels -> external_links}}
** {{user -> mentions}}
** {{global_header -> channels_settings_dialog}}

h4. Structured Test Case Design Across 9 Categories

The CI pipeline emits flat scenario strings. The Crew emits structured {{TestCase}} objects with category, priority, rationale, preconditions, steps, and expected outcomes.

|| Category || What it covers || Example ||
| {{happy-path}} | Core user journey works correctly | System admin views the default permissions system scheme after migration |
| {{edge-case}} | Unusual inputs or uncommon states | Unicode role names render correctly after migration |
| {{boundary}} | Empty states and limit cases | Create admin role with maximum-length name |
| {{negative}} | Invalid operations and error paths | Attempt to create an admin role with a duplicate name |
| {{state-transition}} | State changes and concurrent modification flows | Modify an existing custom admin role |
| {{race-condition}} | Competing actions at the same time | Two admins modify the same role concurrently |
| {{permission}} | Role-based access control | Guest permissions remain correctly restricted |
| {{accessibility}} | Keyboard navigation and assistive behavior | Keyboard navigation through scheme sections |
| {{performance}} | Loading states and large-data behavior | Permissions page shows loading state during initial fetch |

Each structured test case includes:

* *Name*
* *Type*
* *Preconditions*
* *Steps*
* *Expected outcome*
* *Priority*
* *Rationale*

Example output from PR {{#35613}} for the flow "View and manage permissions system scheme after migration":

{code}
[happy-path] system admin views default permissions system scheme after fresh migration (P0)
[happy-path] verify migrated team admin permissions are correctly displayed (P1)
[edge-case] permissions scheme displays correctly with unicode role names after migration (P2)
[permission] verify guest permissions are correctly migrated and restricted (P0)
[permission] verify system manager role permissions after migration (P1)
[accessibility] keyboard navigation through permissions scheme sections (P1)
[race-condition] permissions page handles concurrent admin modifications (P2)
[performance] permissions scheme page shows loading state during initial data fetch (P2)
... (15 total)
{code}

h4. Strategy and Prioritization

Instead of treating every gap the same, the Strategist assigns:

* *Approach*: {{full-test}}, {{smoke-test}}, {{skip}}, or {{manual-review}}
* *Categories*: which of the 9 categories deserve coverage for that flow
* *Cross-impact risk*: whether shared dependencies increase the blast radius
* *Rationale*: why the strategy was chosen

h4. Regression Risk Scoring

The Regression Advisor raises risk based on:

* Flaky-test history for the affected family
* Calibration precision from previous recommendations
* File-pattern heuristics, such as auth logic, API handlers, and shared models

h3. Pipeline vs. Crew (Real Example)

Real run based on PR {{#35613}}:

|| Dimension || CI pipeline || Crew ({{design-only}}) ||
| Changed files analyzed | 1 filtered file | 27 files from the full diff |
| Flows detected | 1 | 46 |
| Coverage assessment | 1 binary gap | 41 strategies with approach and categories |
| Test scenarios | 0 | 615 structured test cases |
| Cross-family impacts | 0 | 50 |
| Categories used | None | 9 |
| Cost | About $0.02 | $2.19 |
| Time | About 2 seconds | About 37 minutes |

h3. When to Use Which Tool

|| Situation || Recommended tool || Why ||
| Every PR push | Pipeline ({{impact}} plus {{plan}}) | Fast, cheap, and suitable for CI gating |
| Developer asks "what should I test?" | Crew {{quick-check}} | Produces strategy recommendations quickly |
| QA lead preparing a release plan | Crew {{design-only}} | Produces a broad structured test plan |
| Team wants generated Playwright specs | Crew {{full-qa}} | Runs design, generation, execution, and healing |
| Investigating a regression | Crew {{design-only}} | Adds cross-impact analysis and risk scoring |

h3. Crew Usage

{code:language=bash}
cd e2e-tests/playwright

# Quick strategy only
npx e2e-ai-agents crew --workflow quick-check \
  --path ../../webapp/channels --tests-root . --since origin/master

# Full test design without generation
npx e2e-ai-agents crew --workflow design-only \
  --path ../../webapp/channels --tests-root . --since origin/master

# End-to-end design + generation + execution + healing
npx e2e-ai-agents crew --workflow full-qa \
  --path ../../webapp/channels --tests-root . --since origin/master

# Budget-capped JSON output
npx e2e-ai-agents crew --workflow design-only \
  --budget-usd 2.00 --json \
  --path ../../webapp/channels --tests-root . --since origin/master
{code}

h3. Tradeoffs

{warning:title=Important Tradeoffs}
The Crew is intentionally more expensive and slower than the CI gate. It is a deep-analysis tool, not a replacement for the fast coverage gate.
{warning}

* *Cost*: {{design-only}} typically costs $0.50 to $2.00 depending on flow count. Large PRs can exceed $2.00.
* *Latency*: the CI gate finishes in 2 to 5 seconds. Crew workflows can take 5 to 40 minutes.
* *Quality vs. quantity*: large PRs can generate hundreds of structured test cases. Human prioritization is still required.
* *Rate limits*: large runs can hit provider rate limits because the test-designer step fans out by flow.
* *Cross-impact accuracy*: deterministic overlap detection is reliable; LLM-enriched semantic links can still produce false positives.

h2. Demo PRs

Ten showcase PRs replay real-world changes through the coverage gate.

|| Showcase PR || Based on || Scenario || Result ||
| [A1 - Safe to merge (docs/workflow)|https://github.com/mattermost/mattermost/pull/35611] | Update {{docs-impact-review.yml}} | Docs and workflow change | *Safe to merge* |
| [A4 - P0 server gap: post permission|https://github.com/mattermost/mattermost/pull/35609] | MM-67809 check {{create_post}} permission | Server-only permission change | *Run now* (covered, advisory) |
| [A6 - Large full-stack feature: channel popout|https://github.com/mattermost/mattermost/pull/35610] | MM-65627 add channel popout window | Large multi-layer change | *Run now* (gaps plus scenarios) |
| [A3/C1 - Covered flows with Playwright specs|https://github.com/mattermost/mattermost/pull/35612] | MM-67669 team settings modal tab | PR already includes Playwright spec | *Run now* |
| [D4 - Snapshot edge case|https://github.com/mattermost/mattermost/pull/35613] | MM-67123 mention button type fix | Snapshot-heavy fix | *1 real coverage gap* |
| [B7/D5 - Go unit tests only|https://github.com/mattermost/mattermost/pull/35614] | ScheduledPost model unit tests | Comment-only Go change | *Safe to merge* |
| [B8 - DB migration plus websocket|https://github.com/mattermost/mattermost/pull/35615] | MM-67741 scope {{role_updated}} websocket events | DB plus websocket change | *Coverage gaps detected* |
| [C2 - Store plus shared model|https://github.com/mattermost/mattermost/pull/35616] | Card-as-post feature | Model and store change | *Post flow coverage gap* |
| [C3 - Cypress test included|https://github.com/mattermost/mattermost/pull/35617] | Markdown in attachment footer | Source plus Cypress spec | *Run now* |
| [C4 - Source plus E2E tests|https://github.com/mattermost/mattermost/pull/35618] | DateTime refactor | Source plus Playwright tests | *Run now* |

h2. Scope Boundaries

* The gate does *not* run E2E tests. It evaluates coverage; existing Playwright and Cypress CI jobs still execute the tests.
* The gate does *not* auto-generate tests on every PR. Generation is opt-in through local commands or Crew workflows.
* The gate does *not* replace code review. It supplements review with impact and coverage data.
* The gate does *not* block on P2 flows. Only uncovered P0 and P1 gaps trigger enforcement.
* The Crew is *opt-in*. The default CI path remains the deterministic, low-cost pipeline.

h2. Extending the Manifest

h3. {{train}} Command

The {{train}} command scans the project, discovers feature families, merges them with the existing manifest, optionally enriches them with AI, and can validate the result against real git history.

h3. Usage

{code:language=bash}
cd e2e-tests/playwright

# Full scan with AI enrichment
npx e2e-ai-agents train --path ../../webapp

# Preview only
npx e2e-ai-agents train --path ../../webapp --dry-run

# Deterministic scan only
npx e2e-ai-agents train --path ../../webapp --no-enrich

# Validate against a specific PR
npx e2e-ai-agents train --path ../../webapp --validate --pr 35558

# Validate against recent git history
npx e2e-ai-agents train --path ../../webapp --validate --since HEAD~20
{code}

h3. What {{train}} Does

|| Step || Stage || Description ||
| 1 | Scan | Discovers source directories, test directories, and candidate feature families |
| 2 | Merge | Combines new discoveries with the existing {{route-families.json}} manifest while preserving current entries |
| 3 | Stale detection | Flags families whose paths no longer exist and suggests cleanup |
| 4 | AI enrichment | Infers routes, user flows, priorities, and likely source-path bindings |
| 5 | Validate | Tests the manifest against real commit or PR history to measure accuracy |
| 6 | Write | Outputs the updated manifest to {{.e2e-ai-agents/route-families.json}} |

h2. Version History

|| Version || Date || Changes ||
| v1.8.0 | March 17, 2026 | Multi-Agent Crew: 10 agent roles, 3 workflows, cross-impact detection, structured test design across 9 categories, regression risk scoring, prompt-injection sanitization, {{--json}} output |
| v1.7.7 | March 16, 2026 | Comment-only diff filtering, precise PR-test matching, advisory escalation improvements |
| v1.7.6 | March 16, 2026 | Impact engine bug fixes |
| v1.7.5 | March 15, 2026 | Initial CI gate with 10 demo PRs |

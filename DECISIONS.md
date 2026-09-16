# Recovery decisions

## 2026-09-16 — authorization and scope

The user asked: “Plan how to get this to working … take over deploy agents and make this work.” This authorizes execution after the earlier archaeology-only stop. The five work items remain the organizing scope, in order: W1 verification, W2 empirical measurement, W3 evidence precedence, W4 simplification, W5 current dogfood. Reproduced CLI/report defects are prerequisites of trustworthy W2 measurement, not a sixth product initiative. No runtime dependencies, version bump, new orchestrator, plugin system, or new top-level source directory are approved.

Ruling: use an isolated `codex/mattermost-recovery` worktree under `/private/tmp`; preserve the original master checkout, untracked GATES.md, and historical artifacts. Reuse the installed dependencies. The user's takeover instruction authorizes this reversible setup; no extra approval round is necessary. Decisions are owned by the root Arbiter; implementation, adversarial review, and gate evidence use separate agents.

## W1 — implementation approval; gate pending

Archaeology found that `review --generate` calls `src/agentic/runner.ts` directly (`src/cli/commands/review.ts:315`), stage 3 can mark compilation alone verified (`src/pipeline/stage3_generation.ts:292`), and the crew executor regenerates instead of executing its written artifact (`src/agents/executor.ts:30`). Fixing only the originally named files would leave the product path unverified. The actual runner accepts empty/no-report success (`src/agentic/playwright_runner.ts:192`).

Ruling: approve up to ten implementation/test files for W1: `src/agents/generator.ts`, `src/agents/executor.ts`, `src/pipeline/stage3_generation.ts`, new `src/pipeline/mutation_verification.ts`, `src/agentic/runner.ts`, `src/agentic/types.ts`, `src/agentic/playwright_runner.ts`, `src/cli/commands/review.ts`, `test/agentic_runner.test.ts`, and `test/playwright_runner.test.ts`. This is an explicit four-file budget overrun because the reachable command and its execution evidence otherwise bypass the requested guarantee. Required plan, decision, and gate records are not implementation files. Delete duplicate/invalid verification logic while adding the minimum shared helper; W4 must reduce the resulting product/documentation surface.

Ruling: require real local Playwright execution of a spec written through production generation using a clearly labeled deterministic provider fixture. This validates generation-to-verification plumbing and real clean/mutated execution without paid-provider access or nondeterministic model output. It does not validate live-model quality. The good spec must pass clean, fail with a changed-line mutant, and pass after restoration. An empty-body spec must remain unverified. Syntax/load/process/timeouts, empty/skipped reports, missing source/base, and unsupported mutations cannot count as kills. Only invert-condition, return-null, and comment-statement operators are approved. No original Mattermost checkout may be mutated during implementation/gates.

W1 remains open until an independent reviewer accepts the change and the Evidence Officer records actual stdout, exit codes, and generated artifacts in `gates/w1.txt`. No implementation self-certification closes an item.

## W2–W5 — pending detailed approvals

The fixed 30-PR sample and recorded CI evidence from `/private/tmp/impact-gate-pr-validation-2026-09-16` are immutable baseline inputs. Do not choose a different sample to improve results. Ordinary reporting repairs must not quietly change selection policy. Measured traceability must never be fabricated from passing statuses, file proximity, or Git co-change. Useful ranked recommendations and authorization to omit a full-suite test are separate claims. Missing measurements remain unknown. Each later item's exact file scope and acceptance evidence will be approved here before its implementation begins.

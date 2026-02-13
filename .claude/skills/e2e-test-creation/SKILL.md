# E2E Test Creation Skill

Use this skill to plan, generate, heal, and hand off Mattermost Playwright tests from impact/gap outputs.

## When to use

- A PR touches user flows and you need targeted E2E updates.
- `must-add-tests` appears in `plan.json` or CI comment.
- You want generated tests committed and optionally opened as a PR.

## Workflow

1. Run recommendation:
   - `npx e2e-ai-agents suggest --path ./webapp --tests-root ./e2e-tests/playwright`
2. Execute existing coverage first:
   - Use `plan.json -> nextActions.runRecommendedTests`.
3. Explicitly approve generation:
   - `npx e2e-ai-agents approve-and-generate --path ./webapp --tests-root ./e2e-tests/playwright --pipeline --pipeline-mcp`
4. Review and heal outputs:
   - Validate generated specs and selector patches.
5. Commit and optional PR handoff:
   - `npx e2e-ai-agents finalize-generated-tests --path ./webapp --tests-root ./e2e-tests/playwright --create-pr`

## Output expectations

- New/updated tests cover multi-step user flows, not single-page snapshots.
- Generated tests use standalone `test(...)` style (no `test.describe`).
- CI summary includes clear run/generate/heal/commit actions.

## References

- `guidelines.md`
- `mattermost-patterns.md`
- `examples.md`

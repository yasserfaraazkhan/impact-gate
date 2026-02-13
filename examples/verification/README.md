# End-to-End Verification (Node 22)

## 1) Standalone repo verification

Run in `e2e-agents` consumers with a real app + tests root:

```bash
npx e2e-ai-agents suggest --path <app-root> --tests-root <tests-root> --since <base-ref>
npx e2e-ai-agents approve-and-generate --path <app-root> --tests-root <tests-root> --pipeline --pipeline-mcp --since <base-ref>
npx e2e-ai-agents finalize-generated-tests --path <app-root> --tests-root <tests-root> --dry-run
```

Validate:

- `<tests-root>/.e2e-ai-agents/impact.json`
- `<tests-root>/.e2e-ai-agents/gap.json`
- `<tests-root>/.e2e-ai-agents/plan.json`
- `<tests-root>/.e2e-ai-agents/flaky-tests.json` (after feedback)

## 2) Mattermost repo verification

From `/Users/yasserkhan/Documents/mattermost/mattermost`:

```bash
npx e2e-ai-agents suggest \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --since origin/master \
  --flow-catalog ./e2e-tests/playwright/.e2e-ai-agents/flows.json

npx e2e-ai-agents approve-and-generate \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --since origin/master \
  --pipeline \
  --pipeline-mcp

npx e2e-ai-agents finalize-generated-tests \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --dry-run
```

If output looks correct, remove `--dry-run` and optionally add `--create-pr`.

# Examples

## Generate from approved gap

```bash
npx e2e-ai-agents approve-and-generate \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --pipeline \
  --pipeline-mcp \
  --since origin/master
```

## Finalize as commit

```bash
npx e2e-ai-agents finalize-generated-tests \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --branch codex/e2e-gap-fill \
  --commit-message "test(e2e): add generated coverage for PR impact"
```

## Finalize and open PR

```bash
npx e2e-ai-agents finalize-generated-tests \
  --path ./webapp \
  --tests-root ./e2e-tests/playwright \
  --create-pr \
  --pr-title "test(e2e): generated and healed coverage update" \
  --pr-base master
```

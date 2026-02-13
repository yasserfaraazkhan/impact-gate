# Mattermost Patterns

## Preferred scaffold

```ts
import {test, expect} from '@mattermost/playwright-lib';

test('P0: realtime messaging basic flow', {tag: '@ai-assisted'}, async ({pw}) => {
  const {user, team} = await pw.initSetup();
  const {channelsPage} = await pw.testBrowser.login(user);
  await channelsPage.goto(team.name);
  await expect(channelsPage.page).toHaveURL(/.*/);
});
```

## Patterns to enforce

- Start with `pw.initSetup()` and `pw.testBrowser.login(...)`.
- Navigate with page objects before interacting.
- Prefer channel/thread transitions for multi-surface validation.
- Keep selectors resilient (`data-testid` first).

## Anti-patterns

- `test.describe(...)` blocks for generated files.
- Randomized data without deterministic cleanup.
- Assertions that only check internal implementation details.

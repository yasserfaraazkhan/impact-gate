# Guidelines

## Core rules

- Do not use `test.describe` in generated Mattermost Playwright specs.
- Prefer robust selectors (`data-testid`, role/name) over brittle CSS.
- Cover end-to-end user outcomes across pages/channels/threads, not only local UI state.
- Keep one clear objective per test.

## Authoring bar

- Include setup/login with Mattermost Playwright fixtures.
- Validate primary happy path and at least one critical edge/failure path.
- Use deterministic waits/assertions; avoid arbitrary sleeps.
- Tag tests consistently (`{tag: '@ai-assisted'}` or team-approved tags).

## Healing bar

- If selector changed, prefer updating selector map/test-id over changing assertions.
- If flow changed, update objective steps and expected outcomes together.
- Quarantine only when flake is confirmed and owner is clear.

## Review checklist

- Test fails for the right reason when flow regresses.
- Assertions are user-visible and business-relevant.
- Test names map to flow IDs/priorities from catalog.

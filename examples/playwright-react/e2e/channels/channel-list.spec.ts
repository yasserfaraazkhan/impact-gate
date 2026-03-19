import { test, expect } from '@playwright/test';

test('user can see channel list', async ({ page }) => {
  await page.goto('/channels');
  await expect(page.locator('[data-testid="channel-list"]')).toBeVisible();
});

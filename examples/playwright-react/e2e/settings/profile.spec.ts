import { test, expect } from '@playwright/test';

test('user can update profile settings', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.locator('[data-testid="profile-form"]')).toBeVisible();
});

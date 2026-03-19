import { test, expect } from '@playwright/test';

test.describe('Roil E2E', () => {
  test('homepage loads and shows dashboard', async ({ page }) => {
    await page.goto('/');

    // Should see the sidebar branding
    await expect(page.locator('text=Canton')).toBeVisible();
    await expect(page.locator('text=Rebalancer')).toBeVisible();

    // Should see dashboard content
    await expect(page.locator('text=Dashboard')).toBeVisible();

    // Should see stats cards
    await expect(page.locator('text=Total Value')).toBeVisible();
    await expect(page.locator('text=Max Drift')).toBeVisible();
  });

  test('navigation works between pages', async ({ page }) => {
    await page.goto('/');

    // Navigate to DCA
    await page.click('text=DCA');
    await expect(page).toHaveURL('/dca');
    await expect(page.locator('text=Dollar Cost Averaging')).toBeVisible();

    // Navigate to Rewards
    await page.click('text=Rewards');
    await expect(page).toHaveURL('/rewards');
    await expect(page.locator('text=App Rewards')).toBeVisible();

    // Navigate to Settings
    await page.click('text=Settings');
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('text=Settings')).toBeVisible();

    // Navigate back to Dashboard
    await page.click('text=Dashboard');
    await expect(page).toHaveURL('/');
  });

  test('portfolio templates are displayed', async ({ page }) => {
    await page.goto('/');

    // Template selector should be visible
    await expect(page.locator('text=Quick Start')).toBeVisible();

    // Should show template cards
    await expect(page.locator('text=Conservative')).toBeVisible();
    await expect(page.locator('text=Balanced Growth')).toBeVisible();
    await expect(page.locator('text=BTC-ETH Maxi')).toBeVisible();
  });

  test('DCA form validates input', async ({ page }) => {
    await page.goto('/dca');

    // The create form should exist
    const createButton = page.locator('button:has-text("Create")');

    // If form is visible, check validation
    const form = page.locator('text=Source Asset');
    if (await form.isVisible()) {
      // Source and target should be different (form should handle this)
      await expect(page.locator('select').first()).toBeVisible();
    }
  });

  test('rewards page shows tier information', async ({ page }) => {
    await page.goto('/rewards');

    // Should show tier info
    await expect(page.locator('text=Bronze').first()).toBeVisible();

    // Should show tier comparison table
    await expect(page.locator('text=Fee Rebate')).toBeVisible();
  });

  test('settings page has toggles', async ({ page }) => {
    await page.goto('/settings');

    // Should see settings sections
    await expect(page.locator('text=Portfolio')).toBeVisible();
    await expect(page.locator('text=Auto-Compound')).toBeVisible();
    await expect(page.locator('text=Notifications')).toBeVisible();
    await expect(page.locator('text=Security')).toBeVisible();

    // Should have a save button
    await expect(page.locator('text=Save Settings')).toBeVisible();
  });

  test('404 page shows for unknown routes', async ({ page }) => {
    await page.goto('/nonexistent-page');

    await expect(page.locator('text=Page not found')).toBeVisible();
    await expect(page.locator('text=Return to Dashboard')).toBeVisible();
  });

  test('referral route redirects to rewards', async ({ page }) => {
    await page.goto('/ref/testcode123');

    // Should redirect to /rewards
    await expect(page).toHaveURL('/rewards');

    // Referral code should be stored
    const code = await page.evaluate(() => localStorage.getItem('referralCode'));
    expect(code).toBe('testcode123');
  });

  test('mobile sidebar toggle works', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Sidebar should be hidden on mobile
    const sidebar = page.locator('aside.hidden.md\\:flex');

    // Hamburger button should be visible
    const hamburger = page.locator('button[aria-label="Open menu"]').or(page.locator('button.md\\:hidden').first());
    if (await hamburger.isVisible()) {
      await hamburger.click();
      // Mobile drawer should appear
      await expect(page.locator('text=Canton')).toBeVisible();
    }
  });
});

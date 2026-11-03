import { expect, type Page } from '@playwright/test';

/**
 * Tap a resource in the drill-down diagram (ADR 0017). If it is not on screen, go back to the
 * overview and open each server layer until the resource appears.
 */
export const tapResource = async (page: Page, name: RegExp): Promise<void> => {
  const target = page.getByRole('button', { name }).first();
  if (await target.isVisible()) {
    await target.tap();
    return;
  }
  const crumbs = page.getByRole('navigation', { name: '構成図の階層' });
  await crumbs.getByRole('button', { name: '全体' }).tap();
  // Single-resource layers (load balancer, database) are tappable on the overview itself.
  if (await target.isVisible()) {
    await target.tap();
    return;
  }
  const layers = page.locator('.overview-box.group-compute, .overview-box.group-unplaced');
  const count = await layers.count();
  for (let i = 0; i < count; i++) {
    await layers.nth(i).tap();
    if (await target.isVisible()) {
      await target.tap();
      return;
    }
    await crumbs.getByRole('button', { name: '全体' }).tap();
  }
  await expect(target, `resource ${String(name)} not found in any layer`).toBeVisible();
};

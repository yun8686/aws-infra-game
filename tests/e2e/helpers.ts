import { expect, type Page } from '@playwright/test';

/** Start a mission from the project list by its card title. */
export const startMission = async (page: Page, title: string): Promise<void> => {
  await page.goto('/');
  await page.locator('.card', { hasText: title }).getByRole('button', { name: 'この案件を受注する' }).click();
};

/** Open a frame (VPC, AZ, subnet) by tapping its box in the diagram. */
export const openFrame = async (page: Page, label: string): Promise<void> => {
  // Tap the frame's header (its centre is usually covered by the frames inside it).
  await page
    .locator('.diagram-canvas')
    .getByRole('button', { name: label, exact: true })
    .tap({ position: { x: 60, y: 10 } });
  await expect(page.locator('.breadcrumb [aria-current]')).toHaveText(label);
};

/** Go back out to a frame through the breadcrumb. */
export const crumb = async (page: Page, label: string): Promise<void> => {
  await page.getByRole('navigation', { name: '表示中の枠' }).getByRole('button', { name: label }).tap();
};

/** Tap a resource icon in the diagram (the VPC view shows every resource of the mission templates). */
/** A diagram item by its name; bands add their service after the name (e.g. "shop-alb ALB"). */
const item = (page: Page, name: string) =>
  page
    .locator('.diagram-canvas')
    .getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`) })
    .first();

export const tapResource = async (page: Page, name: string): Promise<void> => {
  await expect(page.locator('.diagram-canvas')).toBeVisible();
  const target = item(page, name);
  if ((await target.count()) === 0) await crumb(page, 'shop-vpc');
  await tapItem(page, name);
  await expect(page.getByRole('dialog')).toBeVisible();
};

/** Choose an item in the "＋ 追加" sheet. */
export const add = async (page: Page, item: RegExp): Promise<void> => {
  await page.getByRole('button', { name: '＋ 追加' }).tap();
  await page.getByRole('dialog').getByRole('button', { name: item }).tap();
};

/**
 * Tap an icon in the diagram. Dispatches the click on the element itself, so the sticky toolbar
 * or a toast covering it after auto-scroll does not matter.
 */
export const tapItem = async (page: Page, name: string): Promise<void> => {
  const target = item(page, name);
  await expect(target).toBeVisible();
  await target.dispatchEvent('click');
};

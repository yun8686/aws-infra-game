import AxeBuilder from '@axe-core/playwright';
import { tapResource } from './helpers';
import { expect, test, type Page } from '@playwright/test';

/** Serious and critical axe violations, summarized for a readable failure message. */
const violations = async (page: Page) => {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
};

test('main screens have no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '担当案件' })).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await page.getByRole('button', { name: 'この案件を受注する' }).first().click();
  await expect(page.getByRole('heading', { level: 2, name: 'TV放映によるアクセス急増' })).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await page.getByRole('link', { name: /構成/ }).click();
  await tapResource(page, 'web-1');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await page.getByRole('link', { name: /結果/ }).click();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).click();
  await expect(page.locator('.result-headline')).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await page.getByRole('link', { name: /監視/ }).click();
  await expect(page.getByRole('heading', { name: 'エラー率' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('guides can be dismissed and hints appear after a failed attempt', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'この案件を受注する' }).first().click();
  const guide = page.getByRole('complementary', { name: '進め方' });
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: 'わかった' }).click();
  await expect(guide).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('保存済み');
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'TV放映によるアクセス急増' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '進め方' })).toHaveCount(0);

  await page.getByRole('link', { name: /結果/ }).click();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).click();
  await expect(page.getByRole('heading', { name: 'ヒント（1/3）' })).toBeVisible();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).click();
  await expect(page.getByRole('heading', { name: 'ヒント（2/3）' })).toBeVisible();
});

test('installable and works offline after the first visit', async ({ page, context }) => {
  await page.goto('/');
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
    return href ? (await fetch(href)).json() : null;
  });
  expect(manifest).toMatchObject({ display: 'standalone', orientation: 'portrait', lang: 'ja' });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );

  await page.getByRole('button', { name: 'この案件を受注する' }).first().click();
  await expect(page.getByRole('status')).toHaveText('保存済み');
  // Wait until the service worker controls the page, then reload once so assets are cached.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'TV放映によるアクセス急増' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'TV放映によるアクセス急増' })).toBeVisible();
  // The simulation runs fully on the device.
  await page.getByRole('link', { name: /結果/ }).click();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).click();
  await expect(page.locator('.result-headline h2')).toHaveText('目標未達');
  await context.setOffline(false);
});

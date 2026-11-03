import { expect, test, type Page } from '@playwright/test';

const startTvSpike = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'この案件を受注する' }).first().click();
  await expect(page.getByRole('heading', { level: 2, name: 'TV放映によるアクセス急増' })).toBeVisible();
};

test('a new player can take the TV spike job and read the brief', async ({ page }) => {
  await startTvSpike(page);
  await expect(page.locator('.customer-request')).toContainText('10倍');
  await expect(page.getByText('16,000 cr 以下')).toBeVisible();
  await expect(page.getByText('削除できません（設定変更は可能）')).toBeVisible();
  // No horizontal scrolling on a phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('tabs keep project state and the back button returns to the list', async ({ page }) => {
  await startTvSpike(page);
  await page.getByRole('link', { name: /構成/ }).tap();
  await page.getByRole('button', { name: 'EC2 web' }).tap();
  await expect(page.getByRole('dialog')).toContainText('サーバー (EC2)');
  await page.getByRole('link', { name: /結果/ }).tap();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).tap();
  await expect(page.locator('.result-headline h2')).toHaveText('目標未達');
  await expect(page.getByText('サーバーの処理能力が不足し').first()).toBeVisible();
  await page.getByRole('link', { name: /概要/ }).tap();
  await page.getByRole('link', { name: /結果/ }).tap();
  await expect(page.locator('.result-headline h2')).toHaveText('目標未達');
  // Browser back returns to the previous tab.
  await page.goBack();
  await expect(page.getByRole('heading', { level: 2, name: 'TV放映によるアクセス急増' })).toBeVisible();
  await page.getByRole('button', { name: '案件一覧に戻る' }).tap();
  await expect(page.getByRole('heading', { name: '担当案件' })).toBeVisible();
  await expect(page.locator('.project-card')).toContainText('目標未達');
});

test('projects persist across reloads and can be deleted', async ({ page }) => {
  await startTvSpike(page);
  await expect(page.getByRole('status')).toHaveText('保存済み');
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'TV放映によるアクセス急増' })).toBeVisible();
  await page.goto('/#/');
  await expect(page.locator('.project-card')).toHaveCount(1);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '削除' }).tap();
  await expect(page.locator('.project-card')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('まだ案件がありません')).toBeVisible();
});

test('the sandbox starts empty and explains why it cannot run yet', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'この案件を受注する' }).nth(1).click();
  await page.getByRole('link', { name: /結果/ }).tap();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).tap();
  await expect(page.getByRole('alert')).toContainText('インターネットからサーバーへの経路がありません');
});

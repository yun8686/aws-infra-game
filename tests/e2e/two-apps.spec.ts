import { expect, test } from '@playwright/test';

test('mission 2: choose which apps each server runs and read results per app', async ({ page }) => {
  await page.goto('/');
  await page
    .locator('.card', { hasText: 'ショップと受注管理の同居' })
    .getByRole('button', { name: 'この案件を受注する' })
    .click();

  // Objectives are stated per app.
  const table = page.locator('.objective-table');
  await expect(table.getByRole('row', { name: /受注管理/ })).toContainText('300 ms 以下');
  await expect(table.getByRole('row', { name: /ショップ画面/ })).toContainText('400 ms 以下');

  await page.getByRole('link', { name: /構成/ }).tap();
  const sheet = page.getByRole('dialog');
  // Both servers start with both apps; the diagram says so.
  await expect(page.getByRole('button', { name: /EC2 web-1 small・50 rps ショップ・受注/ })).toBeVisible();

  // web-1 runs order management only, web-2 the shop only.
  await page.getByRole('button', { name: /EC2 web-1/ }).tap();
  await sheet.getByRole('checkbox', { name: 'ショップ画面' }).uncheck();
  await expect(sheet.getByRole('checkbox', { name: '受注管理' })).toBeDisabled(); // the last app cannot be removed
  await sheet.getByRole('button', { name: '閉じる' }).tap();
  await page.getByRole('button', { name: /EC2 web-2/ }).tap();
  await sheet.getByRole('checkbox', { name: '受注管理' }).uncheck();
  await sheet.getByRole('button', { name: '閉じる' }).tap();
  await expect(page.getByRole('button', { name: /EC2 web-1 .* 受注$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /EC2 web-2 .* ショップ$/ })).toBeVisible();

  // Removing order management everywhere is flagged before running.
  await page.getByRole('button', { name: /EC2 web-1/ }).tap();
  await sheet.getByRole('checkbox', { name: 'ショップ画面' }).check();
  await sheet.getByRole('checkbox', { name: '受注管理' }).uncheck();
  await sheet.getByRole('button', { name: '閉じる' }).tap();
  await page.getByRole('button', { name: /構成チェック/ }).tap();
  await expect(sheet).toContainText('「受注管理」を動かしているサーバーがありません');
  await sheet.getByRole('button', { name: '閉じる' }).tap();
  await page.getByRole('button', { name: '元に戻す' }).first().tap();
  await page.getByRole('button', { name: '元に戻す' }).first().tap();

  // Results and monitoring are per app.
  await page.getByRole('link', { name: /結果/ }).tap();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).tap();
  await expect(page.locator('.dimension-list')).toContainText('受注管理：応答時間（p95）');
  await expect(page.locator('.dimension-list')).toContainText('ショップ画面：エラー率');
  await expect(page.locator('.bottleneck-list')).toContainText('ショップ画面への影響');
  await page.getByRole('link', { name: /監視/ }).tap();
  await expect(page.locator('.chart-card', { hasText: '応答時間' }).locator('.chart-legend')).toContainText(
    '受注管理',
  );
  await expect(page.locator('.chart-card', { hasText: '応答時間' })).toContainText(
    '受注管理の目標(p95) 300ms',
  );
});

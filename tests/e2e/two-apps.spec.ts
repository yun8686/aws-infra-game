import { startMission, tapResource } from './helpers';
import { expect, test } from '@playwright/test';

test('mission 2: choose which apps each server runs and read results per app', async ({ page }) => {
  await startMission(page, 'ショップと受注管理の同居');
  const table = page.locator('.objective-table');
  await expect(table.getByRole('row', { name: /受注管理/ })).toContainText('300 ms 以下');
  await expect(table.getByRole('row', { name: /ショップ画面/ })).toContainText('400 ms 以下');

  await page.getByRole('link', { name: /構成/ }).tap();
  const sheet = page.getByRole('dialog');
  await tapResource(page, 'web-1');
  await expect(sheet.getByRole('button', { name: 'ショップ画面', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await sheet.getByRole('button', { name: 'ショップ画面', exact: true }).tap();
  // The last app cannot be removed.
  await expect(sheet.getByRole('button', { name: '受注管理', exact: true })).toBeDisabled();
  await sheet.getByRole('button', { name: '閉じる' }).tap();
  await tapResource(page, 'web-2');
  await sheet.getByRole('button', { name: '受注管理', exact: true }).tap();
  await sheet.getByRole('button', { name: '閉じる' }).tap();

  // Removing order management everywhere is flagged before running.
  await tapResource(page, 'web-1');
  await sheet.getByRole('button', { name: 'ショップ画面', exact: true }).tap();
  await sheet.getByRole('button', { name: '受注管理', exact: true }).tap();
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
  await page.getByRole('link', { name: /監視/ }).tap();
  await expect(page.locator('.chart-card', { hasText: '応答時間' }).locator('.chart-legend')).toContainText(
    '受注管理',
  );
});

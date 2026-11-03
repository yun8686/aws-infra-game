import { expect, test } from '@playwright/test';

test('monitoring explains the run over time and links back to the cause', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'この案件を受注する' }).first().click();

  // Monitor tab offers to run when there is no result yet.
  await page.getByRole('link', { name: /監視/ }).tap();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).tap();
  await expect(page.getByRole('heading', { name: 'エラー率' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'データベース接続数' })).toBeVisible();

  // Scrub to the disclosed failure and see it in the timeline and the overlay.
  await page.getByRole('slider', { name: '時刻', exact: true }).fill('55');
  await expect(page.locator('.playback-time')).toHaveText('55分 / 119分');
  await expect(page.locator('.timeline-list').first()).toContainText('サーバー障害が発生');
  await expect(page.locator('.monitor-graph')).toContainText('⛔ 過負荷・1台');

  // Charts are keyboard/scrub accessible and share the playhead.
  const chart = page.getByRole('slider', { name: 'エラー率（時刻を選択）' });
  await chart.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.playback-time')).toHaveText('56分 / 119分');

  // Results: grouped causes with links to the graph and to the time.
  await page.getByRole('link', { name: /結果/ }).tap();
  await expect(page.locator('.bottleneck-list > li')).toHaveCount(2);
  await expect(page.locator('.bottleneck-list > li').first()).toContainText('32〜89分、');
  await page.getByRole('button', { name: '構成図で見る' }).first().tap();
  await expect(page.getByRole('dialog')).toContainText('サーバー (EC2)');

  // Editing makes the result stale until re-run.
  await page.getByRole('dialog').getByRole('button', { name: '台数を増やす' }).tap();
  await page.getByRole('link', { name: /結果/ }).tap();
  await expect(page.getByText('構成が変更されています')).toBeVisible();
  await page.getByRole('button', { name: '再実行' }).tap();
  await expect(page.getByText('構成が変更されています')).toHaveCount(0);
});

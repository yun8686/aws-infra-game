import { expect, test, type Page } from '@playwright/test';

const openArchitecture = async (page: Page, missionIndex = 0) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'この案件を受注する' }).nth(missionIndex).click();
  await page.getByRole('link', { name: /構成/ }).tap();
};
const sheet = (page: Page) => page.getByRole('dialog');

test('change a setting, see the cost estimate move, and undo it', async ({ page }) => {
  await openArchitecture(page);
  await expect(page.locator('.project-header')).toContainText('月額 5,110 cr');
  await page.getByRole('button', { name: 'EC2 web' }).tap();
  await sheet(page).getByRole('button', { name: '台数を増やす' }).tap();
  await expect(sheet(page).getByLabel('台数', { exact: true })).toHaveValue('3');
  await expect(page.locator('.project-header')).toContainText('月額 5,840 cr');
  await page.getByRole('button', { name: '元に戻す' }).first().tap();
  await expect(page.locator('.project-header')).toContainText('月額 5,110 cr');
});

test('invalid connections are explained, locked resources cannot be deleted', async ({ page }) => {
  await openArchitecture(page);
  await page.getByRole('button', { name: /RDS shop-db/ }).tap();
  await expect(sheet(page).getByLabel('現在の設定の概要')).toContainText('単一AZ（az-a）');
  await expect(sheet(page).getByLabel('現在の設定の概要')).toContainText('DB(5432) ← SG web-sg');
  await expect(sheet(page).getByRole('button', { name: '削除' })).toBeDisabled();
  await expect(sheet(page)).toContainText('ミッションの条件で変更できません');
  await sheet(page).getByRole('button', { name: '接続を追加' }).tap();
  await expect(sheet(page)).toContainText('接続先を選択');
  // Tap a node that cannot be connected to a database.
  await page.getByRole('button', { name: 'NET Internet' }).tap();
  await expect(sheet(page).getByRole('alert')).toContainText('この組み合わせは接続できません');
});

test('solve the TV spike mission with taps only (reference solution A)', async ({ page }) => {
  await openArchitecture(page);

  // Add an Auto Scaling group and place it in both private subnets.
  await page.getByRole('button', { name: '＋ 追加' }).tap();
  await sheet(page)
    .getByRole('button', { name: /Auto Scaling/ })
    .tap();
  await expect(sheet(page)).toContainText('配置先を選択');
  await sheet(page)
    .getByRole('button', { name: /SUB private-a/ })
    .tap();
  await sheet(page)
    .getByRole('button', { name: /SUB private-b/ })
    .tap();
  await sheet(page).getByRole('button', { name: '完了' }).tap();

  // Security group, database and load balancer connections (tap order does not matter).
  for (const target of [/SG web-sg/, /RDS shop-db/, /ALB shop-alb/]) {
    await sheet(page).getByRole('button', { name: '接続を追加' }).tap();
    await sheet(page).getByRole('button', { name: target }).first().tap();
    await expect(sheet(page)).toContainText('asg-1');
  }

  // Size the group for the peak.
  const max = sheet(page).getByLabel('最大台数', { exact: true });
  await max.fill('14');
  await expect(max).toHaveValue('14');
  await sheet(page).getByRole('button', { name: '閉じる' }).tap();

  // Remove the fixed web tier; the confirmation lists dependent connections.
  await page.getByRole('button', { name: 'EC2 web' }).tap();
  await sheet(page).getByRole('button', { name: '削除' }).tap();
  await expect(sheet(page)).toContainText('次の接続も一緒に削除されます');
  await sheet(page).getByRole('button', { name: '削除する' }).tap();
  await expect(page.getByRole('button', { name: 'EC2 web' })).toHaveCount(0);

  // Upgrade the database.
  await page.getByRole('button', { name: 'RDS shop-db' }).tap();
  await sheet(page).getByLabel('インスタンスクラス').selectOption('db.large');
  await sheet(page).getByRole('button', { name: '閉じる' }).tap();

  await expect(page.getByRole('button', { name: /構成チェック: エラー 0 件/ })).toBeVisible();
  // Settings are readable without opening forms: one box per AZ with a summary line.
  await expect(page.getByRole('button', { name: /ASG asg-1 small・2〜14台/ })).toHaveCount(2);
  await expect(page.getByRole('button', { name: /RDS shop-db db\.large・単一AZ/ })).toBeVisible();

  // First attempt: default warm-up (180 s) is too slow for the ramp — availability just misses.
  await page.getByRole('link', { name: /結果/ }).tap();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).tap();
  await expect(page.locator('.result-headline h2')).toHaveText('目標未達');
  await expect(page.locator('.dimension-list')).toContainText('可用性');
  await expect(page.getByText('サーバーの処理能力が不足し').first()).toBeVisible();

  // Iterate: faster warm-up, then the mission passes.
  await page.getByRole('link', { name: /構成/ }).tap();
  await page
    .getByRole('button', { name: /ASG asg-1/ })
    .first()
    .tap();
  await sheet(page).getByRole('button', { name: '起動完了までの時間を減らす' }).tap();
  await sheet(page).getByRole('button', { name: '起動完了までの時間を減らす' }).tap();
  await expect(sheet(page).getByLabel('起動完了までの時間', { exact: true })).toHaveValue('120');
  await page.getByRole('link', { name: /結果/ }).tap();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).tap();
  await expect(page.locator('.result-headline h2')).toHaveText('目標達成');

  // The edits were autosaved.
  await page.reload();
  await page.getByRole('link', { name: /構成/ }).tap();
  await expect(page.getByRole('button', { name: /ASG asg-1/ })).toHaveCount(2); // one box per AZ
});

test('validation panel and outline view both lead to the resource', async ({ page }) => {
  await openArchitecture(page, 1); // sandbox
  await page.getByRole('button', { name: /構成チェック/ }).tap();
  await expect(sheet(page)).toContainText('インターネットからサーバーへの経路がありません');
  await sheet(page)
    .getByRole('button', { name: /インターネットからサーバーへの経路がありません/ })
    .tap();
  await expect(sheet(page)).toContainText('インターネット');
  await sheet(page).getByRole('button', { name: '閉じる' }).tap();
  await page.getByRole('button', { name: '≡ 一覧' }).tap();
  await page.getByRole('button', { name: 'NET Internet' }).tap();
  await expect(sheet(page)).toContainText('ユーザーからのアクセスの入口です');
});

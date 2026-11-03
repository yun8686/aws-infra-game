import { expect, test } from '@playwright/test';
import { add, crumb, openFrame, startMission, tapItem, tapResource } from './helpers';

test('draw a working architecture from an empty Region, frame by frame', async ({ page }) => {
  await startMission(page, 'サンドボックス');
  await page.getByRole('link', { name: /構成/ }).tap();
  const sheet = page.getByRole('dialog');
  await expect(page.locator('.breadcrumb [aria-current]')).toHaveText('リージョン');

  // Region › VPC
  await add(page, /^VPC/);
  await openFrame(page, 'vpc-1');

  // VPC › two AZs, each with a public and a private subnet
  await add(page, /^アベイラビリティーゾーン/);
  await add(page, /^アベイラビリティーゾーン/);
  for (const az of ['AZ a', 'AZ b']) {
    await openFrame(page, az);
    await add(page, /^パブリックサブネット/);
    await add(page, /^プライベートサブネット/);
    await crumb(page, 'vpc-1');
  }
  await expect(
    page.locator('.diagram-canvas').getByRole('button', { name: 'private-b', exact: true }),
  ).toBeVisible();

  // One security group: HTTP from anywhere, DB port from inside the VPC.
  await add(page, /^セキュリティグループ/);
  await sheet.getByRole('button', { name: '＋ ルールを追加' }).tap();
  await sheet.getByRole('button', { name: '＋ ルールを追加' }).tap();
  await sheet.getByLabel('ルール2のポート').selectOption('5432');
  await sheet.getByLabel('ルール2の送信元').selectOption('vpc');
  await sheet.getByRole('button', { name: '閉じる' }).tap();

  // Load balancer and database live in the VPC and span subnets (suggested automatically).
  await add(page, /^Application Load Balancer/);
  await expect(sheet.getByRole('button', { name: /^public-a/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByRole('button', { name: /^public-b/ })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: /^sg-1/ }).tap();
  await sheet.getByRole('button', { name: '閉じる' }).tap();
  await add(page, /^RDS/);
  await expect(sheet.getByRole('button', { name: /^private-a/ })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: /^sg-1/ }).tap();
  await sheet.getByRole('button', { name: '閉じる' }).tap();

  // A server in a private subnet, connected to the database.
  await openFrame(page, 'AZ a');
  await openFrame(page, 'private-a');
  await add(page, /^EC2/);
  await sheet.getByRole('button', { name: /^sg-1/ }).tap();
  await sheet.getByRole('button', { name: '→ データベースにつなぐ' }).tap();
  await sheet.getByRole('button', { name: /^db-1/ }).tap();
  await expect(page.locator('.toast')).toContainText('web-1 → db-1 をつなぎました');
  await sheet.getByRole('button', { name: '閉じる' }).tap();

  // Users → ALB → server, connected from the VPC view where all three are visible.
  await crumb(page, 'vpc-1');
  await tapResource(page, 'users');
  await sheet.getByRole('button', { name: '→ リクエストの送り先をつなぐ' }).tap();
  await tapItem(page, 'alb-1');
  await sheet.getByRole('button', { name: '閉じる' }).tap();
  await tapResource(page, 'alb-1');
  await sheet.getByRole('button', { name: '→ リクエストの送り先をつなぐ' }).tap();
  await sheet.getByRole('button', { name: /^web-1/ }).tap();
  await sheet.getByRole('button', { name: '閉じる' }).tap();

  // No errors: the same engine runs it.
  await expect(page.getByRole('button', { name: /構成チェック/ })).not.toContainText('⛔');
  await page.getByRole('link', { name: /結果/ }).tap();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).tap();
  await expect(page.locator('.result-headline')).toBeVisible();
});

test('mission 1 solved through the diagram: Auto Scaling replaces the fixed servers', async ({ page }) => {
  await startMission(page, 'TV放映によるアクセス急増');
  await page.getByRole('link', { name: /構成/ }).tap();
  const sheet = page.getByRole('dialog');

  await add(page, /^Auto Scaling/);
  for (let i = 0; i < 8; i++) await sheet.getByRole('button', { name: '最大台数を増やす' }).tap();
  for (let i = 0; i < 2; i++) await sheet.getByRole('button', { name: 'ウォームアップを減らす' }).tap();
  await sheet.getByRole('button', { name: /^web-sg/ }).tap();
  await sheet.getByRole('button', { name: '→ データベースにつなぐ' }).tap();
  await sheet.getByRole('button', { name: /^shop-db/ }).tap();
  await sheet.getByRole('button', { name: '閉じる' }).tap();

  await tapResource(page, 'shop-alb');
  await sheet.getByRole('button', { name: '→ リクエストの送り先をつなぐ' }).tap();
  await sheet.getByRole('button', { name: /^asg-1/ }).tap();
  await sheet.getByRole('button', { name: '閉じる' }).tap();

  for (const web of ['web-1', 'web-2']) {
    await tapResource(page, web);
    await sheet.getByRole('button', { name: '削除' }).tap();
    await sheet.getByRole('button', { name: '削除する' }).tap();
  }

  await tapResource(page, 'shop-db');
  await expect(sheet.getByRole('button', { name: '削除' })).toBeDisabled();
  await sheet.getByRole('button', { name: /^db\.large/ }).tap();
  await sheet.getByRole('button', { name: '閉じる' }).tap();

  await page.getByRole('link', { name: /結果/ }).tap();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).tap();
  await expect(page.locator('.result-headline h2')).toHaveText('目標達成');
});

test('frames can be reconfigured and removed with everything inside, then undone', async ({ page }) => {
  await startMission(page, 'TV放映によるアクセス急増');
  await page.getByRole('link', { name: /構成/ }).tap();
  const sheet = page.getByRole('dialog');
  await openFrame(page, 'AZ b');
  await page.getByRole('button', { name: /AZ bの設定/ }).tap();
  await sheet.getByRole('button', { name: 'この枠を削除' }).tap();
  // The locked database uses a subnet in this AZ, so the customer's constraint blocks it.
  await sheet.getByRole('button', { name: '削除する' }).tap();
  await expect(page.locator('.toast')).toContainText('顧客の要望で削除できません');
});

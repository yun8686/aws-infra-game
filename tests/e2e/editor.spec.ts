import { expect, test } from '@playwright/test';
import { add, crumb, openFrame, startMission, tapItem, tapResource } from './helpers';

test('draw a working architecture from an empty Region, frame by frame', async ({ page }) => {
  await startMission(page, 'サンドボックス');
  await page.getByRole('link', { name: /構成/ }).tap();
  const sheet = page.getByRole('dialog');
  await expect(page.locator('.breadcrumb [aria-current]')).toHaveText('リージョン');

  // Region › VPC, with an Internet Gateway so users can reach it
  await add(page, /^VPC/);
  await openFrame(page, 'vpc-1');
  await add(page, /^インターネットゲートウェイ/);
  await sheet.getByRole('button', { name: '閉じる' }).tap();

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

  // The load balancer lives in the VPC and spans subnets (suggested automatically).
  await add(page, /^Application Load Balancer/);
  await expect(sheet.getByRole('button', { name: /^public-a/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByRole('button', { name: /^public-b/ })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: /^sg-1/ }).tap();
  await sheet.getByRole('button', { name: '閉じる' }).tap();

  // A database and a server in a private subnet, the server connected to the database.
  await openFrame(page, 'AZ a');
  await openFrame(page, 'private-a');
  await add(page, /^RDS/);
  await expect(sheet.getByRole('button', { name: /^private-a/ })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: /^sg-1/ }).tap();
  await sheet.getByRole('button', { name: '閉じる' }).tap();
  await add(page, /^EC2/);
  await sheet.getByRole('button', { name: /^sg-1/ }).tap();
  await sheet.getByRole('button', { name: '→ データベースにつなぐ' }).tap();
  // Connect mode: the diagram stays visible; the target is tapped on the diagram.
  await expect(sheet).toHaveCount(0);
  await tapItem(page, 'db-1');
  await expect(page.locator('.toast')).toContainText('web-1 → db-1 をつなぎました');
  await page.getByRole('button', { name: '完了' }).tap();
  await sheet.getByRole('button', { name: '閉じる' }).tap();

  // Users → ALB → server, connected from the VPC view where all three are visible.
  await crumb(page, 'vpc-1');
  await tapResource(page, 'users');
  await sheet.getByRole('button', { name: '→ リクエストの送り先をつなぐ' }).tap();
  await tapItem(page, 'alb-1');
  await page.getByRole('button', { name: '完了' }).tap();
  await sheet.getByRole('button', { name: '閉じる' }).tap();
  await tapResource(page, 'alb-1');
  await sheet.getByRole('button', { name: '→ リクエストの送り先をつなぐ' }).tap();
  // Candidates are also listed in the bar.
  await page
    .locator('.connect-banner')
    .getByRole('button', { name: /^web-1/ })
    .tap();
  await page.getByRole('button', { name: '完了' }).tap();
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
  await tapItem(page, 'shop-db');
  await page.getByRole('button', { name: '完了' }).tap();
  await sheet.getByRole('button', { name: '閉じる' }).tap();

  await tapResource(page, 'shop-alb');
  await sheet.getByRole('button', { name: '→ リクエストの送り先をつなぐ' }).tap();
  await tapItem(page, 'asg-1');
  await page.getByRole('button', { name: '完了' }).tap();
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

test('frames: settings, locked dependencies, delete with everything inside, undo', async ({ page }) => {
  await startMission(page, 'TV放映によるアクセス急増');
  await page.getByRole('link', { name: /構成/ }).tap();
  const sheet = page.getByRole('dialog');
  // AZ a holds the customer's database, so it cannot be removed.
  await openFrame(page, 'AZ a');
  await page.getByRole('button', { name: /AZ aの設定/ }).tap();
  await sheet.getByRole('button', { name: 'この枠を削除' }).tap();
  await sheet.getByRole('button', { name: '削除する' }).tap();
  await expect(page.locator('.toast')).toContainText('顧客の要望で削除できません');
  // AZ b can go, with its subnets; undo brings it back.
  await crumb(page, 'shop-vpc');
  await openFrame(page, 'AZ b');
  await page.getByRole('button', { name: /AZ bの設定/ }).tap();
  await sheet.getByRole('button', { name: 'この枠を削除' }).tap();
  await expect(sheet).toContainText('public-b');
  await sheet.getByRole('button', { name: '削除する' }).tap();
  await expect(page.locator('.breadcrumb [aria-current]')).toHaveText('shop-vpc');
  await expect(
    page.locator('.diagram-canvas').getByRole('button', { name: 'AZ b', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す' }).first().tap();
  await expect(
    page.locator('.diagram-canvas').getByRole('button', { name: 'AZ b', exact: true }),
  ).toBeVisible();
});

test('security groups show where they are attached', async ({ page }) => {
  await startMission(page, 'TV放映によるアクセス急増');
  await page.getByRole('link', { name: /構成/ }).tap();
  await expect(
    page.locator('.diagram-canvas').getByRole('button', { name: 'web-sg 2件に適用' }),
  ).toBeVisible();
  await tapResource(page, 'web-sg');
  await expect(page.getByRole('dialog')).toContainText('このセキュリティグループを付けているリソース');
  await expect(page.locator('.item.is-related')).toHaveCount(2);
});

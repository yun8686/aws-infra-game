import { tapResource } from './helpers';
import { expect, test, type Page } from '@playwright/test';

const openArchitecture = async (page: Page, missionTitle = 'TV放映によるアクセス急増') => {
  await page.goto('/');
  await page
    .locator('.card', { hasText: missionTitle })
    .getByRole('button', { name: 'この案件を受注する' })
    .click();
  await page.getByRole('link', { name: /構成/ }).tap();
};
const sheet = (page: Page) => page.getByRole('dialog');
/** Drill-down: open the server layer from the overview. */
const openServers = async (page: Page) => {
  await page.getByRole('navigation', { name: '構成図の階層' }).getByRole('button', { name: '全体' }).tap();
  await page.locator('.overview-box.group-compute').first().tap();
};

test('change a setting, see the cost estimate move, and undo it', async ({ page }) => {
  await openArchitecture(page);
  await expect(page.locator('.project-header')).toContainText('月額 5,110 cr');
  await tapResource(page, /EC2 web-1/);
  await sheet(page).getByLabel('インスタンスサイズ').selectOption('medium');
  await expect(page.getByRole('button', { name: /EC2 web-1 medium・100 rps/ })).toBeVisible();
  await expect(page.locator('.project-header')).toContainText('月額 5,840 cr');
  await page.getByRole('button', { name: '元に戻す' }).first().tap();
  await expect(page.locator('.project-header')).toContainText('月額 5,110 cr');
});

test('launch another EC2 instance with the same settings in another AZ', async ({ page }) => {
  await openArchitecture(page);
  await tapResource(page, /EC2 web-1/);
  // A single instance has no count to change and belongs to one subnet.
  await expect(sheet(page).getByLabel('台数', { exact: true })).toHaveCount(0);
  await sheet(page).getByRole('button', { name: '＋ 同じ設定でもう1台' }).tap();
  await expect(sheet(page)).toContainText('配置先を選択');
  await sheet(page)
    .getByRole('button', { name: /SUB private-b/ })
    .tap();
  // Back on the new instance, with its settings and connections copied.
  const overview = sheet(page).getByLabel('現在の設定の概要');
  await expect(overview).toContainText('private-b（az-b・プライベート）');
  await expect(overview).toContainText('web-sg');
  await expect(overview).toContainText('shop-db（プール 10）');
  await expect(page.locator('.project-header')).toContainText('月額 5,840 cr');
  await expect(page.getByRole('button', { name: /EC2 web-3/ })).toBeVisible();
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
  // Bring the Internet box above the connect sheet, then tap it on the diagram.
  await page.getByRole('button', { name: /^Internet/ }).evaluate((el) => {
    window.scrollBy(0, el.getBoundingClientRect().top - 200);
  });
  await page.getByRole('button', { name: /^Internet/ }).tap();
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

  // Remove the two fixed web servers; the confirmation lists dependent connections.
  for (const name of [/EC2 web-1/, /EC2 web-2/]) {
    await tapResource(page, name);
    await sheet(page).getByRole('button', { name: '削除' }).tap();
    await expect(sheet(page)).toContainText('次の接続も一緒に削除されます');
    await sheet(page).getByRole('button', { name: '削除する' }).tap();
  }
  await expect(page.getByRole('button', { name: /EC2 web/ })).toHaveCount(0);

  // Upgrade the database.
  await tapResource(page, /RDS shop-db/);
  await sheet(page).getByLabel('インスタンスクラス').selectOption('db.large');
  await sheet(page).getByRole('button', { name: '閉じる' }).tap();

  await expect(page.getByRole('button', { name: /構成チェック: エラー 0 件/ })).toBeVisible();
  // Settings are readable without opening forms: one box per AZ with a summary line.
  await openServers(page);
  await expect(page.getByRole('button', { name: /ASG asg-1 small・2〜14台/ })).toHaveCount(2);
  // The database is a single-resource layer: its summary is on the overview.
  await page.getByRole('navigation', { name: '構成図の階層' }).getByRole('button', { name: '全体' }).tap();
  await expect(page.getByRole('button', { name: /RDS shop-db db\.large・単一AZ/ })).toBeVisible();

  // First attempt: default warm-up (180 s) is too slow for the ramp — availability just misses.
  await page.getByRole('link', { name: /結果/ }).tap();
  await page.getByRole('button', { name: /シミュレーションを実行/ }).tap();
  await expect(page.locator('.result-headline h2')).toHaveText('目標未達');
  await expect(page.locator('.dimension-list')).toContainText('可用性');
  await expect(page.getByText('サーバーの処理能力が不足し').first()).toBeVisible();

  // Iterate: faster warm-up, then the mission passes.
  await page.getByRole('link', { name: /構成/ }).tap();
  await openServers(page);
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
  await openServers(page);
  await expect(page.getByRole('button', { name: /ASG asg-1/ })).toHaveCount(2); // one box per AZ
});

test('validation panel and outline view both lead to the resource', async ({ page }) => {
  await openArchitecture(page, 'サンドボックス');
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

test('drill into a subnet to see what sits together in it', async ({ page }) => {
  await openArchitecture(page);
  await page.getByRole('button', { name: /^private-a az-a・プライベート/ }).tap();
  const crumbs = page.getByRole('navigation', { name: '構成図の階層' });
  await expect(crumbs.getByRole('button', { name: 'private-a' })).toHaveAttribute('aria-current', 'page');
  // The servers and the database share private-a and appear side by side.
  for (const name of [/EC2 web-1/, /EC2 web-2/, /RDS shop-db/]) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
  await page.getByRole('button', { name: /RDS shop-db/ }).tap();
  await expect(sheet(page)).toContainText('データベース (RDS)');
});

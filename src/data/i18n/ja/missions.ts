import type { MissionId } from '../../missions';

export interface MissionText {
  readonly title: string;
  readonly projectName: string;
  readonly customer: string;
  readonly businessType: string;
  /** One-line summary for cards. */
  readonly summary: string;
  /** The customer's request, in their words. */
  readonly request: string;
  readonly situation: readonly string[];
  /** What to do first; shown in the briefing. */
  readonly firstStep: string;
  /** Revealed one per failed attempt in the results (playtest: never all at once). */
  readonly hints: readonly string[];
  /** Label for the upcoming scheduled event on the project list. */
  readonly nextEvent?: string;
}

export const MISSION_TEXT_JA: { readonly [K in MissionId]: MissionText } = {
  'tv-spike': {
    title: 'TV放映によるアクセス急増',
    projectName: 'ECショップ「はなまる雑貨」',
    customer: 'はなまる雑貨 株式会社',
    businessType: 'EC（オンラインショップ）',
    summary: 'テレビで紹介され、アクセスが通常の約10倍になる見込みです。',
    request:
      '来週、情報番組でうちのショップが紹介されることになりました！ 放映直後はアクセスが10倍くらいになるそうです。せっかくのチャンスなので、サイトが落ちたり遅くなったりしないようにしてほしいです。ただ、インフラ費用は月 16,000 クレジットまでに抑えたいです。',
    situation: [
      '現在の構成はロードバランサー、Webサーバー2台、データベース1台です。',
      '放映後30分ほどでアクセスが急増し、約30分間ピークが続いた後、徐々に通常に戻ります。',
      'ピーク中にサーバー1台の障害が発生することがシナリオで予告されています。',
      '顧客データがあるため、データベースは削除できません（サイズ変更は可能）。',
    ],
    firstStep:
      'まずは何も変えずに「結果」タブでシミュレーションを実行し、どこで問題が起きるかを確かめましょう。',
    hints: [
      '「監視」タブで、エラーが出始めた時刻にどのリソースが ⛔ になっているかを見ましょう。サーバーを増やすと、DB への接続数（台数 × プールサイズ）も増えます。',
      'ピークの30分のためだけに常に多くのサーバーを動かすと、予算を超えます。負荷に合わせて台数を増減する Auto Scaling を検討しましょう。',
      'Auto Scaling は追加後に「配置（サブネット、2つのAZが安心）」「セキュリティグループ」「ロードバランサーから」「データベースへ」の4つの接続が必要です。置き換えた後、元のサーバーは削除できます。',
    ],
    nextEvent: 'TV放映（アクセス約10倍）',
  },
  'two-apps': {
    title: 'ショップと受注管理の同居',
    projectName: 'ECショップ「はなまる雑貨」（受注管理あり）',
    customer: 'はなまる雑貨 株式会社',
    businessType: 'EC（オンラインショップ）',
    summary: 'TV放映でショップが急増。社内の受注管理は止められません。',
    request:
      'TV放映でショップのアクセスが10倍になります。同じサーバーで動いている受注管理（社内で注文を処理し、出荷を指示する画面）は、遅くなったり止まったりすると出荷が止まってしまいます。両方を安定させつつ、インフラ費用は月 16,000 クレジットまでに抑えてください。',
    situation: [
      '現在は Web サーバー2台（web-1 / web-2）で、ショップ画面と受注管理の両方を動かしています。',
      'ショップ画面は放映後に約10倍に急増します。受注管理のアクセスは一定ですが、1件あたりの処理が重く（ショップ画面の約3倍）、データベースもよく使います。',
      '受注管理の達成条件はショップ画面より厳しく、応答時間は 300 ms 以下が必要です。',
      'ピーク中にサーバー1台の障害が予告されています。データベースは削除できません。',
    ],
    firstStep:
      'まず何も変えずに実行し、「結果」でアプリごとの達成状況を確かめましょう。サーバーの「動かすアプリ」で、どのアプリをどこで動かすかを選べます。',
    hints: [
      '同じサーバーで動くアプリは処理能力を取り合います。「監視」で受注管理の応答時間が、ショップ画面の急増と同時に悪化していないか見てみましょう。',
      'ショップ画面は Auto Scaling で増減させ、受注管理は別のサーバーで動かすと、急増の影響を切り離せます。分けたサーバーにもデータベースへの接続が必要です。',
      '受注管理用のサーバーを1台だけにすると、余裕がなく応答が遅くなり、故障にも弱くなります。別々のAZに2台置くと安心です。',
    ],
    nextEvent: 'TV放映（ショップのアクセス約10倍）',
  },
  sandbox: {
    title: 'サンドボックス',
    projectName: 'サンドボックス',
    customer: '（練習用）',
    businessType: '自由構築',
    summary: '空の状態から自由に構成を組み立てて試せます。',
    request: '制約なしで自由に構成を作り、シミュレーションで挙動を確認できます。評価は参考値です。',
    situation: [
      'インターネット（入口）だけがある状態から始まります。',
      'シナリオはTV放映のアクセス急増（障害あり）を使います。',
    ],
    firstStep: 'VPC → サブネット → ロードバランサー → サーバー → データベースの順に作るとスムーズです。',
    hints: ['構成チェック（⛔ / ⚠ のボタン）を開くと、足りない接続や設定を確認できます。'],
  },
};

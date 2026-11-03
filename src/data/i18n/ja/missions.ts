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
    hints: [
      'まず現在の構成のままシミュレーションを実行し、どこがボトルネックになるかを確認しましょう。',
      'サーバーを増やすとデータベースへの接続数も増えます。',
      'ピークのためだけに常に多くのサーバーを動かすと、コストが予算を超えます。',
    ],
    nextEvent: 'TV放映（アクセス約10倍）',
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
    hints: ['VPC → サブネット → ロードバランサー → サーバー → データベースの順に作るとスムーズです。'],
  },
};

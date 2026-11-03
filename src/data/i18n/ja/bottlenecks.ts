import type { BottleneckCause } from '../../../domain/simulation/types';
import type { FindingText } from './findings';

/** Japanese explanations for simulation bottlenecks. Placeholders: none yet (node names are shown by the UI). */
export const BOTTLENECK_TEXT_JA: { readonly [K in BottleneckCause]: FindingText } = {
  compute_saturated: {
    message: 'サーバーの処理能力が不足し、リクエストを処理しきれませんでした',
    explanation: '受け付けたリクエストが処理能力を超え、待ち行列からあふれた分がエラーになりました。',
    remediation:
      '台数を増やす、インスタンスサイズを上げる、Auto Scaling を使う、などで処理能力を増やしてください。',
  },
  compute_high_utilization: {
    message: 'サーバーの負荷が高く、応答が遅くなっています',
    explanation: '使用率が高いと待ち時間が増え、応答時間が悪化します。',
    remediation: '余裕を持った処理能力を用意してください。',
  },
  db_capacity: {
    message: 'データベースの処理能力が不足しました',
    explanation:
      'クエリ数がデータベースの処理能力を超え、一部のリクエストが失敗しました。サーバーを増やしても解決しません。',
    remediation: 'DB インスタンスクラスを上げる、ストレージ性能を上げる、などを検討してください。',
  },
  db_high_utilization: {
    message: 'データベースの負荷が高く、応答が遅くなっています',
    explanation: 'データベースの使用率が高いと、1 クエリあたりの待ち時間が増えます。',
    remediation: 'DB の処理能力に余裕を持たせてください。',
  },
  db_connections: {
    message: 'データベースの接続数が上限を超えました',
    explanation:
      'サーバー台数 × コネクションプール数が DB の最大接続数を超えています。サーバーを増やすほど悪化します。',
    remediation: 'プールサイズを小さくする、DB インスタンスクラスを上げる、などで接続数を調整してください。',
  },
  sg_blocked: {
    message: 'セキュリティグループが通信を遮断しました',
    explanation: '接続はありますが、受け側のセキュリティグループのルールがこの通信を許可していません。',
    remediation: '送信元とポートに合う受信ルールを追加してください。',
  },
  unhealthy_target: {
    message: '障害が起きたサーバーにリクエストが送られ続けました',
    explanation:
      'ヘルスチェックが障害を検知するまでの間、または検知の仕組みがない直接公開の構成では、故障したサーバーにもリクエストが届き失敗します。',
    remediation:
      'ロードバランサーのヘルスチェック間隔としきい値を見直し、複数台・複数AZで冗長化してください。',
  },
  compute_unavailable: {
    message: '稼働中のサーバーがありません',
    explanation: 'すべてのサーバーが停止または起動中のため、リクエストを処理できませんでした。',
    remediation: '複数AZに分散し、Auto Scaling で自動復旧できる構成にしてください。',
  },
  db_unavailable: {
    message: 'データベースが停止していました',
    explanation: 'データベースの障害または AZ 障害で、データベースを使うリクエストがすべて失敗しました。',
    remediation: 'Multi-AZ を有効にすると、短時間のフェイルオーバーで復旧できます。',
  },
  no_healthy_targets: {
    message: 'ロードバランサーに正常な転送先がありません',
    explanation: '転送先がない、または通信が遮断されているため、ヘルスチェックに合格する転送先がありません。',
    remediation: '転送先のサーバーを接続し、セキュリティグループで ALB からの通信を許可してください。',
  },
};

import type { Dimension } from '../game';
import type { LearningTopic, Metric } from '../game';

export const DIMENSION_TEXT_JA: { readonly [K in Dimension]: string } = {
  availability: '可用性',
  performance: '性能',
  cost: 'コスト',
  security: 'セキュリティ',
};

export const METRIC_TEXT_JA: { readonly [K in Metric]: string } = {
  availability: '可用性（エラー率 5% 以下の時間の割合）',
  errorRate: 'エラー率',
  p95LatencyMs: '応答時間（p95）',
  projectedMonthly: '月額コスト見積もり',
  criticalSecurityFindings: '重大なセキュリティ指摘の数',
};

export const LEARNING_TOPIC_TEXT_JA: { readonly [K in LearningTopic]: { title: string; summary: string } } = {
  horizontal_scaling: {
    title: '水平スケーリング',
    summary: 'サーバーの台数を増やして処理能力を上げる考え方です。',
  },
  auto_scaling: {
    title: 'Auto Scaling',
    summary: '負荷に合わせて台数を自動で増減し、性能とコストを両立します。',
  },
  database_sizing: {
    title: 'データベースのサイジング',
    summary: 'クエリ量に見合ったインスタンスクラスとストレージ性能を選びます。',
  },
  connection_pooling: {
    title: 'コネクションプール',
    summary: 'サーバー台数 × プールサイズが DB の最大接続数を超えないように設計します。',
  },
  health_checks: {
    title: 'ヘルスチェック',
    summary: '故障したサーバーを早く切り離すための間隔としきい値を調整します。',
  },
  multi_az: {
    title: 'マルチ AZ 構成',
    summary: '複数の AZ に分散し、AZ 単位の障害でもサービスを継続します。',
  },
  security_groups: {
    title: 'セキュリティグループ',
    summary: '必要な送信元とポートだけを許可する最小権限の考え方です。',
  },
  cost_optimization: {
    title: 'コスト最適化',
    summary: 'ピークに合わせて常に過剰な台数を持たず、必要なときだけ増やします。',
  },
  workload_isolation: {
    title: '負荷の分離',
    summary:
      '性質の違うアプリを同じサーバーで動かすと、片方のアクセス急増がもう片方を遅くします。サーバーを分けるか、十分な余裕を持たせましょう。',
  },
  dependencies: {
    title: 'サービスの依存関係',
    summary: 'アプリが動くために必要なサービス（データベースなど）が、すべて接続されているかを確認します。',
  },
};

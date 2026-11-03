import type { ServiceTypeId } from '../../../domain/catalog/ids';

export interface ServiceText {
  readonly name: string;
  /** Very short label for compact node rendering. */
  readonly short: string;
  readonly description: string;
}

export const SERVICE_TEXT_JA: { readonly [K in ServiceTypeId]: ServiceText } = {
  'external.internet': {
    name: 'インターネット',
    short: 'NET',
    description: 'ユーザーからのアクセスの入口です。',
  },
  'network.vpc': { name: 'VPC', short: 'VPC', description: '専用の仮想ネットワークです。' },
  'network.subnet': {
    name: 'サブネット',
    short: 'SUB',
    description: 'VPC を AZ ごとに区切ったネットワークです。',
  },
  'network.security_group': {
    name: 'セキュリティグループ',
    short: 'SG',
    description: 'どこからの通信を受け付けるかを決めるファイアウォールです。',
  },
  'lb.alb': {
    name: 'ロードバランサー (ALB)',
    short: 'ALB',
    description: 'リクエストを複数のサーバーに振り分けます。',
  },
  'compute.ec2': {
    name: 'サーバー (EC2)',
    short: 'EC2',
    description: '1台の仮想サーバーです。1つのサブネットに配置します。',
  },
  'compute.autoscaling': {
    name: 'Auto Scaling',
    short: 'ASG',
    description: '負荷に応じてサーバー台数を自動で増減します。',
  },
  'database.rds': {
    name: 'データベース (RDS)',
    short: 'RDS',
    description: 'マネージドなリレーショナルデータベースです。',
  },
  'monitoring.cloudwatch': {
    name: 'CloudWatch',
    short: 'CW',
    description: 'メトリクスの監視とアラームを提供します。',
  },
};

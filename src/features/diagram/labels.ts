import type { FrameKind, ResourceType } from '../../model';

/** Service names as shown on the diagram and in menus. */
export const RESOURCE_LABEL: Readonly<Record<ResourceType, string>> = {
  users: 'ユーザー',
  alb: 'ALB',
  ec2: 'EC2',
  asg: 'Auto Scaling',
  rds: 'RDS',
  sg: 'セキュリティグループ',
  cloudwatch: 'CloudWatch',
};

export const RESOURCE_LONG_LABEL: Readonly<Record<ResourceType, string>> = {
  users: 'ユーザー（インターネット）',
  alb: 'Application Load Balancer',
  ec2: 'EC2 インスタンス',
  asg: 'Auto Scaling グループ',
  rds: 'RDS データベース',
  sg: 'セキュリティグループ',
  cloudwatch: 'CloudWatch',
};

export const FRAME_LABEL: Readonly<Record<FrameKind, string>> = {
  region: 'リージョン',
  vpc: 'VPC',
  az: 'アベイラビリティーゾーン',
  subnet: 'サブネット',
};

export const TIER_LABEL = { public: 'パブリックサブネット', private: 'プライベートサブネット' } as const;

/** Display name of a frame (the Region and AZ show their kind, as in AWS diagrams). */
export const frameTitle = (kind: FrameKind, name: string): string =>
  kind === 'region' ? 'リージョン' : kind === 'az' ? `AZ ${name.replace(/^az-/, '')}` : name;

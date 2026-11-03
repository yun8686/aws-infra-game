import type { ConnectionTypeId } from '../../../domain/catalog/ids';
import type { ServiceCategory } from '../../../domain/catalog/types';

export const CONNECTION_TEXT_JA: { readonly [K in ConnectionTypeId]: { label: string; verb: string } } = {
  placed_in: { label: '配置', verb: 'に配置' },
  routes_to: { label: 'リクエスト転送', verb: 'へ転送' },
  data_access: { label: 'データアクセス', verb: 'のデータを利用' },
  secured_by: { label: 'セキュリティグループ適用', verb: 'で保護' },
  monitors: { label: '監視', verb: 'を監視' },
};

export const CATEGORY_TEXT_JA: { readonly [K in ServiceCategory]: string } = {
  external: '外部',
  networking: 'ネットワーク',
  load_balancing: '負荷分散',
  compute: 'コンピューティング',
  database: 'データベース',
  monitoring: '監視',
};

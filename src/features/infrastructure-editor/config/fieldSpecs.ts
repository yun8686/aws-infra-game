import type { ConnectionTypeId, ServiceTypeId } from '../../../domain/catalog/ids';
import { AZS, DB_INSTANCE_CLASSES, INSTANCE_SIZES } from '../../../domain/catalog/services';
import { BALANCE } from '../../../domain/simulation/balance';

/**
 * Presentation metadata for configuration forms. Validation stays in the domain schemas;
 * these specs only say how to render and edit each field.
 */
export type FieldSpec =
  | {
      readonly kind: 'select';
      readonly path: readonly string[];
      readonly label: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
      readonly help?: string;
    }
  | {
      readonly kind: 'int';
      readonly path: readonly string[];
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly unit?: string;
      readonly help?: string;
    }
  | {
      readonly kind: 'boolean';
      readonly path: readonly string[];
      readonly label: string;
      readonly help?: string;
    }
  | {
      readonly kind: 'text';
      readonly path: readonly string[];
      readonly label: string;
      readonly help?: string;
    }
  | { readonly kind: 'sgRules'; readonly path: readonly string[]; readonly label: string }
  | { readonly kind: 'alarms'; readonly path: readonly string[]; readonly label: string };

const sizeOptions = INSTANCE_SIZES.map((s) => ({
  value: s,
  label: `${s}（${BALANCE.instance[s].capacityRps} rps・${BALANCE.instance[s].costPerHour} cr/時）`,
}));

const azOptions = AZS.map((az) => ({ value: az, label: az }));

export const SERVICE_FIELDS: { readonly [K in ServiceTypeId]: readonly FieldSpec[] } = {
  'external.internet': [],
  'network.vpc': [
    { kind: 'text', path: ['cidr'], label: 'CIDR', help: '表示用です。重複チェックはしません。' },
  ],
  'network.subnet': [
    {
      kind: 'select',
      path: ['tier'],
      label: '種類',
      options: [
        { value: 'public', label: 'パブリック（インターネットから到達可能）' },
        { value: 'private', label: 'プライベート' },
      ],
    },
    { kind: 'select', path: ['az'], label: 'アベイラビリティゾーン', options: azOptions },
    { kind: 'text', path: ['cidr'], label: 'CIDR' },
  ],
  'network.security_group': [{ kind: 'sgRules', path: ['inboundRules'], label: '受信ルール' }],
  'lb.alb': [
    {
      kind: 'select',
      path: ['scheme'],
      label: 'スキーム',
      options: [
        { value: 'internet-facing', label: 'インターネット向け' },
        { value: 'internal', label: '内部向け' },
      ],
    },
    {
      kind: 'select',
      path: ['listener'],
      label: 'リスナー',
      options: [
        { value: 'http', label: 'HTTP（80）' },
        { value: 'https', label: 'HTTPS（443）' },
      ],
    },
    {
      kind: 'int',
      path: ['healthCheck', 'intervalSec'],
      label: 'ヘルスチェック間隔',
      min: 5,
      max: 300,
      step: 5,
      unit: '秒',
    },
    {
      kind: 'int',
      path: ['healthCheck', 'unhealthyThreshold'],
      label: '異常と判断する連続失敗回数',
      min: 2,
      max: 10,
      step: 1,
      unit: '回',
      help: '間隔 × 回数 が、故障を検知して切り離すまでの時間です。',
    },
  ],
  'compute.ec2': [
    { kind: 'select', path: ['instanceSize'], label: 'インスタンスサイズ', options: sizeOptions },
    {
      kind: 'int',
      path: ['instanceCount'],
      label: '台数',
      min: 1,
      max: 20,
      step: 1,
      unit: '台',
      help: '台数は固定です。故障しても自動では復旧しません。',
    },
  ],
  'compute.autoscaling': [
    { kind: 'select', path: ['instanceSize'], label: 'インスタンスサイズ', options: sizeOptions },
    { kind: 'int', path: ['minCapacity'], label: '最小台数', min: 1, max: 50, step: 1, unit: '台' },
    { kind: 'int', path: ['desiredCapacity'], label: '開始時の台数', min: 1, max: 50, step: 1, unit: '台' },
    { kind: 'int', path: ['maxCapacity'], label: '最大台数', min: 1, max: 50, step: 1, unit: '台' },
    {
      kind: 'int',
      path: ['targetCpuPct'],
      label: '目標CPU使用率',
      min: 10,
      max: 90,
      step: 5,
      unit: '%',
      help: '低いほど早めに台数を増やします（余裕は増えますがコストも増えます）。',
    },
    { kind: 'int', path: ['warmupSec'], label: '起動完了までの時間', min: 0, max: 900, step: 30, unit: '秒' },
  ],
  'database.rds': [
    {
      kind: 'select',
      path: ['instanceClass'],
      label: 'インスタンスクラス',
      options: DB_INSTANCE_CLASSES.map((c) => ({
        value: c,
        label: `${c}（${BALANCE.database[c].capacityQps} qps・接続 ${BALANCE.database[c].maxConnections}・${BALANCE.database[c].costPerHour} cr/時）`,
      })),
    },
    {
      kind: 'select',
      path: ['storageTier'],
      label: 'ストレージ性能',
      options: [
        { value: 'standard', label: '標準' },
        { value: 'provisioned', label: '高性能（処理能力・コスト ×1.5）' },
      ],
    },
    {
      kind: 'boolean',
      path: ['multiAz'],
      label: 'Multi-AZ',
      help: '別のAZにスタンバイを置き、障害時に約2分で切り替えます。コストは2倍です。',
    },
  ],
  'monitoring.cloudwatch': [{ kind: 'alarms', path: ['alarms'], label: 'アラーム' }],
};

export const CONNECTION_FIELDS: { readonly [K in ConnectionTypeId]: readonly FieldSpec[] } = {
  placed_in: [],
  routes_to: [],
  data_access: [
    {
      kind: 'int',
      path: ['poolSize'],
      label: 'コネクションプール（1台あたり）',
      min: 1,
      max: 100,
      step: 1,
      help: '台数 × プール数 が DB の最大接続数を超えるとエラーになります。',
    },
  ],
  secured_by: [],
  monitors: [],
};

export const getIn = (obj: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>(
    (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );

export const setIn = (obj: unknown, path: readonly string[], value: unknown): unknown => {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  const base = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
  return { ...base, [head]: setIn(base[head], rest, value) };
};

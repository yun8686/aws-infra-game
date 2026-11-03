import {
  DB_CLASSES,
  INSTANCE_SIZES,
  PORTS,
  ZONES,
  childFrames,
  framesOfKind,
  resourcesOfType,
  vpcOfFrame,
  zoneOfSubnet,
  type AppId,
  type Diagram,
  type Frame,
  type Resource,
  type ResourceConfigMap,
  type SgRule,
} from '../../model';
import { BALANCE } from '../../sim';
import { APP_TEXT_JA, TIER_LABEL } from '../../i18n';

/** Applies a config; returns an error message when the edit is rejected. */
export type Commit = (config: unknown) => string | undefined;

// ---- Small tap-first controls --------------------------------------------------------------

function Choices<T extends string>({
  label,
  help,
  options,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  options: readonly { value: T; label: string; detail?: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="choice-list">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="choice"
            aria-pressed={o.value === value}
            disabled={o.disabled}
            onClick={() => o.value !== value && onChange(o.value)}
          >
            {o.label}
            {o.detail && <small>{o.detail}</small>}
          </button>
        ))}
      </div>
      {help && <span className="field-help">{help}</span>}
    </fieldset>
  );
}

function MultiChoices({
  label,
  help,
  options,
  values,
  onChange,
  min = 0,
  empty,
}: {
  label: string;
  help?: string;
  options: readonly { value: string; label: string; detail?: string }[];
  values: readonly string[];
  onChange: (v: string[]) => void;
  min?: number;
  empty?: string;
}) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      {options.length === 0 && <span className="field-help">{empty ?? '選べるものがありません'}</span>}
      <div className="choice-list">
        {options.map((o) => {
          const on = values.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              className="choice"
              aria-pressed={on}
              disabled={on && values.length <= min}
              onClick={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
            >
              {o.label}
              {o.detail && <small>{o.detail}</small>}
            </button>
          );
        })}
      </div>
      {help && <span className="field-help">{help}</span>}
    </fieldset>
  );
}

function Stepper({
  label,
  help,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <span className="field-label" style={{ fontSize: 13, fontWeight: 600 }}>
        {label}
      </span>
      <div className="stepper">
        <button
          type="button"
          aria-label={`${label}を減らす`}
          disabled={value - step < min}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          −
        </button>
        <output
          aria-live="polite"
          style={{ minWidth: 56, textAlign: 'center', fontSize: 18, fontWeight: 600 }}
        >
          {value}
        </output>
        <button
          type="button"
          aria-label={`${label}を増やす`}
          disabled={value + step > max}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          ＋
        </button>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {help && <span className="field-help">{help}</span>}
    </div>
  );
}

function Toggle({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="field">
      <label className="check-row">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {help && <span className="field-help">{help}</span>}
    </div>
  );
}

// ---- Option helpers ---------------------------------------------------------------------------

const sizeOptions = INSTANCE_SIZES.map((s) => ({
  value: s,
  label: s,
  detail: `${BALANCE.instance[s].capacityRps} rps・${BALANCE.instance[s].costPerHour} cr/時`,
}));

/** A subnet of the same tier in another AZ, for a new Multi-AZ standby. */
const suggestStandby = (d: Diagram, primaryId: string | null): string | null => {
  if (!primaryId) return null;
  const primary = framesOfKind(d, 'subnet').find((s) => s.id === primaryId);
  const zone = zoneOfSubnet(d, primaryId);
  const vpcId = vpcOfFrame(d, primaryId)?.id;
  const others = framesOfKind(d, 'subnet').filter(
    (s) => vpcOfFrame(d, s.id)?.id === vpcId && zoneOfSubnet(d, s.id) !== zone,
  );
  return (others.find((s) => s.config.tier === primary?.config.tier) ?? others[0])?.id ?? null;
};

const zoneLabel = (z: string | undefined) => (z ? `AZ ${z.slice(-1)}` : '');

const subnetOptions = (d: Diagram, vpcId: string | undefined) =>
  framesOfKind(d, 'subnet')
    .filter((s) => vpcOfFrame(d, s.id)?.id === vpcId)
    .map((s) => ({
      value: s.id,
      label: s.name,
      detail: `${zoneLabel(zoneOfSubnet(d, s.id))}・${TIER_LABEL[s.config.tier]}`,
    }));

const sgOptions = (d: Diagram, vpcId: string | undefined, except?: string) =>
  resourcesOfType(d, 'sg')
    .filter((g) => g.id !== except && vpcOfFrame(d, g.frameId)?.id === vpcId)
    .map((g) => ({
      value: g.id,
      label: g.name,
      detail: g.config.inbound.map(ruleSummary).join('、') || 'ルールなし',
    }));

const PORT_LABEL: Record<string, string> = {
  80: '80 (HTTP)',
  443: '443 (HTTPS)',
  5432: '5432 (DB)',
  22: '22 (SSH)',
  3389: '3389 (RDP)',
  all: 'すべて',
};
const PORT_OPTIONS = ['80', '443', '5432', '22', '3389', 'all'] as const;

const ruleSummary = (r: SgRule) => {
  const src = r.source.kind === 'anywhere' ? '全世界' : r.source.kind === 'vpc' ? 'VPC内' : 'SG';
  return `${r.port === 'all' ? '全ポート' : r.port}←${src}`;
};

function AppsField({
  apps,
  available,
  onChange,
}: {
  apps: readonly AppId[];
  available: readonly AppId[];
  onChange: (apps: AppId[]) => void;
}) {
  if (available.length < 2) return null;
  return (
    <MultiChoices
      label="動かすアプリ"
      help="同じサーバーで動くアプリは処理能力を分け合います。"
      options={available.map((a) => ({ value: a, label: APP_TEXT_JA[a].name }))}
      values={apps}
      min={1}
      onChange={(v) => onChange(v as AppId[])}
    />
  );
}

function SecurityGroupsField({
  d,
  r,
  values,
  onChange,
}: {
  d: Diagram;
  r: Resource;
  values: readonly string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <MultiChoices
      label="セキュリティグループ"
      help="受け付ける通信を決めます。付いていないと、何も受け付けません。"
      options={sgOptions(d, vpcOfFrame(d, r.frameId)?.id)}
      values={values}
      onChange={onChange}
      empty="この VPC にセキュリティグループがありません。VPC を開いて追加してください。"
    />
  );
}

function SubnetsField({
  d,
  r,
  values,
  help,
  onChange,
}: {
  d: Diagram;
  r: Resource;
  values: readonly string[];
  help: string;
  onChange: (v: string[]) => void;
}) {
  return (
    <MultiChoices
      label="使うサブネット"
      help={help}
      options={subnetOptions(d, vpcOfFrame(d, r.frameId)?.id)}
      values={values}
      onChange={onChange}
      empty="この VPC にサブネットがありません。AZ を開いて追加してください。"
    />
  );
}

function RulesField({
  d,
  sg,
  rules,
  onChange,
}: {
  d: Diagram;
  sg: Resource;
  rules: readonly SgRule[];
  onChange: (rules: SgRule[]) => void;
}) {
  const others = sgOptions(d, vpcOfFrame(d, sg.frameId)?.id, sg.id);
  const sourceValue = (r: SgRule) => (r.source.kind === 'sg' ? `sg:${r.source.sgId}` : r.source.kind);
  const parseSource = (v: string): SgRule['source'] =>
    v.startsWith('sg:')
      ? { kind: 'sg', sgId: v.slice(3) }
      : v === 'vpc'
        ? { kind: 'vpc' }
        : { kind: 'anywhere' };
  const update = (i: number, rule: SgRule) => onChange(rules.map((x, j) => (j === i ? rule : x)));
  return (
    <fieldset className="field rules">
      <legend>受信ルール（許可する通信）</legend>
      {rules.length === 0 && <span className="field-help">ルールがないと、何も受け付けません。</span>}
      {rules.map((rule, i) => (
        <div className="rule-row" key={i}>
          <select
            aria-label={`ルール${i + 1}のポート`}
            value={String(rule.port)}
            onChange={(e) =>
              update(i, { ...rule, port: e.target.value === 'all' ? 'all' : Number(e.target.value) })
            }
          >
            {PORT_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {PORT_LABEL[p]}
              </option>
            ))}
          </select>
          <select
            aria-label={`ルール${i + 1}の送信元`}
            value={sourceValue(rule)}
            onChange={(e) => update(i, { ...rule, source: parseSource(e.target.value) })}
          >
            <option value="anywhere">全世界（0.0.0.0/0）</option>
            <option value="vpc">VPC 内</option>
            {others.map((o) => (
              <option key={o.value} value={`sg:${o.value}`}>
                SG: {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-button"
            aria-label={`ルール${i + 1}を削除`}
            onClick={() => onChange(rules.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary-button"
        onClick={() => onChange([...rules, { port: PORTS.http, source: { kind: 'anywhere' } }])}
      >
        ＋ ルールを追加
      </button>
    </fieldset>
  );
}

// ---- Resource forms -----------------------------------------------------------------------------

export function ResourceConfigForm({
  diagram: d,
  resource: r,
  apps,
  onCommit,
  onMove,
}: {
  diagram: Diagram;
  resource: Resource;
  apps: readonly AppId[];
  onCommit: Commit;
  onMove: (subnetId: string) => void;
}) {
  const set = <T extends Resource['type']>(patch: Partial<ResourceConfigMap[T]>) =>
    onCommit({ ...r.config, ...patch });
  switch (r.type) {
    case 'ec2': {
      const c = r.config;
      const vpcId = vpcOfFrame(d, r.frameId)?.id;
      return (
        <>
          <Choices
            label="インスタンスサイズ"
            options={sizeOptions}
            value={c.size}
            onChange={(size) => set<'ec2'>({ size })}
          />
          <AppsField apps={c.apps} available={apps} onChange={(a) => set<'ec2'>({ apps: a })} />
          <Choices
            label="置くサブネット"
            help="1台の EC2 は1つのサブネット（1つのAZ）で動きます。"
            options={subnetOptions(d, vpcId)}
            value={r.frameId ?? ''}
            onChange={onMove}
          />
          <SecurityGroupsField
            d={d}
            r={r}
            values={c.securityGroupIds}
            onChange={(v) => set<'ec2'>({ securityGroupIds: v })}
          />
        </>
      );
    }
    case 'asg': {
      const c = r.config;
      return (
        <>
          <Choices
            label="インスタンスサイズ"
            options={sizeOptions}
            value={c.size}
            onChange={(size) => set<'asg'>({ size })}
          />
          <Stepper
            label="最小台数"
            value={c.min}
            min={1}
            max={c.desired}
            onChange={(min) => set<'asg'>({ min })}
          />
          <Stepper
            label="希望台数（開始時）"
            value={c.desired}
            min={c.min}
            max={c.max}
            onChange={(desired) => set<'asg'>({ desired })}
          />
          <Stepper
            label="最大台数"
            value={c.max}
            min={c.desired}
            max={50}
            onChange={(max) => set<'asg'>({ max })}
          />
          <Stepper
            label="目標 CPU 使用率"
            help="平均の使用率がこれを超えると台数を増やします。低いほど余裕を持って増やします。"
            value={c.targetCpuPct}
            min={10}
            max={90}
            step={5}
            unit="%"
            onChange={(targetCpuPct) => set<'asg'>({ targetCpuPct })}
          />
          <Stepper
            label="ウォームアップ"
            help="新しいサーバーが処理を始めるまでの時間です（最低 60 秒）。"
            value={c.warmupSec}
            min={0}
            max={900}
            step={30}
            unit="秒"
            onChange={(warmupSec) => set<'asg'>({ warmupSec })}
          />
          <AppsField apps={c.apps} available={apps} onChange={(a) => set<'asg'>({ apps: a })} />
          <SubnetsField
            d={d}
            r={r}
            values={c.subnetIds}
            help="サーバーはここに選んだサブネット（AZ）に分散して起動します。"
            onChange={(v) => set<'asg'>({ subnetIds: v })}
          />
          <SecurityGroupsField
            d={d}
            r={r}
            values={c.securityGroupIds}
            onChange={(v) => set<'asg'>({ securityGroupIds: v })}
          />
        </>
      );
    }
    case 'alb': {
      const c = r.config;
      return (
        <>
          <Choices
            label="種類"
            options={[
              { value: 'internet-facing', label: 'インターネット向け' },
              { value: 'internal', label: '内部向け' },
            ]}
            value={c.scheme}
            onChange={(scheme) => set<'alb'>({ scheme })}
          />
          <Choices
            label="リスナー"
            options={[
              { value: 'http', label: 'HTTP (80)' },
              { value: 'https', label: 'HTTPS (443)' },
            ]}
            value={c.listener}
            onChange={(listener) => set<'alb'>({ listener })}
          />
          <Stepper
            label="ヘルスチェック間隔"
            value={c.healthCheck.intervalSec}
            min={5}
            max={300}
            step={5}
            unit="秒"
            onChange={(intervalSec) => set<'alb'>({ healthCheck: { ...c.healthCheck, intervalSec } })}
          />
          <Stepper
            label="異常と判断する回数"
            help={`故障したサーバーを切り離すまで約 ${c.healthCheck.intervalSec * c.healthCheck.unhealthyThreshold} 秒です。`}
            value={c.healthCheck.unhealthyThreshold}
            min={2}
            max={10}
            onChange={(unhealthyThreshold) =>
              set<'alb'>({ healthCheck: { ...c.healthCheck, unhealthyThreshold } })
            }
          />
          <SubnetsField
            d={d}
            r={r}
            values={c.subnetIds}
            help="2つ以上のAZのサブネットが必要です。インターネット向けはパブリックサブネットを選びます。"
            onChange={(v) => set<'alb'>({ subnetIds: v })}
          />
          <SecurityGroupsField
            d={d}
            r={r}
            values={c.securityGroupIds}
            onChange={(v) => set<'alb'>({ securityGroupIds: v })}
          />
        </>
      );
    }
    case 'rds': {
      const c = r.config;
      return (
        <>
          <Choices
            label="インスタンスクラス"
            options={DB_CLASSES.map((k) => ({
              value: k,
              label: k,
              detail: `${BALANCE.database[k].capacityQps} qps・接続 ${BALANCE.database[k].maxConnections}・${BALANCE.database[k].costPerHour} cr/時`,
            }))}
            value={c.instanceClass}
            onChange={(instanceClass) => set<'rds'>({ instanceClass })}
          />
          <Choices
            label="ストレージ"
            options={[
              { value: 'standard', label: '標準' },
              { value: 'provisioned', label: '高性能', detail: '処理能力・費用 ×1.5' },
            ]}
            value={c.storageTier}
            onChange={(storageTier) => set<'rds'>({ storageTier })}
          />
          <Choices
            label="置くサブネット（プライマリ）"
            help="データベース本体が動くサブネットです。通常はプライベートサブネットに置きます。"
            options={subnetOptions(d, vpcOfFrame(d, r.frameId)?.id)}
            value={r.frameId ?? ''}
            onChange={onMove}
          />
          <Toggle
            label="Multi-AZ（別のAZにスタンバイ）"
            help="別のAZにスタンバイを置き、障害時は短時間で切り替わります。費用は2倍です。"
            value={c.multiAz}
            onChange={(multiAz) =>
              set<'rds'>({
                multiAz,
                standbySubnetId: multiAz
                  ? (c.standbySubnetId ?? suggestStandby(d, r.frameId))
                  : c.standbySubnetId,
              })
            }
          />
          {c.multiAz && (
            <Choices
              label="スタンバイを置くサブネット"
              help="プライマリと別のAZのサブネットを選びます。"
              options={subnetOptions(d, vpcOfFrame(d, r.frameId)?.id).map((o) => ({
                ...o,
                disabled: zoneOfSubnet(d, o.value) === (r.frameId ? zoneOfSubnet(d, r.frameId) : undefined),
              }))}
              value={c.standbySubnetId ?? ''}
              onChange={(standbySubnetId) => set<'rds'>({ standbySubnetId })}
            />
          )}
          <SecurityGroupsField
            d={d}
            r={r}
            values={c.securityGroupIds}
            onChange={(v) => set<'rds'>({ securityGroupIds: v })}
          />
        </>
      );
    }
    case 'sg':
      return (
        <RulesField d={d} sg={r} rules={r.config.inbound} onChange={(inbound) => set<'sg'>({ inbound })} />
      );
    case 'cloudwatch':
      return (
        <Stepper
          label="アラームの数"
          help="監視とアラームを提供します。スケーリングには不要です（アラーム1つ 0.1 cr/時）。"
          value={r.config.alarms.length}
          min={0}
          max={20}
          onChange={(n) =>
            set<'cloudwatch'>({
              alarms: Array.from(
                { length: n },
                (_, i) => r.config.alarms[i] ?? { metric: 'errorRate', threshold: 0.05 },
              ),
            })
          }
        />
      );
    case 'users':
      return <p className="muted">シナリオのアクセスはここから来ます。</p>;
    case 'igw':
      return (
        <p className="muted">
          VPC とインターネットの出入り口です。ユーザーからのアクセスはここを通って VPC
          に入ります（このゲームではルートテーブルは省略しています）。
        </p>
      );
  }
}

// ---- Frame forms ------------------------------------------------------------------------------------

export function FrameConfigForm({
  diagram: d,
  frame: f,
  onCommit,
}: {
  diagram: Diagram;
  frame: Frame;
  onCommit: Commit;
}) {
  switch (f.kind) {
    case 'subnet':
      return (
        <Choices
          label="種類"
          help="パブリックサブネットはインターネットから到達できます（このゲームではインターネットゲートウェイ等を省略しています）。"
          options={[
            { value: 'public', label: TIER_LABEL.public },
            { value: 'private', label: TIER_LABEL.private },
          ]}
          value={f.config.tier}
          onChange={(tier) => onCommit({ ...f.config, tier })}
        />
      );
    case 'az': {
      const used = new Set(
        (f.parentId ? childFrames(d, f.parentId) : [])
          .filter((x): x is Frame & { kind: 'az' } => x.kind === 'az' && x.id !== f.id)
          .map((x) => x.config.zone),
      );
      return (
        <Choices
          label="ゾーン"
          options={ZONES.map((z) => ({ value: z, label: zoneLabel(z), disabled: used.has(z) }))}
          value={f.config.zone}
          onChange={(zone) => onCommit({ zone })}
        />
      );
    }
    case 'vpc':
      return <p className="muted">CIDR: {f.config.cidr}（参考情報。このゲームでは重複を検査しません）</p>;
    case 'region':
      return null;
  }
}

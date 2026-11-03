import { useId, useState } from 'react';
import { FINDING_TEXT_JA, formatFindingText } from '../../../data/i18n/ja/findings';
import type { InfrastructureGraph } from '../../../domain/graph/types';
import { nodesOfType } from '../../../domain/graph/graph';
import type { Finding } from '../../../domain/validation/findings';
import { getIn, setIn, type FieldSpec } from '../config/fieldSpecs';
import type { AppId } from '../../../domain/catalog/apps';
import { APP_TEXT_JA } from '../../../data/i18n/ja/apps';

export interface ConfigFormProps {
  readonly specs: readonly FieldSpec[];
  readonly value: unknown;
  /** Try to apply a full config; returns rejection findings (empty when applied). */
  readonly onCommit: (next: unknown) => readonly Finding[];
  readonly graph: InfrastructureGraph;
  readonly disabled?: boolean;
  /** Applications the mission uses; the app field is hidden when there is only one. */
  readonly availableApps?: readonly AppId[];
}

const REASON_JA: Record<string, string> = {
  capacity_order: '最小 ≤ 開始時 ≤ 最大 になるようにしてください。',
  invalid_cidr: 'CIDR の形式（例: 10.0.0.0/16）で入力してください。',
};

const describe = (f: Finding): string => {
  const reason = typeof f.params?.reason === 'string' ? REASON_JA[f.params.reason] : undefined;
  return reason ?? formatFindingText(FINDING_TEXT_JA[f.code].message, f.params);
};

/**
 * Edits a config through a local draft. Valid drafts are committed immediately (one undo step each);
 * invalid drafts stay visible with an explanation instead of being silently reverted.
 */
export function ConfigForm({ specs, value, onCommit, graph, disabled, availableApps = [] }: ConfigFormProps) {
  const [draft, setDraft] = useState<unknown>(undefined);
  const [errors, setErrors] = useState<readonly Finding[]>([]);
  const current = draft ?? value;

  const change = (path: readonly string[], v: unknown) => {
    const next = setIn(current, path, v);
    const rejected = onCommit(next);
    if (rejected.length === 0) {
      setDraft(undefined);
      setErrors([]);
    } else {
      setDraft(next);
      setErrors(rejected);
    }
  };

  if (specs.length === 0) return <p className="muted">設定項目はありません。</p>;

  return (
    <div className="config-form">
      {specs
        .filter((spec) => spec.kind !== 'apps' || availableApps.length > 1)
        .map((spec) => (
          <Field
            availableApps={availableApps}
            key={spec.path.join('.')}
            spec={spec}
            value={getIn(current, spec.path)}
            onChange={(v) => change(spec.path, v)}
            graph={graph}
            disabled={disabled}
          />
        ))}
      {errors.length > 0 && (
        <p className="field-error" role="alert">
          {errors.map(describe).join(' ')}（この変更はまだ反映されていません）
        </p>
      )}
    </div>
  );
}

interface FieldProps {
  readonly spec: FieldSpec;
  readonly value: unknown;
  readonly onChange: (v: unknown) => void;
  readonly graph: InfrastructureGraph;
  readonly disabled?: boolean | undefined;
  readonly availableApps: readonly AppId[];
}

function Field({ spec, value, onChange, graph, disabled, availableApps }: FieldProps) {
  const id = useId();
  const help = 'help' in spec && spec.help ? <small className="field-help">{spec.help}</small> : null;
  switch (spec.kind) {
    case 'select':
      return (
        <div className="field">
          <label htmlFor={id}>{spec.label}</label>
          <select
            id={id}
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          >
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {help}
        </div>
      );
    case 'int': {
      const n = typeof value === 'number' ? value : spec.min;
      return (
        <div className="field">
          <label htmlFor={id}>{spec.label}</label>
          <div className="stepper">
            <button
              type="button"
              aria-label={`${spec.label}を減らす`}
              disabled={disabled || n <= spec.min}
              onClick={() => onChange(Math.max(spec.min, n - spec.step))}
            >
              −
            </button>
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={n}
              disabled={disabled}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onChange(Math.round(v));
              }}
            />
            <button
              type="button"
              aria-label={`${spec.label}を増やす`}
              disabled={disabled || n >= spec.max}
              onClick={() => onChange(Math.min(spec.max, n + spec.step))}
            >
              ＋
            </button>
            {spec.unit && <span className="unit">{spec.unit}</span>}
          </div>
          {help}
        </div>
      );
    }
    case 'boolean':
      return (
        <div className="field field-inline">
          <label htmlFor={id}>{spec.label}</label>
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          {help}
        </div>
      );
    case 'text':
      return (
        <TextField
          id={id}
          spec={spec}
          value={String(value ?? '')}
          onChange={onChange}
          disabled={disabled}
          help={help}
        />
      );
    case 'sgRules':
      return <SgRulesField spec={spec} value={value} onChange={onChange} graph={graph} disabled={disabled} />;
    case 'alarms':
      return <AlarmsField spec={spec} value={value} onChange={onChange} disabled={disabled} />;
    case 'apps': {
      const selected = (Array.isArray(value) ? value : []) as AppId[];
      return (
        <fieldset className="field rules" disabled={disabled}>
          <legend>{spec.label}</legend>
          {availableApps.map((app) => {
            const checked = selected.includes(app);
            const last = checked && selected.length === 1;
            return (
              <label key={app} className="check-row">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={last}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? availableApps.filter((a) => a === app || selected.includes(a))
                        : selected.filter((a) => a !== app),
                    )
                  }
                />
                {APP_TEXT_JA[app].name}
              </label>
            );
          })}
          {help}
        </fieldset>
      );
    }
  }
}

function TextField({
  id,
  spec,
  value,
  onChange,
  disabled,
  help,
}: {
  id: string;
  spec: FieldSpec;
  value: string;
  onChange: (v: unknown) => void;
  disabled?: boolean | undefined;
  help: React.ReactNode;
}) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value);
  }
  return (
    <div className="field">
      <label htmlFor={id}>{spec.label}</label>
      <input
        id={id}
        type="text"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onChange(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {help}
    </div>
  );
}

type Rule = {
  port: number | 'all';
  source: { kind: 'anywhere' } | { kind: 'vpc' } | { kind: 'security_group'; nodeId: string };
};

const PORT_PRESETS: readonly { value: string; label: string }[] = [
  { value: '80', label: 'HTTP（80）' },
  { value: '443', label: 'HTTPS（443）' },
  { value: '5432', label: 'データベース（5432）' },
  { value: '22', label: 'SSH（22）' },
  { value: '3389', label: 'リモートデスクトップ（3389）' },
  { value: 'all', label: 'すべてのポート' },
];

function SgRulesField({
  spec,
  value,
  onChange,
  graph,
  disabled,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  graph: InfrastructureGraph;
  disabled?: boolean | undefined;
}) {
  const rules = (Array.isArray(value) ? value : []) as Rule[];
  const sgs = nodesOfType(graph, 'network.security_group');
  const sourceKey = (r: Rule) =>
    r.source.kind === 'security_group' ? `sg:${r.source.nodeId}` : r.source.kind;
  const parseSource = (k: string): Rule['source'] =>
    k.startsWith('sg:')
      ? { kind: 'security_group', nodeId: k.slice(3) }
      : k === 'vpc'
        ? { kind: 'vpc' }
        : { kind: 'anywhere' };
  const update = (i: number, r: Rule) => onChange(rules.map((x, j) => (j === i ? r : x)));
  const portOptions = (r: Rule) =>
    PORT_PRESETS.some((p) => p.value === String(r.port))
      ? PORT_PRESETS
      : [...PORT_PRESETS, { value: String(r.port), label: String(r.port) }];

  return (
    <fieldset className="field rules" disabled={disabled}>
      <legend>{spec.label}</legend>
      {rules.length === 0 && <p className="muted">ルールがありません（すべての受信通信を拒否します）。</p>}
      {rules.map((r, i) => (
        <div key={i} className="rule-row">
          <select
            aria-label={`ルール${i + 1}のポート`}
            value={String(r.port)}
            onChange={(e) =>
              update(i, { ...r, port: e.target.value === 'all' ? 'all' : Number(e.target.value) })
            }
          >
            {portOptions(r).map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            aria-label={`ルール${i + 1}の送信元`}
            value={sourceKey(r)}
            onChange={(e) => update(i, { ...r, source: parseSource(e.target.value) })}
          >
            <option value="anywhere">どこからでも（0.0.0.0/0）</option>
            <option value="vpc">同じVPC内</option>
            {sgs.map((g) => (
              <option key={g.id} value={`sg:${g.id}`}>
                SG: {g.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="text-button danger"
            aria-label={`ルール${i + 1}を削除`}
            onClick={() => onChange(rules.filter((_, j) => j !== i))}
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        onClick={() => onChange([...rules, { port: 80, source: { kind: 'vpc' } }])}
      >
        ＋ ルールを追加
      </button>
    </fieldset>
  );
}

type Alarm = { metric: 'cpu' | 'errorRate' | 'latency' | 'dbConnections'; threshold: number };
const METRIC_LABEL: Record<Alarm['metric'], string> = {
  cpu: 'CPU使用率（%）',
  errorRate: 'エラー率（%）',
  latency: '応答時間（ms）',
  dbConnections: 'DB接続数',
};

function AlarmsField({
  spec,
  value,
  onChange,
  disabled,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean | undefined;
}) {
  const alarms = (Array.isArray(value) ? value : []) as Alarm[];
  const update = (i: number, a: Alarm) => onChange(alarms.map((x, j) => (j === i ? a : x)));
  return (
    <fieldset className="field rules" disabled={disabled}>
      <legend>{spec.label}</legend>
      {alarms.length === 0 && <p className="muted">アラームはありません。</p>}
      {alarms.map((a, i) => (
        <div key={i} className="rule-row">
          <select
            aria-label={`アラーム${i + 1}のメトリクス`}
            value={a.metric}
            onChange={(e) => update(i, { ...a, metric: e.target.value as Alarm['metric'] })}
          >
            {(Object.keys(METRIC_LABEL) as Alarm['metric'][]).map((m) => (
              <option key={m} value={m}>
                {METRIC_LABEL[m]}
              </option>
            ))}
          </select>
          <input
            type="number"
            aria-label={`アラーム${i + 1}のしきい値`}
            min={0}
            value={a.threshold}
            onChange={(e) => update(i, { ...a, threshold: Math.max(0, Number(e.target.value) || 0) })}
          />
          <button
            type="button"
            className="text-button danger"
            aria-label={`アラーム${i + 1}を削除`}
            onClick={() => onChange(alarms.filter((_, j) => j !== i))}
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        onClick={() => onChange([...alarms, { metric: 'cpu', threshold: 80 }])}
      >
        ＋ アラームを追加
      </button>
    </fieldset>
  );
}

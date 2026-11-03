import {
  addableFrameKinds,
  addableResourceTypes,
  getResource,
  linksFrom,
  linksTo,
  outgoingLinkKinds,
  removalImpact,
  type AppId,
  type Diagram,
  type EditPolicy,
  type Finding,
  type Frame,
  type FrameKind,
  type LinkKind,
  type Resource,
  type ResourceType,
} from '../../model';
import { BottomSheet } from '../../shared/ui/BottomSheet';
import {
  FINDING_TEXT_JA,
  FRAME_LABEL,
  RESOURCE_LABEL,
  RESOURCE_LONG_LABEL,
  TIER_LABEL,
  formatFindingText,
  frameTitle,
} from '../../i18n';
import { GROUP_ICONS, RESOURCE_ICONS, type IconSource } from '../diagram/icons';
import { FrameConfigForm, ResourceConfigForm, type Commit } from './ConfigForm';

export const findingMessage = (f: Finding): string =>
  formatFindingText(FINDING_TEXT_JA[f.code].message, f.params);

export function ThemedIcon({ src, size = 28 }: { src: IconSource; size?: number }) {
  return (
    <>
      <img className="icon-light" src={src.light} width={size} height={size} alt="" />
      <img className="icon-dark" src={src.dark} width={size} height={size} alt="" />
    </>
  );
}

const SEVERITY_ICON = { error: '⛔', warning: '⚠', info: 'ℹ' } as const;

function FindingList({
  findings,
  onFocus,
}: {
  findings: readonly Finding[];
  onFocus?: (f: Finding) => void;
}) {
  if (findings.length === 0) return null;
  return (
    <ul className="finding-list">
      {findings.map((f, i) => {
        const text = FINDING_TEXT_JA[f.code];
        const body = (
          <>
            <span>
              {SEVERITY_ICON[f.severity]} {findingMessage(f)}
            </span>
            <small>{formatFindingText(text.remediation, f.params)}</small>
          </>
        );
        return (
          <li key={`${f.code}-${i}`} className={`severity-${f.severity}`}>
            {onFocus && f.targetIds.length > 0 ? (
              <button type="button" onClick={() => onFocus(f)}>
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---- Add -------------------------------------------------------------------------------------

export type AddChoice =
  | { readonly kind: 'frame'; readonly frameKind: FrameKind; readonly tier?: 'public' | 'private' }
  | { readonly kind: 'resource'; readonly type: ResourceType };

const RESOURCE_HELP: Partial<Record<ResourceType, string>> = {
  ec2: '1台の仮想サーバー。このサブネットで動きます。',
  alb: 'リクエストを複数のサーバーに振り分けます。使うサブネットを選びます。',
  asg: '負荷に合わせてサーバー台数を自動で増減します。',
  rds: 'マネージドなデータベース。使うサブネットを選びます。',
  sg: 'どこからの通信を受け付けるかを決めるファイアウォールです。',
  cloudwatch: 'メトリクスの監視とアラーム。',
};

const frameIcon = (kind: FrameKind, tier?: 'public' | 'private'): IconSource =>
  kind === 'vpc'
    ? GROUP_ICONS.vpc
    : kind === 'subnet'
      ? tier === 'public'
        ? GROUP_ICONS.publicSubnet
        : GROUP_ICONS.privateSubnet
      : GROUP_ICONS.region;

export function AddSheet({
  frame,
  policy,
  onAdd,
  onClose,
}: {
  frame: Frame;
  policy: EditPolicy;
  onAdd: (c: AddChoice) => void;
  onClose: () => void;
}) {
  type FrameOption = { choice: AddChoice; title: string; help: string; icon: IconSource };
  const frames: FrameOption[] = addableFrameKinds(frame.kind).flatMap((k): FrameOption[] =>
    k === 'subnet'
      ? (['public', 'private'] as const).map((tier) => ({
          choice: { kind: 'frame' as const, frameKind: k, tier },
          title: TIER_LABEL[tier],
          help:
            tier === 'public'
              ? 'インターネットから到達できるサブネット。ロードバランサー向け。'
              : '外部から直接到達できないサブネット。サーバーやデータベース向け。',
          icon: frameIcon(k, tier),
        }))
      : [
          {
            choice: { kind: 'frame' as const, frameKind: k },
            title: k === 'az' ? 'アベイラビリティーゾーン（AZ）' : FRAME_LABEL[k],
            help:
              k === 'vpc'
                ? '専用の仮想ネットワーク。この中に AZ とサブネットを作ります。'
                : 'データセンターの区画。複数の AZ に分けると障害に強くなります。',
            icon: k === 'az' ? GROUP_ICONS.region : frameIcon(k),
          },
        ],
  );
  const resources = addableResourceTypes(frame.kind).filter(
    (t) => !policy.allowedTypes || policy.allowedTypes.includes(t),
  );
  return (
    <BottomSheet title={`${frameTitle(frame.kind, frame.name)} に追加`} onClose={onClose}>
      {frames.length + resources.length === 0 && (
        <p className="muted">この枠の中には直接置けるものがありません。</p>
      )}
      <ul className="add-list">
        {frames.map((f) => (
          <li key={f.title}>
            <button type="button" className="add-item" onClick={() => onAdd(f.choice)}>
              <ThemedIcon src={f.icon} size={40} />
              <span>
                <strong>{f.title}</strong>
                <small>{f.help}</small>
              </span>
            </button>
          </li>
        ))}
        {resources.map((t) => (
          <li key={t}>
            <button type="button" className="add-item" onClick={() => onAdd({ kind: 'resource', type: t })}>
              <ThemedIcon src={RESOURCE_ICONS[t]} size={40} />
              <span>
                <strong>{RESOURCE_LONG_LABEL[t]}</strong>
                <small>{RESOURCE_HELP[t]}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {frame.kind === 'vpc' && <p className="field-help">EC2 はサブネットを開いて追加します。</p>}
    </BottomSheet>
  );
}

// ---- Resource -----------------------------------------------------------------------------------

const LINK_VERB: Record<LinkKind, { out: string; in: string }> = {
  traffic: { out: 'リクエストを送る先', in: 'リクエストが来る元' },
  data: { out: '使うデータベース', in: 'このデータベースを使うサーバー' },
};

export function ResourceSheet({
  diagram: d,
  resource: r,
  findings,
  apps,
  locked,
  onCommit,
  onMove,
  onRename,
  onConnect,
  onDuplicate,
  onDisconnect,
  onPoolSize,
  onSelect,
  onDelete,
  onClose,
}: {
  diagram: Diagram;
  resource: Resource;
  findings: readonly Finding[];
  apps: readonly AppId[];
  locked: boolean;
  onCommit: Commit;
  onMove: (subnetId: string) => void;
  onRename: (name: string) => void;
  onConnect: (kind: LinkKind) => void;
  onDuplicate?: (() => void) | undefined;
  onDisconnect: (linkId: string) => void;
  onPoolSize: (linkId: string, poolSize: number) => void;
  onSelect: (id: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const system = r.type === 'users';
  const outgoing = linksFrom(d, r.id);
  const incoming = linksTo(d, r.id);
  const kinds = outgoingLinkKinds(d, r.id);
  const linkRow = (linkId: string, otherId: string, kind: LinkKind, poolSize?: number) => {
    const other = getResource(d, otherId);
    return (
      <div className="link-row" key={linkId}>
        <button type="button" className="text-button grow" onClick={() => onSelect(otherId)}>
          {other?.name ?? otherId}
          <small>{other ? RESOURCE_LABEL[other.type] : ''}</small>
        </button>
        {poolSize !== undefined && (
          <span className="stepper" aria-label="コネクションプール">
            <button
              type="button"
              aria-label={`${other?.name ?? ''}へのプールを減らす`}
              disabled={poolSize <= 1}
              onClick={() => onPoolSize(linkId, poolSize - 1)}
            >
              −
            </button>
            <span>プール {poolSize}</span>
            <button
              type="button"
              aria-label={`${other?.name ?? ''}へのプールを増やす`}
              disabled={poolSize >= 100}
              onClick={() => onPoolSize(linkId, poolSize + 1)}
            >
              ＋
            </button>
          </span>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={`${other?.name ?? ''}との接続を外す（${kind === 'traffic' ? 'リクエスト' : 'データ'}）`}
          onClick={() => onDisconnect(linkId)}
        >
          ×
        </button>
      </div>
    );
  };
  return (
    <BottomSheet
      title={
        <span className="sheet-heading">
          <ThemedIcon src={RESOURCE_ICONS[r.type]} />
          {r.name}
        </span>
      }
      subtitle={RESOURCE_LONG_LABEL[r.type] + (locked ? '（顧客の要望で削除不可）' : '')}
      onClose={onClose}
    >
      <FindingList findings={findings} />
      {kinds.length > 0 && (
        <div className="action-row">
          {kinds.map((k) => (
            <button key={k} type="button" className="secondary-button" onClick={() => onConnect(k)}>
              {k === 'traffic' ? '→ リクエストの送り先をつなぐ' : '→ データベースにつなぐ'}
            </button>
          ))}
        </div>
      )}
      {(['traffic', 'data'] as const).map((k) => {
        const out = outgoing.filter((l) => l.kind === k);
        const inc = incoming.filter((l) => l.kind === k);
        return (
          <div key={k}>
            {out.length > 0 && (
              <>
                <h3 className="section-title">{LINK_VERB[k].out}</h3>
                {out.map((l) => linkRow(l.id, l.to, k, l.kind === 'data' ? l.config.poolSize : undefined))}
              </>
            )}
            {inc.length > 0 && (
              <>
                <h3 className="section-title">{LINK_VERB[k].in}</h3>
                {inc.map((l) => linkRow(l.id, l.from, k))}
              </>
            )}
          </div>
        );
      })}
      {!system && (
        <>
          <h3 className="section-title">設定</h3>
          <ResourceConfigForm diagram={d} resource={r} apps={apps} onCommit={onCommit} onMove={onMove} />
          <NameField name={r.name} onRename={onRename} />
          <div className="action-row">
            {onDuplicate && (
              <button type="button" className="secondary-button" onClick={onDuplicate}>
                ＋ 同じ設定でもう1台
              </button>
            )}
            <button type="button" className="secondary-button danger" disabled={locked} onClick={onDelete}>
              削除
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

function NameField({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  return (
    <div className="field">
      <label>
        名前
        <input
          type="text"
          defaultValue={name}
          key={name}
          maxLength={40}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== name) onRename(v);
          }}
        />
      </label>
    </div>
  );
}

// ---- Frame ------------------------------------------------------------------------------------------

export function FrameSheet({
  diagram,
  frame,
  findings,
  onCommit,
  onRename,
  onDelete,
  onClose,
}: {
  diagram: Diagram;
  frame: Frame;
  findings: readonly Finding[];
  onCommit: Commit;
  onRename: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      title={`${frameTitle(frame.kind, frame.name)} の設定`}
      subtitle={FRAME_LABEL[frame.kind]}
      onClose={onClose}
    >
      <FindingList findings={findings} />
      <FrameConfigForm diagram={diagram} frame={frame} onCommit={onCommit} />
      {frame.kind !== 'az' && <NameField name={frame.name} onRename={onRename} />}
      <div className="action-row">
        <button type="button" className="secondary-button danger" onClick={onDelete}>
          この枠を削除
        </button>
      </div>
    </BottomSheet>
  );
}

// ---- Connect ----------------------------------------------------------------------------------------

export function ConnectSheet({
  from,
  kind,
  candidates,
  onPick,
  onDone,
}: {
  from: Resource;
  kind: LinkKind;
  candidates: readonly Resource[];
  onPick: (id: string) => void;
  onDone: () => void;
}) {
  return (
    <BottomSheet
      initialSize="compact"
      title={`${from.name} から${kind === 'traffic' ? 'リクエストを送る先' : 'つなぐデータベース'}`}
      subtitle="図の青い枠のもの、または下の一覧から選びます"
      onClose={onDone}
    >
      {candidates.length === 0 ? (
        <p className="muted">つなげる相手がありません。先に追加してください。</p>
      ) : (
        <div className="choice-list">
          {candidates.map((c) => (
            <button key={c.id} type="button" className="choice" onClick={() => onPick(c.id)}>
              {c.name}
              <small>{RESOURCE_LABEL[c.type]}</small>
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}

// ---- Validation and delete -------------------------------------------------------------------------

export function ValidationSheet({
  findings,
  onFocus,
  onClose,
}: {
  findings: readonly Finding[];
  onFocus: (f: Finding) => void;
  onClose: () => void;
}) {
  const errors = findings.filter((f) => f.severity === 'error').length;
  return (
    <BottomSheet
      title="構成チェック"
      subtitle={
        errors > 0 ? `エラー ${errors} 件：直すまでシミュレーションできません` : 'シミュレーションできます'
      }
      onClose={onClose}
    >
      {findings.length === 0 ? (
        <p className="muted">指摘はありません。</p>
      ) : (
        <FindingList findings={findings} onFocus={onFocus} />
      )}
    </BottomSheet>
  );
}

export function DeleteSheet({
  diagram: d,
  id,
  onConfirm,
  onCancel,
}: {
  diagram: Diagram;
  id: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const impact = removalImpact(d, id);
  const name = d.resources[id]?.name ?? d.frames[id]?.name ?? id;
  const inside = [
    ...impact.frames.map((f) => d.frames[f]?.name ?? f),
    ...impact.resources.map((r) => d.resources[r]?.name ?? r),
  ];
  return (
    <BottomSheet
      title={`${name} を削除しますか？`}
      onClose={onCancel}
      footer={
        <div className="confirm-row">
          <button type="button" className="secondary-button" onClick={onCancel}>
            やめる
          </button>
          <button type="button" className="primary-button" onClick={onConfirm}>
            削除する
          </button>
        </div>
      }
    >
      {inside.length > 0 && <p>中にある {inside.join('、')} も削除されます。</p>}
      {impact.links.length > 0 && <p>つながっている接続 {impact.links.length} 本も外れます。</p>}
      <p className="muted">「元に戻す」で取り消せます。</p>
    </BottomSheet>
  );
}

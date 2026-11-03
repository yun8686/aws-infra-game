import { CATEGORY_TEXT_JA, CONNECTION_TEXT_JA } from '../../../data/i18n/ja/editor';
import { FINDING_TEXT_JA, formatFindingText } from '../../../data/i18n/ja/findings';
import { SERVICE_TEXT_JA } from '../../../data/i18n/ja/services';
import { getServiceDefinition } from '../../../domain/catalog/catalog';
import {
  isConnectionTypeId,
  isServiceTypeId,
  SERVICE_TYPES,
  type ConnectionTypeId,
  type ServiceTypeId,
} from '../../../domain/catalog/ids';
import { SERVICE_DEFINITIONS } from '../../../domain/catalog/services';
import type { ServiceCategory } from '../../../domain/catalog/types';
import type { ConnectCandidate } from '../../../domain/graph/candidates';
import type { ConnectInput, EditPolicy, RemoveNodeEffects } from '../../../domain/graph/commands';
import { connectionsOf } from '../../../domain/graph/graph';
import type { ConnectionId, InfrastructureGraph, NodeId } from '../../../domain/graph/types';
import type { Finding } from '../../../domain/validation/findings';
import { BottomSheet } from '../../../shared/ui/BottomSheet';
import { CONNECTION_FIELDS, SERVICE_FIELDS } from '../config/fieldSpecs';
import { ConfigForm } from './ConfigForm';
import type { OverviewLine } from '../summary';

export const findingMessage = (f: Finding): string =>
  formatFindingText(FINDING_TEXT_JA[f.code].message, f.params);

export const nodeLabel = (graph: InfrastructureGraph, id: NodeId): string => {
  const n = graph.nodes[id];
  if (!n) return id;
  const t = isServiceTypeId(n.serviceType) ? SERVICE_TEXT_JA[n.serviceType].short : '?';
  return `${t} ${n.name}`;
};

const connectionLabel = (graph: InfrastructureGraph, id: ConnectionId, from: NodeId): string => {
  const c = graph.connections[id];
  if (!c) return id;
  const type = isConnectionTypeId(c.connectionType)
    ? CONNECTION_TEXT_JA[c.connectionType].label
    : c.connectionType;
  const outgoing = c.sourceNodeId === from;
  return `${type}：${outgoing ? '→' : '←'} ${nodeLabel(graph, outgoing ? c.targetNodeId : c.sourceNodeId)}`;
};

// ---- Node -------------------------------------------------------------------

export function NodeSheet(props: {
  readonly graph: InfrastructureGraph;
  readonly nodeId: NodeId;
  readonly findings: readonly Finding[];
  readonly overview: readonly OverviewLine[];
  readonly deleteBlockedBy: Finding | undefined;
  readonly configLocked: boolean;
  readonly onClose: () => void;
  readonly onCommitConfig: (config: unknown) => readonly Finding[];
  readonly onRename: (name: string) => void;
  readonly onConnect: () => void;
  readonly onSelectConnection: (id: ConnectionId) => void;
  readonly onDelete: () => void;
}) {
  const { graph, nodeId } = props;
  const node = graph.nodes[nodeId];
  if (!node) return null;
  const type = node.serviceType as ServiceTypeId;
  const text = isServiceTypeId(type) ? SERVICE_TEXT_JA[type] : undefined;
  const conns = connectionsOf(graph, nodeId);

  return (
    <BottomSheet
      title={node.name}
      subtitle={text?.name}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={props.onConnect}>
            接続を追加
          </button>
          <button
            type="button"
            className="secondary-button danger"
            disabled={!!props.deleteBlockedBy}
            title={props.deleteBlockedBy ? findingMessage(props.deleteBlockedBy) : undefined}
            onClick={props.onDelete}
          >
            削除
          </button>
        </>
      }
    >
      {text && <p className="muted sheet-description">{text.description}</p>}
      {props.overview.length > 0 && (
        <dl className="overview-list" aria-label="現在の設定の概要">
          {props.overview.map((l) => (
            <div key={l.label}>
              <dt>{l.label}</dt>
              <dd>{l.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {props.deleteBlockedBy && <p className="notice small">{findingMessage(props.deleteBlockedBy)}</p>}
      {props.findings.length > 0 && (
        <ul className="finding-list">
          {props.findings.map((f, i) => (
            <li key={i} className={`severity-${f.severity}`}>
              <strong>{findingMessage(f)}</strong>
              <span>{FINDING_TEXT_JA[f.code].remediation}</span>
            </li>
          ))}
        </ul>
      )}
      <NameField key={`name-${nodeId}`} value={node.name} onRename={props.onRename} />
      {isServiceTypeId(type) && (
        <ConfigForm
          key={`cfg-${nodeId}`}
          specs={SERVICE_FIELDS[type]}
          value={node.config}
          graph={graph}
          disabled={props.configLocked}
          onCommit={props.onCommitConfig}
        />
      )}
      <h3>接続（{conns.length}）</h3>
      {conns.length === 0 ? (
        <p className="muted">接続はありません。</p>
      ) : (
        <ul className="link-list">
          {conns.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => props.onSelectConnection(c.id)}>
                {connectionLabel(graph, c.id, nodeId)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}

function NameField({ value, onRename }: { value: string; onRename: (name: string) => void }) {
  return (
    <div className="field">
      <label htmlFor="node-name">名前</label>
      <input
        id="node-name"
        type="text"
        defaultValue={value}
        maxLength={40}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== value) onRename(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

// ---- Connection ---------------------------------------------------------------

export function ConnectionSheet(props: {
  readonly graph: InfrastructureGraph;
  readonly connectionId: ConnectionId;
  readonly onClose: () => void;
  readonly onCommitConfig: (config: unknown) => readonly Finding[];
  readonly onDelete: () => void;
  readonly onSelectNode: (id: NodeId) => void;
}) {
  const c = props.graph.connections[props.connectionId];
  if (!c) return null;
  const type = c.connectionType as ConnectionTypeId;
  return (
    <BottomSheet
      title={isConnectionTypeId(type) ? CONNECTION_TEXT_JA[type].label : type}
      subtitle="接続"
      onClose={props.onClose}
      footer={
        <button type="button" className="secondary-button danger" onClick={props.onDelete}>
          接続を削除
        </button>
      }
    >
      <ul className="link-list">
        <li>
          <button type="button" onClick={() => props.onSelectNode(c.sourceNodeId)}>
            接続元：{nodeLabel(props.graph, c.sourceNodeId)}
          </button>
        </li>
        <li>
          <button type="button" onClick={() => props.onSelectNode(c.targetNodeId)}>
            接続先：{nodeLabel(props.graph, c.targetNodeId)}
          </button>
        </li>
      </ul>
      {isConnectionTypeId(type) && (
        <ConfigForm
          key={c.id}
          specs={CONNECTION_FIELDS[type]}
          value={c.config}
          graph={props.graph}
          onCommit={props.onCommitConfig}
        />
      )}
    </BottomSheet>
  );
}

// ---- Connect mode -------------------------------------------------------------

export function ConnectSheet(props: {
  readonly graph: InfrastructureGraph;
  readonly nodeId: NodeId;
  readonly placement: boolean;
  readonly candidates: readonly ConnectCandidate[];
  readonly message: string | undefined;
  readonly onPick: (candidate: ConnectCandidate) => void;
  readonly onDone: () => void;
}) {
  const valid = props.candidates.filter((c) => c.options.length > 0);
  const invalid = props.candidates.filter((c) => c.options.length === 0);
  return (
    <BottomSheet
      title={props.placement ? '配置先を選択' : '接続先を選択'}
      subtitle={`${nodeLabel(props.graph, props.nodeId)} から。図のノードをタップするか、下の一覧から選んでください。`}
      onClose={props.onDone}
      footer={
        <button type="button" className="primary-button" onClick={props.onDone}>
          完了
        </button>
      }
    >
      {props.message && (
        <p className="notice small" role="alert">
          {props.message}
        </p>
      )}
      <h3>接続できる候補</h3>
      {valid.length === 0 ? (
        <p className="muted">接続できる候補がありません。</p>
      ) : (
        <ul className="link-list">
          {valid.map((c) => (
            <li key={c.nodeId}>
              <button type="button" className="candidate" onClick={() => props.onPick(c)}>
                {nodeLabel(props.graph, c.nodeId)}
                <small>{c.options.map((o) => CONNECTION_TEXT_JA[o.connectionType].label).join(' / ')}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {invalid.length > 0 && (
        <details>
          <summary>接続できないもの（{invalid.length}）</summary>
          <ul className="link-list">
            {invalid.map((c) => (
              <li key={c.nodeId}>
                <button type="button" onClick={() => props.onPick(c)}>
                  {nodeLabel(props.graph, c.nodeId)}
                  <small>{c.reasons[0] ? findingMessage(c.reasons[0]) : ''}</small>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </BottomSheet>
  );
}

export function ChooseTypeSheet(props: {
  readonly graph: InfrastructureGraph;
  readonly options: readonly ConnectInput[];
  readonly onChoose: (o: ConnectInput) => void;
  readonly onClose: () => void;
}) {
  return (
    <BottomSheet title="接続の種類を選択" onClose={props.onClose}>
      <ul className="link-list">
        {props.options.map((o) => (
          <li key={o.connectionType + o.sourceNodeId}>
            <button type="button" onClick={() => props.onChoose(o)}>
              {CONNECTION_TEXT_JA[o.connectionType].label}
              <small>
                {nodeLabel(props.graph, o.sourceNodeId)} → {nodeLabel(props.graph, o.targetNodeId)}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}

// ---- Add service --------------------------------------------------------------

export function ServiceTraySheet(props: {
  readonly policy: EditPolicy;
  readonly onAdd: (type: ServiceTypeId) => void;
  readonly onClose: () => void;
}) {
  const addable = SERVICE_TYPES.filter(
    (t) =>
      !SERVICE_DEFINITIONS[t].systemManaged &&
      (!props.policy.allowedServiceTypes || props.policy.allowedServiceTypes.includes(t)),
  );
  const categories = [...new Set(addable.map((t) => SERVICE_DEFINITIONS[t].category))] as ServiceCategory[];
  return (
    <BottomSheet title="サービスを追加" onClose={props.onClose} initialSize="full">
      {categories.map((cat) => (
        <section key={cat}>
          <h3>{CATEGORY_TEXT_JA[cat]}</h3>
          <ul className="link-list">
            {addable
              .filter((t) => SERVICE_DEFINITIONS[t].category === cat)
              .map((t) => (
                <li key={t}>
                  <button type="button" className="service-item" onClick={() => props.onAdd(t)}>
                    <strong>{SERVICE_TEXT_JA[t].name}</strong>
                    <small>{SERVICE_TEXT_JA[t].description}</small>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </BottomSheet>
  );
}

// ---- Validation ---------------------------------------------------------------

export function ValidationSheet(props: {
  readonly graph: InfrastructureGraph;
  readonly findings: readonly Finding[];
  readonly onFocus: (f: Finding) => void;
  readonly onClose: () => void;
}) {
  const groups = (['error', 'warning', 'info'] as const)
    .map((sev) => ({ sev, items: props.findings.filter((f) => f.severity === sev) }))
    .filter((g) => g.items.length > 0);
  const label = { error: 'エラー（シミュレーションできません）', warning: '警告', info: '情報' } as const;
  return (
    <BottomSheet title="構成チェック" onClose={props.onClose}>
      {groups.length === 0 && <p className="muted">問題は見つかりませんでした。</p>}
      {groups.map((g) => (
        <section key={g.sev}>
          <h3>
            {label[g.sev]}（{g.items.length}）
          </h3>
          <ul className="finding-list">
            {g.items.map((f, i) => (
              <li key={i} className={`severity-${f.severity}`}>
                <button type="button" onClick={() => props.onFocus(f)}>
                  <strong>{findingMessage(f)}</strong>
                  {f.nodeIds.length > 0 && (
                    <small>{f.nodeIds.map((id) => nodeLabel(props.graph, id)).join('、')}</small>
                  )}
                  <span>{FINDING_TEXT_JA[f.code].remediation}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </BottomSheet>
  );
}

// ---- Delete confirmation ------------------------------------------------------

export function DeleteConfirmSheet(props: {
  readonly graph: InfrastructureGraph;
  readonly nodeId: NodeId;
  readonly effects: RemoveNodeEffects;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <BottomSheet
      title={`${nodeLabel(props.graph, props.nodeId)} を削除しますか？`}
      onClose={props.onCancel}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={props.onCancel}>
            キャンセル
          </button>
          <button type="button" className="secondary-button danger" onClick={props.onConfirm}>
            削除する
          </button>
        </>
      }
    >
      {props.effects.removedConnectionIds.length > 0 ? (
        <>
          <p>次の接続も一緒に削除されます。</p>
          <ul className="bullet-list">
            {props.effects.removedConnectionIds.map((id) => (
              <li key={id}>{connectionLabel(props.graph, id, props.nodeId)}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>このリソースには接続がありません。</p>
      )}
      {props.effects.modifiedNodeIds.length > 0 && (
        <p>
          このセキュリティグループを参照しているルールも削除されます：
          {props.effects.modifiedNodeIds.map((id) => nodeLabel(props.graph, id)).join('、')}
        </p>
      )}
      <p className="muted">削除後も「元に戻す」で取り消せます。</p>
    </BottomSheet>
  );
}

export const placementTargetsOf = (serviceType: string): readonly string[] =>
  getServiceDefinition(serviceType)?.placement?.targets ?? [];

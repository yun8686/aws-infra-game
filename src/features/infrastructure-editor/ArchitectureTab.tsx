import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../app/AppContext';
import { policyForMission } from '../../app/policy';
import { canRedoProject, canUndoProject } from '../../app/store/projectStore';
import { SERVICE_TEXT_JA } from '../../data/i18n/ja/services';
import type { ConnectionTypeId, ServiceTypeId } from '../../domain/catalog/ids';
import { getServiceDefinition } from '../../domain/catalog/catalog';
import { connectionCandidates, type ConnectCandidate } from '../../domain/graph/candidates';
import {
  addNode,
  connect,
  disconnect,
  removeNode,
  renameNode,
  updateConnectionConfig,
  updateNodeConfig,
  type ConnectInput,
} from '../../domain/graph/commands';
import type { ConnectionId, NodeId } from '../../domain/graph/types';
import { validateGraph } from '../../domain/validation/validateGraph';
import type { Finding } from '../../domain/validation/findings';
import { GraphCanvas, type Highlight } from './components/GraphCanvas';
import {
  ChooseTypeSheet,
  ConnectionSheet,
  ConnectSheet,
  DeleteConfirmSheet,
  findingMessage,
  NodeSheet,
  ServiceTraySheet,
  ValidationSheet,
} from './components/EditorSheets';
import { OutlineView } from './components/OutlineView';
import './editor.css';

type Mode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'node'; readonly nodeId: NodeId }
  | { readonly kind: 'connection'; readonly connectionId: ConnectionId }
  | { readonly kind: 'connect'; readonly nodeId: NodeId; readonly onlyType?: ConnectionTypeId }
  | { readonly kind: 'chooseType'; readonly nodeId: NodeId; readonly options: readonly ConnectInput[] }
  | { readonly kind: 'tray' }
  | { readonly kind: 'validation' }
  | { readonly kind: 'confirmDelete'; readonly nodeId: NodeId };

const ZOOMS = [1, 1.5, 2] as const;

/** Tap-first infrastructure editor (ADR 0002). Every operation works without dragging. */
export function ArchitectureTab({
  projectId,
  focus,
}: {
  readonly projectId: string;
  readonly focus?: string | undefined;
}) {
  const project = useAppStore((s) => s.projects[projectId]);
  const undoable = useAppStore((s) => canUndoProject(s, projectId));
  const redoable = useAppStore((s) => canRedoProject(s, projectId));
  const store = {
    edit: useAppStore((s) => s.edit),
    undo: useAppStore((s) => s.undo),
    redo: useAppStore((s) => s.redo),
  };
  const [mode, setMode] = useState<Mode>(() => (focus ? { kind: 'node', nodeId: focus } : { kind: 'idle' }));
  const [view, setView] = useState<'diagram' | 'outline'>('diagram');
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [message, setMessage] = useState<string | undefined>();
  const [toast, setToast] = useState<{ text: string; undo: boolean } | undefined>();

  const graph = project?.graph;
  const policy = useMemo(() => policyForMission(project?.missionId ?? ''), [project?.missionId]);
  const report = useMemo(() => (graph ? validateGraph(graph) : undefined), [graph]);

  const issues = useMemo(() => {
    const out: Record<NodeId, 'error' | 'warning'> = {};
    for (const f of report?.findings ?? []) {
      for (const id of f.nodeIds) {
        if (f.severity === 'error') out[id] = 'error';
        else if (f.severity === 'warning' && out[id] !== 'error') out[id] = 'warning';
      }
    }
    return out;
  }, [report]);

  const connectState = mode.kind === 'connect' ? mode : undefined;
  const candidates = useMemo(
    () =>
      graph && connectState
        ? connectionCandidates(graph, connectState.nodeId, policy, connectState.onlyType)
        : [],
    [graph, connectState, policy],
  );
  const highlight = useMemo(() => {
    if (!connectState) return undefined;
    const h: Record<NodeId, Highlight> = { [connectState.nodeId]: 'valid' };
    for (const c of candidates) h[c.nodeId] = c.options.length > 0 ? 'valid' : 'invalid';
    return h;
  }, [candidates, connectState]);

  const focusId = mode.kind === 'node' ? mode.nodeId : undefined;
  useEffect(() => {
    // Keep the selected resource visible above the bottom sheet.
    if (!focusId) return;
    const el = document.querySelector(`[data-node-id="${CSS.escape(focusId)}"]`);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focusId]);

  if (!project || !graph || !report) return null;

  const locked = new Set(Object.keys(policy.lockedNodes ?? {}));
  const errorCount = report.findings.filter((f) => f.severity === 'error').length;
  const warningCount = report.findings.filter((f) => f.severity === 'warning').length;
  const selectedNodeId =
    mode.kind === 'node' || mode.kind === 'connect' || mode.kind === 'confirmDelete'
      ? mode.nodeId
      : undefined;

  const showToast = (text: string, undo = false) => {
    setToast({ text, undo });
    window.setTimeout(() => setToast((t) => (t?.text === text ? undefined : t)), 5000);
  };

  const doConnect = (option: ConnectInput, stayInMode: boolean) => {
    const r = store.edit(projectId, (g, p) => connect(g, option, p));
    if (r && !r.ok) {
      setMessage(r.error.map(findingMessage).join(' '));
      return;
    }
    setMessage(undefined);
    showToast('接続しました', true);
    if (!stayInMode && mode.kind === 'connect') setMode({ kind: 'node', nodeId: mode.nodeId });
  };

  const pickCandidate = (c: ConnectCandidate) => {
    if (mode.kind !== 'connect') return;
    if (c.options.length === 0) {
      setMessage(c.reasons[0] ? findingMessage(c.reasons[0]) : 'この組み合わせは接続できません');
      return;
    }
    if (c.options.length === 1) doConnect(c.options[0] as ConnectInput, mode.onlyType === 'placed_in');
    else setMode({ kind: 'chooseType', nodeId: mode.nodeId, options: c.options });
  };

  const onCanvasSelect = (id: NodeId | undefined) => {
    if (mode.kind === 'connect') {
      if (!id || id === mode.nodeId) return;
      const c = candidates.find((x) => x.nodeId === id);
      if (c) pickCandidate(c);
      return;
    }
    setMessage(undefined);
    setMode(id ? { kind: 'node', nodeId: id } : { kind: 'idle' });
  };

  const onAdd = (type: ServiceTypeId) => {
    const r = store.edit(projectId, (g, p) => addNode(g, { serviceType: type }, p));
    if (!r) return;
    if (!r.ok) {
      showToast(r.error.map(findingMessage).join(' '));
      return;
    }
    showToast(`${SERVICE_TEXT_JA[type].name} を追加しました`, true);
    // Placement step right away for services that must be placed.
    if (getServiceDefinition(type)?.placement)
      setMode({ kind: 'connect', nodeId: r.value.nodeId, onlyType: 'placed_in' });
    else setMode({ kind: 'node', nodeId: r.value.nodeId });
  };

  const commitNodeConfig =
    (nodeId: NodeId) =>
    (config: unknown): readonly Finding[] => {
      const r = store.edit(projectId, (g, p) => updateNodeConfig(g, nodeId, config, p));
      return r && !r.ok ? r.error : [];
    };

  const deletePreview = (nodeId: NodeId) => removeNode(graph, nodeId, policy);

  const focusFinding = (f: Finding) => {
    const id = f.nodeIds[0];
    if (id) setMode({ kind: 'node', nodeId: id });
    else if (f.connectionIds[0]) setMode({ kind: 'connection', connectionId: f.connectionIds[0] });
  };

  return (
    <div className="tab-content tab-architecture">
      <div className="toolbar editor-toolbar" role="toolbar" aria-label="構成の編集">
        <button type="button" className="tool-button primary" onClick={() => setMode({ kind: 'tray' })}>
          ＋ 追加
        </button>
        <button
          type="button"
          className={`tool-button ${errorCount > 0 ? 'has-errors' : warningCount > 0 ? 'has-warnings' : 'is-clean'}`}
          onClick={() => setMode({ kind: 'validation' })}
          aria-label={`構成チェック: エラー ${errorCount} 件、警告 ${warningCount} 件`}
        >
          {errorCount > 0 ? `⛔ ${errorCount}` : warningCount > 0 ? `⚠ ${warningCount}` : '✓ OK'}
        </button>
        <button
          type="button"
          className="tool-button"
          aria-pressed={view === 'outline'}
          onClick={() => setView(view === 'diagram' ? 'outline' : 'diagram')}
        >
          {view === 'diagram' ? '≡ 一覧' : '◇ 図'}
        </button>
        <span className="toolbar-spacer" />
        <button
          type="button"
          className="tool-button"
          aria-label="元に戻す"
          disabled={!undoable}
          onClick={() => store.undo(projectId)}
        >
          ↶
        </button>
        <button
          type="button"
          className="tool-button"
          aria-label="やり直す"
          disabled={!redoable}
          onClick={() => store.redo(projectId)}
        >
          ↷
        </button>
      </div>

      {view === 'diagram' ? (
        <>
          <GraphCanvas
            graph={graph}
            selectedId={selectedNodeId}
            selectedConnectionId={mode.kind === 'connection' ? mode.connectionId : undefined}
            onSelect={onCanvasSelect}
            onSelectConnection={(id) =>
              mode.kind !== 'connect' && setMode({ kind: 'connection', connectionId: id })
            }
            highlight={highlight}
            issues={issues}
            locked={locked}
            zoom={zoom}
          />
          <div className="zoom-controls" role="group" aria-label="表示倍率">
            {ZOOMS.map((z) => (
              <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>
                {z === 1 ? '全体' : `×${z}`}
              </button>
            ))}
          </div>
        </>
      ) : (
        <OutlineView graph={graph} selectedId={selectedNodeId} issues={issues} onSelect={onCanvasSelect} />
      )}

      {mode.kind === 'node' && (
        <NodeSheet
          graph={graph}
          nodeId={mode.nodeId}
          findings={report.findings.filter((f) => f.nodeIds.includes(mode.nodeId) && f.severity !== 'info')}
          deleteBlockedBy={(() => {
            const p = deletePreview(mode.nodeId);
            return p.ok ? undefined : p.error[0];
          })()}
          configLocked={policy.lockedNodes?.[mode.nodeId] === 'read-only'}
          onClose={() => setMode({ kind: 'idle' })}
          onCommitConfig={commitNodeConfig(mode.nodeId)}
          onRename={(name) => store.edit(projectId, (g) => renameNode(g, mode.nodeId, name))}
          onConnect={() => setMode({ kind: 'connect', nodeId: mode.nodeId })}
          onSelectConnection={(id) => setMode({ kind: 'connection', connectionId: id })}
          onDelete={() => setMode({ kind: 'confirmDelete', nodeId: mode.nodeId })}
        />
      )}

      {mode.kind === 'connection' && (
        <ConnectionSheet
          graph={graph}
          connectionId={mode.connectionId}
          onClose={() => setMode({ kind: 'idle' })}
          onSelectNode={(id) => setMode({ kind: 'node', nodeId: id })}
          onCommitConfig={(config) => {
            const r = store.edit(projectId, (g, p) =>
              updateConnectionConfig(g, mode.connectionId, config, p),
            );
            return r && !r.ok ? r.error : [];
          }}
          onDelete={() => {
            const r = store.edit(projectId, (g, p) => disconnect(g, mode.connectionId, p));
            if (r && !r.ok) showToast(r.error.map(findingMessage).join(' '));
            else {
              showToast('接続を削除しました', true);
              setMode({ kind: 'idle' });
            }
          }}
        />
      )}

      {mode.kind === 'connect' && (
        <ConnectSheet
          graph={graph}
          nodeId={mode.nodeId}
          placement={mode.onlyType === 'placed_in'}
          candidates={candidates}
          message={message}
          onPick={pickCandidate}
          onDone={() => {
            setMessage(undefined);
            setMode({ kind: 'node', nodeId: mode.nodeId });
          }}
        />
      )}

      {mode.kind === 'chooseType' && (
        <ChooseTypeSheet
          graph={graph}
          options={mode.options}
          onChoose={(o) => {
            const r = store.edit(projectId, (g, p) => connect(g, o, p));
            if (r && !r.ok) showToast(r.error.map(findingMessage).join(' '));
            else showToast('接続しました', true);
            setMode({ kind: 'node', nodeId: mode.nodeId });
          }}
          onClose={() => setMode({ kind: 'connect', nodeId: mode.nodeId })}
        />
      )}

      {mode.kind === 'tray' && (
        <ServiceTraySheet policy={policy} onAdd={onAdd} onClose={() => setMode({ kind: 'idle' })} />
      )}

      {mode.kind === 'validation' && (
        <ValidationSheet
          graph={graph}
          findings={report.findings}
          onFocus={focusFinding}
          onClose={() => setMode({ kind: 'idle' })}
        />
      )}

      {mode.kind === 'confirmDelete' &&
        (() => {
          const preview = deletePreview(mode.nodeId);
          if (!preview.ok) return null;
          return (
            <DeleteConfirmSheet
              graph={graph}
              nodeId={mode.nodeId}
              effects={preview.value}
              onCancel={() => setMode({ kind: 'node', nodeId: mode.nodeId })}
              onConfirm={() => {
                const name = graph.nodes[mode.nodeId]?.name ?? '';
                store.edit(projectId, (g, p) => removeNode(g, mode.nodeId, p));
                setMode({ kind: 'idle' });
                showToast(`${name} を削除しました`, true);
              }}
            />
          );
        })()}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                store.undo(projectId);
                setToast(undefined);
              }}
            >
              元に戻す
            </button>
          )}
        </div>
      )}
    </div>
  );
}

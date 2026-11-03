import { useEffect, useMemo, useState } from 'react';
import { useAppStore, useAppStoreApi } from '../../app/AppContext';
import { policyForMission } from '../../app/policy';
import { canRedoProject, canUndoProject } from '../../app/store/projectStore';
import { missionAppIds } from '../../content';
import { RESOURCE_LABEL, TIER_LABEL, frameTitle } from '../../i18n';
import {
  addFrame,
  addResource,
  connect,
  disconnect,
  duplicateResource,
  framesOfKind,
  getFrame,
  getResource,
  linkCandidates,
  moveResource,
  regionOf,
  resourcesOfType,
  securityGroupIdsOf,
  usersOfSecurityGroup,
  type Diagram,
  remove,
  rename,
  updateConfig,
  validateDiagram,
  type EditResult,
  type Finding,
  type LinkKind,
} from '../../model';
import { GuideCard } from '../../shared/ui/GuideCard';
import { Breadcrumb } from '../diagram/Breadcrumb';
import { DiagramCanvas, type ItemMark } from '../diagram/DiagramCanvas';
import { frameToShow } from '../diagram/layout';
import {
  AddSheet,
  ConnectBanner,
  DeleteSheet,
  FrameSheet,
  ResourceSheet,
  ValidationSheet,
  findingMessage,
  type AddChoice,
} from './sheets';
import './editor.css';

type Mode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'resource'; readonly id: string }
  | { readonly kind: 'frame'; readonly id: string }
  | { readonly kind: 'add' }
  | { readonly kind: 'connect'; readonly from: string; readonly link: LinkKind }
  | { readonly kind: 'validation' }
  | { readonly kind: 'delete'; readonly id: string; readonly back: Mode };

/** Security groups and the resources that use them light up together. */
const relatedMarks = (d: Diagram, id: string): Record<string, ItemMark> | undefined => {
  const r = d.resources[id];
  if (!r) return undefined;
  const ids = r.type === 'sg' ? usersOfSecurityGroup(d, id).map((x) => x.id) : securityGroupIdsOf(r);
  return ids.length > 0 ? Object.fromEntries(ids.map((x) => [x, 'related' as const])) : undefined;
};

/** Each security group shows how many resources it is attached to. */
const securityGroupBadges = (d: Diagram) =>
  Object.fromEntries(
    resourcesOfType(d, 'sg').map((sg) => {
      const n = usersOfSecurityGroup(d, sg.id).length;
      return [
        sg.id,
        { text: n > 0 ? `${n}件に適用` : '未使用', level: n > 0 ? ('ok' as const) : ('warn' as const) },
      ];
    }),
  );

/** The open frame per project survives tab switches (in memory only). */
const openFrames = new Map<string, string>();

/** Tap-first diagram editor: open a frame, add inside it, connect, configure (docs/REBUILD.md §5). */
export function EditorTab({
  projectId,
  focus,
}: {
  readonly projectId: string;
  readonly focus?: string | undefined;
}) {
  const store = useAppStoreApi().getState();
  const project = useAppStore((s) => s.projects[projectId]);
  const canUndo = useAppStore((s) => canUndoProject(s, projectId));
  const canRedo = useAppStore((s) => canRedoProject(s, projectId));
  const d = project?.diagram;
  const policy = useMemo(() => policyForMission(project?.missionId ?? ''), [project?.missionId]);
  const apps = useMemo(() => missionAppIds(project?.missionId ?? ''), [project?.missionId]);
  const findings = useMemo(() => (d ? validateDiagram(d, { requiredApps: apps }) : []), [d, apps]);

  const initialFrame = () => {
    if (!d) return null;
    if (focus && d.resources[focus]) return frameToShow(d, focus);
    const remembered = openFrames.get(projectId);
    if (remembered && d.frames[remembered]) return remembered;
    return framesOfKind(d, 'vpc')[0]?.id ?? regionOf(d)?.id ?? null;
  };
  const [frameId, setFrameIdState] = useState<string | null>(initialFrame);
  const [mode, setMode] = useState<Mode>(
    focus && d?.resources[focus] ? { kind: 'resource', id: focus } : { kind: 'idle' },
  );
  const [toast, setToast] = useState<{ text: string; undo?: boolean } | undefined>();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!d || !project) return null;

  // The open frame may disappear (undo, delete): fall back to the nearest existing ancestor.
  const openId = frameId && d.frames[frameId] ? frameId : (regionOf(d)?.id ?? null);
  const openFrame = getFrame(d, openId);
  const setFrame = (id: string | null) => {
    setFrameIdState(id);
    if (id) openFrames.set(projectId, id);
  };

  const run = (command: Parameters<typeof store.edit>[1], success?: string): EditResult | undefined => {
    const r = store.edit(projectId, command);
    if (r && !r.ok) setToast({ text: findingMessage(r.finding) });
    else if (r && success) setToast({ text: success, undo: true });
    return r;
  };
  const commit = (id: string) => (config: unknown) => {
    const r = run((g) => updateConfig(g, id, config));
    return r && !r.ok ? findingMessage(r.finding) : undefined;
  };

  const issues: Record<string, 'error' | 'warning'> = {};
  for (const f of findings) {
    const target = f.targetIds[0];
    if (!target || f.severity === 'info') continue;
    if (issues[target] !== 'error') issues[target] = f.severity;
  }
  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  const candidates = mode.kind === 'connect' ? linkCandidates(d, mode.link, mode.from) : [];
  const marks: Record<string, ItemMark> | undefined =
    mode.kind === 'connect'
      ? Object.fromEntries(
          Object.keys(d.resources).map((id) => [
            id,
            candidates.some((c) => c.id === id) ? 'candidate' : id === mode.from ? 'candidate' : 'dimmed',
          ]),
        )
      : mode.kind === 'resource'
        ? relatedMarks(d, mode.id)
        : undefined;
  const badges = securityGroupBadges(d);

  const onSelect = (id: string) => {
    if (mode.kind === 'connect') {
      if (id === mode.from) return;
      if (!candidates.some((c) => c.id === id)) {
        setToast({ text: `${d.resources[id]?.name ?? id} にはつなげません` });
        return;
      }
      const from = d.resources[mode.from]?.name ?? '';
      const to = d.resources[id]?.name ?? '';
      run((g) => connect(g, mode.link, mode.from, id), `${from} → ${to} をつなぎました`);
      return;
    }
    setMode({ kind: 'resource', id });
  };

  const onAdd = (c: AddChoice) => {
    if (!openId) return;
    if (c.kind === 'frame') {
      const r = run((g) => addFrame(g, c.frameKind, openId, c.tier ? { config: { tier: c.tier } } : {}));
      if (r?.ok) {
        const f = r.diagram.frames[r.id];
        setToast({
          text: `${f ? frameTitle(f.kind, f.name) : ''} を追加しました。タップで中を開けます`,
          undo: true,
        });
        setMode({ kind: 'idle' });
      }
      return;
    }
    const r = run((g, p) => addResource(g, c.type, openId, {}, p));
    if (r?.ok) {
      setToast({
        text: `${RESOURCE_LABEL[c.type]} を追加しました。設定とつなぎ先を決めましょう`,
        undo: true,
      });
      setMode({ kind: 'resource', id: r.id });
    }
  };

  const focusFinding = (f: Finding) => {
    const target = f.targetIds.find((t) => d.resources[t] || d.frames[t]);
    if (!target) return;
    if (d.resources[target]) {
      setFrame(frameToShow(d, target));
      setMode({ kind: 'resource', id: target });
    } else {
      setFrame(target);
      setMode({ kind: 'frame', id: target });
    }
  };

  const selectedId = mode.kind === 'resource' ? mode.id : mode.kind === 'connect' ? mode.from : undefined;
  const resource = mode.kind === 'resource' ? getResource(d, mode.id) : undefined;
  const sheetFrame = mode.kind === 'frame' ? getFrame(d, mode.id) : undefined;

  return (
    <div className="tab-content tab-editor">
      <GuideCard id="guide-editor" title="構成図の使い方">
        <ul className="bullet-list">
          <li>枠（VPC・AZ・サブネット）をタップすると中に入れます。上のパンくずで外に戻れます。</li>
          <li>「＋ 追加」は、いま開いている枠の中に置けるものを表示します。</li>
          <li>アイコンをタップすると、設定・つなぎ先・削除ができます。</li>
        </ul>
      </GuideCard>

      <div className="editor-bar">
        {mode.kind === 'connect' && d.resources[mode.from] ? (
          <ConnectBanner
            from={d.resources[mode.from]!}
            kind={mode.link}
            candidates={candidates}
            onPick={onSelect}
            onDone={() => setMode({ kind: 'resource', id: mode.from })}
          />
        ) : (
          <div className="editor-toolbar" role="toolbar" aria-label="構成図の操作">
            <button
              type="button"
              className="tool-button"
              disabled={!canUndo}
              onClick={() => store.undo(projectId)}
              aria-label="元に戻す"
            >
              ↶
            </button>
            <button
              type="button"
              className="tool-button"
              disabled={!canRedo}
              onClick={() => store.redo(projectId)}
              aria-label="やり直す"
            >
              ↷
            </button>
            <span className="toolbar-spacer" />
            <button
              type="button"
              className={`tool-button ${errorCount > 0 ? 'has-errors' : warningCount > 0 ? 'has-warnings' : 'is-clean'}`}
              onClick={() => setMode({ kind: 'validation' })}
            >
              {errorCount > 0 ? `⛔ ${errorCount}` : warningCount > 0 ? `⚠ ${warningCount}` : '✓ OK'}
              <span className="visually-hidden">構成チェック</span>
            </button>
            <button type="button" className="tool-button primary" onClick={() => setMode({ kind: 'add' })}>
              ＋ 追加
            </button>
          </div>
        )}
        <div className="editor-crumbs">
          <Breadcrumb diagram={d} frameId={openId} onOpen={setFrame} />
          {openFrame && openFrame.kind !== 'region' && (
            <button
              type="button"
              className="icon-button frame-settings"
              onClick={() => setMode({ kind: 'frame', id: openFrame.id })}
            >
              ⚙
              <span className="visually-hidden">
                {openFrame.kind === 'subnet'
                  ? TIER_LABEL[openFrame.config.tier]
                  : frameTitle(openFrame.kind, openFrame.name)}
                の設定
              </span>
            </button>
          )}
        </div>
      </div>

      <DiagramCanvas
        diagram={d}
        frameId={openId}
        selectedId={selectedId}
        issues={issues}
        marks={marks}
        badges={badges}
        onOpenFrame={(id) => setFrame(id)}
        onSelect={onSelect}
      />

      {mode.kind === 'add' && openFrame && (
        <AddSheet frame={openFrame} policy={policy} onAdd={onAdd} onClose={() => setMode({ kind: 'idle' })} />
      )}

      {resource && (
        <ResourceSheet
          key={resource.id}
          diagram={d}
          resource={resource}
          findings={findings.filter((f) => f.targetIds.includes(resource.id))}
          apps={apps}
          locked={policy.lockedIds?.includes(resource.id) ?? false}
          onCommit={commit(resource.id)}
          onMove={(subnetId) => run((g) => moveResource(g, resource.id, subnetId))}
          onRename={(name) => run((g) => rename(g, resource.id, name))}
          onConnect={(link) => setMode({ kind: 'connect', from: resource.id, link })}
          onDuplicate={
            resource.type === 'ec2'
              ? () => {
                  const r = run((g, p) => duplicateResource(g, resource.id, undefined, p));
                  if (r?.ok) {
                    setToast({
                      text: `${r.diagram.resources[r.id]?.name ?? ''} を同じサブネットに追加しました。置くサブネットは設定で変えられます`,
                      undo: true,
                    });
                    setMode({ kind: 'resource', id: r.id });
                  }
                }
              : undefined
          }
          onDisconnect={(linkId) => run((g) => disconnect(g, linkId), '接続を外しました')}
          onPoolSize={(linkId, poolSize) => run((g) => updateConfig(g, linkId, { poolSize }))}
          onSelect={(id) => {
            setFrame(frameToShow(d, id));
            setMode({ kind: 'resource', id });
          }}
          onDelete={() => setMode({ kind: 'delete', id: resource.id, back: mode })}
          onClose={() => setMode({ kind: 'idle' })}
        />
      )}

      {sheetFrame && (
        <FrameSheet
          key={sheetFrame.id}
          diagram={d}
          frame={sheetFrame}
          findings={findings.filter((f) => f.targetIds.includes(sheetFrame.id))}
          onCommit={commit(sheetFrame.id)}
          onRename={(name) => run((g) => rename(g, sheetFrame.id, name))}
          onDelete={() => setMode({ kind: 'delete', id: sheetFrame.id, back: mode })}
          onClose={() => setMode({ kind: 'idle' })}
        />
      )}

      {mode.kind === 'validation' && (
        <ValidationSheet
          findings={findings}
          onFocus={focusFinding}
          onClose={() => setMode({ kind: 'idle' })}
        />
      )}

      {mode.kind === 'delete' && (
        <DeleteSheet
          diagram={d}
          id={mode.id}
          onCancel={() => setMode(mode.back)}
          onConfirm={() => {
            const name = d.resources[mode.id]?.name ?? d.frames[mode.id]?.name ?? '';
            const parent = d.frames[mode.id]?.parentId;
            const r = run((g, p) => remove(g, mode.id, p), `${name} を削除しました`);
            if (r?.ok) {
              if (mode.id === openId && parent) setFrame(parent);
              setMode({ kind: 'idle' });
            }
          }}
        />
      )}

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

import { useState } from 'react';
import { useAppStore } from '../../app/AppContext';
import { canRedoProject, canUndoProject } from '../../app/store/projectStore';
import { SERVICE_TEXT_JA } from '../../data/i18n/ja/services';
import { isServiceTypeId } from '../../domain/catalog/ids';
import type { NodeId } from '../../domain/graph/types';
import { GraphCanvas } from './components/GraphCanvas';

/** Phase 4: read-only view with undo/redo wiring. Editing arrives in Phase 5. */
export function ArchitectureTab({ projectId }: { readonly projectId: string }) {
  const graph = useAppStore((s) => s.projects[projectId]?.graph);
  const undoable = useAppStore((s) => canUndoProject(s, projectId));
  const redoable = useAppStore((s) => canRedoProject(s, projectId));
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const [selected, setSelected] = useState<NodeId | undefined>();
  if (!graph) return null;
  const node = selected ? graph.nodes[selected] : undefined;
  const text = node && isServiceTypeId(node.serviceType) ? SERVICE_TEXT_JA[node.serviceType] : undefined;

  return (
    <div className="tab-content tab-architecture">
      <div className="toolbar">
        <button type="button" className="text-button" disabled={!undoable} onClick={() => undo(projectId)}>
          元に戻す
        </button>
        <button type="button" className="text-button" disabled={!redoable} onClick={() => redo(projectId)}>
          やり直す
        </button>
      </div>
      <GraphCanvas graph={graph} selectedId={selected} onSelect={setSelected} />
      <aside className="selection-panel" aria-live="polite">
        {node ? (
          <>
            <strong>{node.name}</strong> — {text?.name}
            <small>{text?.description}</small>
          </>
        ) : (
          <small>リソースをタップすると詳細を表示します。</small>
        )}
      </aside>
    </div>
  );
}

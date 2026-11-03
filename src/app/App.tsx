import { useMemo, useState } from 'react';
import { TEMPLATES } from '../data/templates';
import { SERVICE_TEXT_JA } from '../data/i18n/ja/services';
import { isServiceTypeId } from '../domain/catalog/ids';
import type { NodeId } from '../domain/graph/types';
import { GraphCanvas } from '../features/infrastructure-editor/components/GraphCanvas';
import './app.css';

/** Phase 1.5 spike: read-only rendering of the starter template on a phone viewport. */
export function App() {
  const graph = useMemo(() => TEMPLATES['ecommerce-starter'](), []);
  const [selected, setSelected] = useState<NodeId | undefined>();
  const node = selected ? graph.nodes[selected] : undefined;
  const text = node && isServiceTypeId(node.serviceType) ? SERVICE_TEXT_JA[node.serviceType] : undefined;

  return (
    <div className="app">
      <header className="app-header">
        <h1>EC Shop — 現在の構成</h1>
        <p>学習用の簡略モデルです。実際の AWS の性能・料金を示すものではありません。</p>
      </header>
      <main className="canvas-area">
        <GraphCanvas graph={graph} selectedId={selected} onSelect={setSelected} />
      </main>
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

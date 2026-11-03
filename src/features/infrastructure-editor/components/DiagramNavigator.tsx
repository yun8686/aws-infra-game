import { useMemo, useRef, useState } from 'react';
import type { InfrastructureGraph, NodeId } from '../../../domain/graph/types';
import { buildOverviewGroups, groupContaining, overviewEdges, type OverviewGroup } from '../layout/overview';
import { GraphCanvas, type GraphCanvasProps } from './GraphCanvas';
import { OverviewCanvas } from './OverviewCanvas';
import { SubnetCanvas } from './SubnetCanvas';

export interface DiagramNavigatorProps extends Omit<GraphCanvasProps, 'include' | 'hideTraffic'> {
  readonly graph: InfrastructureGraph;
  /** Bring this resource into view (drill into its layer); change the value to trigger again. */
  readonly reveal?: { readonly nodeId: NodeId; readonly seq: number } | undefined;
  /** Show the network view (e.g. while choosing a subnet). */
  readonly preferNetwork?: boolean | undefined;
}

type View = { readonly key: 'overview' } | { readonly key: string };

/**
 * Drill-down diagram (ADR 0017): the overview shows layers with one arrow between them; opening a
 * layer shows its resources per AZ without crossing arrows; the network view shows placement.
 */
export function DiagramNavigator({ reveal, preferNetwork, ...canvas }: DiagramNavigatorProps) {
  const { graph, showApps = false, onSelect } = canvas;
  const groups = useMemo(() => buildOverviewGroups(graph, { showApps }), [graph, showApps]);
  const [view, setViewState] = useState<View>({ key: 'overview' });
  const rootRef = useRef<HTMLDivElement>(null);
  /** Change view and bring the top of the diagram (breadcrumb) into sight. */
  const setView = (next: View) => {
    setViewState(next);
    requestAnimationFrame(() => {
      const el = rootRef.current;
      // Sticky header + toolbar cover about the top 140 px (matches scroll-margin-top in CSS).
      if (!el || el.getBoundingClientRect().top >= 140) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    });
  };

  // React to `reveal` / `preferNetwork` changes during render (no effect needed).
  const [seenReveal, setSeenReveal] = useState(reveal?.seq);
  if (reveal && reveal.seq !== seenReveal) {
    setSeenReveal(reveal.seq);
    const g = groupContaining(groups, reveal.nodeId);
    if (
      g &&
      (g.nodeIds.length > 1 || g.kind === 'network' || g.kind === 'compute' || g.kind === 'unplaced')
    ) {
      setViewState({ key: g.key });
    }
  }
  const [seenPrefer, setSeenPrefer] = useState(preferNetwork);
  if (preferNetwork !== seenPrefer) {
    setSeenPrefer(preferNetwork);
    if (preferNetwork) setViewState({ key: 'network' });
  }

  const current = view.key === 'overview' ? undefined : groups.find((g) => g.key === view.key);
  // A layer can disappear after edits (e.g. its last server moved to another app set).
  const effective = current ?? undefined;

  const open = (g: OverviewGroup) => {
    // Servers always open their layer (their AZ placement matters); other single resources open directly.
    const direct =
      g.nodeIds.length === 1 && g.kind !== 'network' && g.kind !== 'compute' && g.kind !== 'unplaced';
    if (direct) onSelect?.(g.nodeIds[0]);
    else setView({ key: g.key });
  };

  const edges = useMemo(() => overviewEdges(graph, groups), [graph, groups]);
  const titleOf = (key: string) => groups.find((g) => g.key === key)?.title ?? key;
  const include = useMemo(
    () => (effective && effective.kind !== 'network' ? new Set(effective.nodeIds) : undefined),
    [effective],
  );

  return (
    <div className="diagram-navigator" ref={rootRef}>
      <nav className="diagram-crumbs" aria-label="構成図の階層">
        <button
          type="button"
          aria-current={effective ? undefined : 'page'}
          onClick={() => setView({ key: 'overview' })}
        >
          全体
        </button>
        {effective && (
          <>
            <span aria-hidden="true">›</span>
            <button type="button" aria-current="page">
              {effective.title}
            </button>
          </>
        )}
      </nav>
      {!effective ? (
        <OverviewCanvas
          graph={graph}
          showApps={showApps}
          selectedId={canvas.selectedId}
          highlight={canvas.highlight}
          issues={canvas.issues}
          related={canvas.related}
          metrics={canvas.metrics}
          onOpen={open}
        />
      ) : (
        <>
          {effective.kind !== 'network' && effective.kind !== 'subnet' && (
            <div className="diagram-context">
              {edges
                .filter((e) => e.to === effective.key)
                .map((e) => (
                  <span key={`in-${e.from}`}>↑ {titleOf(e.from)} から</span>
                ))}
              {edges
                .filter((e) => e.from === effective.key)
                .map((e) => (
                  <span key={`out-${e.to}`}>↓ {titleOf(e.to)} へ</span>
                ))}
            </div>
          )}
          {effective.kind === 'subnet' ? (
            <SubnetCanvas
              graph={graph}
              subnetIds={effective.nodeIds.slice(0, 1)}
              selectedId={canvas.selectedId}
              onSelect={canvas.onSelect}
              highlight={canvas.highlight}
              issues={canvas.issues}
              related={canvas.related}
              metrics={canvas.metrics}
              showApps={showApps}
            />
          ) : (
            <GraphCanvas {...canvas} include={include} hideTraffic={effective.kind === 'network'} />
          )}
        </>
      )}
    </div>
  );
}

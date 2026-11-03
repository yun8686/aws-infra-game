import { useMemo } from 'react';
import type { ConnectionId, InfrastructureGraph, NodeId } from '../../../domain/graph/types';
import { SERVICE_TEXT_JA } from '../../../data/i18n/ja/services';
import { isServiceTypeId } from '../../../domain/catalog/ids';
import { layoutGraph } from '../layout/tierLayout';
import './graph-canvas.css';

export type Highlight = 'valid' | 'invalid';

export interface GraphCanvasProps {
  readonly graph: InfrastructureGraph;
  readonly selectedId?: NodeId | undefined;
  readonly selectedConnectionId?: ConnectionId | undefined;
  readonly onSelect?: (id: NodeId | undefined) => void;
  readonly onSelectConnection?: (id: ConnectionId) => void;
  /** Connect mode: which nodes are valid targets. */
  readonly highlight?: Readonly<Record<NodeId, Highlight>> | undefined;
  /** Highest validation severity per node. */
  readonly issues?: Readonly<Record<NodeId, 'error' | 'warning'>> | undefined;
  readonly locked?: ReadonlySet<NodeId> | undefined;
  /** 1 = fit width. */
  readonly zoom?: number;
}

const shortLabel = (serviceType: string): string =>
  isServiceTypeId(serviceType) ? SERVICE_TEXT_JA[serviceType].short : '?';

const categoryClass = (serviceType: string): string => serviceType.split('.')[0] ?? 'unknown';

/** Tap-first SVG rendering of an infrastructure graph. Every element is selectable by tap or keyboard. */
export function GraphCanvas({
  graph,
  selectedId,
  selectedConnectionId,
  onSelect,
  onSelectConnection,
  highlight,
  issues,
  locked,
  zoom = 1,
}: GraphCanvasProps) {
  const layout = useMemo(() => layoutGraph(graph), [graph]);

  const select = (id: NodeId) => onSelect?.(id);
  const stateClass = (id: NodeId) =>
    [
      selectedId === id ? 'is-selected' : '',
      highlight?.[id] === 'valid' ? 'is-candidate' : '',
      highlight?.[id] === 'invalid' ? 'is-dimmed' : '',
    ].join(' ');
  const keySelect = (id: NodeId) => (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      select(id);
    }
  };

  return (
    <div className="graph-viewport">
      <svg
        className="graph-canvas"
        style={{ width: `${zoom * 100}%` }}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group"
        aria-label="インフラ構成図"
        onClick={() => onSelect?.(undefined)}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" className="edge-arrow" />
          </marker>
        </defs>

        {layout.zones.map((z) => {
          const target = z.nodeIds[0];
          const name = z.kind === 'subnet' ? `サブネット ${z.label}` : `VPC ${z.label}`;
          return (
            <g
              key={`${z.kind}:${z.key}`}
              className={`zone zone-${z.kind} ${target ? stateClass(target) : ''}`}
              data-node-id={target}
              role="button"
              tabIndex={0}
              aria-label={name}
              onClick={(ev) => {
                ev.stopPropagation();
                if (target) select(target);
              }}
              onKeyDown={target ? keySelect(target) : undefined}
            >
              <rect x={z.x} y={z.y} width={z.width} height={z.height} rx={z.kind === 'vpc' ? 10 : 6} />
              <text x={z.x + 6} y={z.y + 13}>
                {z.kind === 'subnet' ? `${z.key.split(':')[0]} · ${z.label}` : z.label}
              </text>
            </g>
          );
        })}

        {layout.edges.map((e) => (
          <g
            key={e.id}
            className={`edge-group ${selectedConnectionId === e.id ? 'is-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`接続 ${graph.nodes[graph.connections[e.id]?.sourceNodeId ?? '']?.name ?? ''} → ${graph.nodes[graph.connections[e.id]?.targetNodeId ?? '']?.name ?? ''}`}
            onClick={(ev) => {
              ev.stopPropagation();
              onSelectConnection?.(e.id);
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') onSelectConnection?.(e.id);
            }}
          >
            <line className="edge-hit" x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y} />
            <line
              className={`edge edge-${e.kind}`}
              x1={e.from.x}
              y1={e.from.y}
              x2={e.to.x}
              y2={e.to.y}
              markerEnd="url(#arrow)"
            />
          </g>
        ))}

        {layout.nodes.map((n) => {
          const node = graph.nodes[n.id];
          if (!node) return null;
          const issue = issues?.[n.id];
          return (
            <g
              key={n.id}
              className={`node node-${categoryClass(node.serviceType)} ${stateClass(n.id)}`}
              data-node-id={n.id}
              role="button"
              tabIndex={0}
              aria-pressed={selectedId === n.id}
              aria-label={`${shortLabel(node.serviceType)} ${node.name}`}
              onClick={(ev) => {
                ev.stopPropagation();
                select(n.id);
              }}
              onKeyDown={keySelect(n.id)}
            >
              <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={8} />
              <text className="node-type" x={n.x + 8} y={n.y + 18}>
                {shortLabel(node.serviceType)}
                {locked?.has(n.id) ? ' 🔒' : ''}
              </text>
              <text className="node-name" x={n.x + 8} y={n.y + 36}>
                {node.name}
              </text>
              {n.securityGroupIds.length > 0 && (
                <text className="node-sg" x={n.x + n.width - 8} y={n.y + 18} textAnchor="end">
                  🛡{n.securityGroupIds.length}
                </text>
              )}
              {issue && (
                <circle
                  className={`issue-dot issue-${issue}`}
                  cx={n.x + n.width - 8}
                  cy={n.y + n.height - 10}
                  r={5}
                >
                  <title>{issue === 'error' ? 'エラーあり' : '警告あり'}</title>
                </circle>
              )}
            </g>
          );
        })}

        {layout.chips.map((c) => {
          const node = graph.nodes[c.id];
          if (!node) return null;
          const issue = issues?.[c.id];
          return (
            <g
              key={c.id}
              className={`chip ${stateClass(c.id)}`}
              data-node-id={c.id}
              role="button"
              tabIndex={0}
              aria-pressed={selectedId === c.id}
              aria-label={`${shortLabel(node.serviceType)} ${node.name}`}
              onClick={(ev) => {
                ev.stopPropagation();
                select(c.id);
              }}
              onKeyDown={keySelect(c.id)}
            >
              <rect x={c.x} y={c.y} width={c.width} height={c.height} rx={c.height / 2} />
              <text x={c.x + c.width / 2} y={c.y + c.height / 2 + 4} textAnchor="middle">
                {shortLabel(node.serviceType)} {node.name}
              </text>
              {issue && (
                <circle className={`issue-dot issue-${issue}`} cx={c.x + c.width - 10} cy={c.y + 8} r={4} />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

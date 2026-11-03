import { useMemo } from 'react';
import type { InfrastructureGraph, NodeId } from '../../../domain/graph/types';
import { SERVICE_TEXT_JA } from '../../../data/i18n/ja/services';
import { isServiceTypeId } from '../../../domain/catalog/ids';
import { layoutGraph } from '../layout/tierLayout';
import './graph-canvas.css';

export interface GraphCanvasProps {
  readonly graph: InfrastructureGraph;
  readonly selectedId?: NodeId | undefined;
  readonly onSelect?: (id: NodeId | undefined) => void;
}

const shortLabel = (serviceType: string): string =>
  isServiceTypeId(serviceType) ? SERVICE_TEXT_JA[serviceType].short : '?';

const categoryClass = (serviceType: string): string => serviceType.split('.')[0] ?? 'unknown';

/** Read-only, tap-to-select SVG rendering of an infrastructure graph. */
export function GraphCanvas({ graph, selectedId, onSelect }: GraphCanvasProps) {
  const layout = useMemo(() => layoutGraph(graph), [graph]);

  const select = (id: NodeId) => onSelect?.(selectedId === id ? undefined : id);

  return (
    <svg
      className="graph-canvas"
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

      {layout.zones.map((z) => (
        <g key={`${z.kind}:${z.key}`} className={`zone zone-${z.kind}`}>
          <rect x={z.x} y={z.y} width={z.width} height={z.height} rx={z.kind === 'vpc' ? 10 : 6} />
          <text x={z.x + 6} y={z.y + 13}>
            {z.kind === 'subnet' ? `${z.key.split(':')[0]} · ${z.label}` : z.label}
          </text>
        </g>
      ))}

      {layout.edges.map((e) => (
        <line
          key={e.id}
          className={`edge edge-${e.kind}`}
          x1={e.from.x}
          y1={e.from.y}
          x2={e.to.x}
          y2={e.to.y}
          markerEnd="url(#arrow)"
        />
      ))}

      {layout.nodes.map((n) => {
        const node = graph.nodes[n.id];
        if (!node) return null;
        const selected = selectedId === n.id;
        return (
          <g
            key={n.id}
            className={`node node-${categoryClass(node.serviceType)}${selected ? ' is-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${shortLabel(node.serviceType)} ${node.name}`}
            onClick={(ev) => {
              ev.stopPropagation();
              select(n.id);
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') select(n.id);
            }}
          >
            <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={8} />
            <text className="node-type" x={n.x + 8} y={n.y + 18}>
              {shortLabel(node.serviceType)}
            </text>
            <text className="node-name" x={n.x + 8} y={n.y + 36}>
              {node.name}
            </text>
            {n.securityGroupIds.length > 0 && (
              <text className="node-sg" x={n.x + n.width - 8} y={n.y + 18} textAnchor="end">
                🛡{n.securityGroupIds.length}
              </text>
            )}
          </g>
        );
      })}

      {layout.chips.map((c) => {
        const node = graph.nodes[c.id];
        if (!node) return null;
        const selected = selectedId === c.id;
        return (
          <g
            key={c.id}
            className={`chip${selected ? ' is-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${shortLabel(node.serviceType)} ${node.name}`}
            onClick={(ev) => {
              ev.stopPropagation();
              select(c.id);
            }}
          >
            <rect x={c.x} y={c.y} width={c.width} height={c.height} rx={c.height / 2} />
            <text x={c.x + c.width / 2} y={c.y + c.height / 2 + 4} textAnchor="middle">
              {shortLabel(node.serviceType)} {node.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

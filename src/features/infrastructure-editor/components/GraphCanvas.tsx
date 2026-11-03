import { useMemo } from 'react';
import type { ConnectionId, InfrastructureGraph, NodeId } from '../../../domain/graph/types';
import { SERVICE_TEXT_JA } from '../../../data/i18n/ja/services';
import { isServiceTypeId } from '../../../domain/catalog/ids';
import { layoutGraph } from '../layout/tierLayout';
import { appsLine, partSummary } from '../summary';
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
  /** Monitoring overlay: a short status label per node at the selected time (icon + text, never color alone). */
  readonly metrics?: Readonly<Record<NodeId, NodeMetricBadge>> | undefined;
  /** Resources related to the selection (its security groups and subnets), lightly emphasised. */
  readonly related?: ReadonlySet<NodeId> | undefined;
  /** Multi-app missions: show which apps each server runs. */
  readonly showApps?: boolean | undefined;
}

export interface NodeMetricBadge {
  readonly text: string;
  readonly level: 'ok' | 'warn' | 'bad';
}

const LEVEL_ICON = { ok: '✓', warn: '⚠', bad: '⛔' } as const;
const LEVEL_TEXT = { ok: '余裕あり', warn: '注意', bad: '危険' } as const;

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
  metrics,
  related,
  showApps = false,
}: GraphCanvasProps) {
  const layout = useMemo(() => layoutGraph(graph, { extraLine: showApps }), [graph, showApps]);

  const select = (id: NodeId) => onSelect?.(id);
  const stateClass = (id: NodeId) =>
    [
      selectedId === id ? 'is-selected' : '',
      highlight?.[id] === 'valid' ? 'is-candidate' : '',
      highlight?.[id] === 'invalid' ? 'is-dimmed' : '',
      related?.has(id) ? 'is-related' : '',
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
          const visible = z.kind === 'subnet' ? `${z.key.split(':')[0]} · ${z.label}` : z.label;
          // The accessible name starts with the visible text (voice-control users say what they see).
          const name = `${visible}（${z.kind === 'subnet' ? 'サブネット' : 'VPC'}）`;
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
                {visible}
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

        {layout.links.map((l, i) => (
          <line
            key={`link-${l.nodeId}-${i}`}
            className={`part-link part-link-${l.kind}`}
            x1={l.from.x}
            y1={l.from.y}
            x2={l.to.x}
            y2={l.to.y}
            aria-hidden="true"
          />
        ))}

        {layout.nodes.map((n) => {
          const node = graph.nodes[n.id];
          if (!node) return null;
          const issue = issues?.[n.id];
          const metric = metrics?.[n.id];
          const summary = partSummary(graph, n.id, n);
          const appsText = showApps ? appsLine(graph, n.id) : '';
          // The accessible name comes from the visible "TYPE name summary" text; extra state is a description.
          const extra = [
            metric ? `${LEVEL_TEXT[metric.level]} ${metric.text}` : '',
            locked?.has(n.id) ? 'ロック中' : '',
            issue === 'error' ? 'エラーあり' : issue === 'warning' ? '警告あり' : '',
          ]
            .filter(Boolean)
            .join('、');
          return (
            <g
              key={n.key}
              className={`node node-${categoryClass(node.serviceType)} part-${n.role} ${stateClass(n.id)} ${metric ? `heat-${metric.level}` : ''}`}
              data-node-id={n.partIndex === 0 ? n.id : undefined}
              role="button"
              tabIndex={0}
              aria-pressed={selectedId === n.id}
              aria-describedby={extra ? `desc-${n.key}` : undefined}
              onClick={(ev) => {
                ev.stopPropagation();
                select(n.id);
              }}
              onKeyDown={keySelect(n.id)}
            >
              {extra && <desc id={`desc-${n.key}`}>{extra}</desc>}
              <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={8} />
              {/* One text element so the visible text reads "TYPE name", matching the accessible name. */}
              <text x={n.x + 8} y={n.y + 18}>
                <tspan className="node-type">{shortLabel(node.serviceType)}</tspan>{' '}
                <tspan className="node-name" x={n.x + 8} dy={18}>
                  {node.name}
                </tspan>
                {summary && (
                  <>
                    {' '}
                    <tspan className="node-summary" x={n.x + 8} dy={17}>
                      {summary}
                    </tspan>
                  </>
                )}
                {appsText && (
                  <>
                    {' '}
                    <tspan className="node-apps" x={n.x + 8} dy={15}>
                      {appsText}
                    </tspan>
                  </>
                )}
              </text>
              {locked?.has(n.id) && (
                <text className="node-type" x={n.x + 34} y={n.y + 18} aria-hidden="true">
                  🔒
                </text>
              )}
              {metric ? (
                <text
                  className="node-metric"
                  x={n.x + n.width - 8}
                  y={n.y + 18}
                  textAnchor="end"
                  aria-hidden="true"
                >
                  {LEVEL_ICON[metric.level]} {metric.text}
                </text>
              ) : (
                n.securityGroupIds.length > 0 && (
                  <text
                    className="node-sg"
                    x={n.x + n.width - 8}
                    y={n.y + 18}
                    textAnchor="end"
                    aria-hidden="true"
                  >
                    🛡{n.securityGroupIds.length}
                  </text>
                )
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

import { useMemo } from 'react';
import { SERVICE_TEXT_JA } from '../../../data/i18n/ja/services';
import { isServiceTypeId } from '../../../domain/catalog/ids';
import type { AvailabilityZone } from '../../../domain/catalog/services';
import type { InfrastructureGraph, NodeId } from '../../../domain/graph/types';
import { layoutAz } from '../layout/azLayout';
import { appsLine, partSummary } from '../summary';
import type { Highlight, NodeMetricBadge } from './GraphCanvas';
import './graph-canvas.css';

export interface AzCanvasProps {
  readonly graph: InfrastructureGraph;
  readonly az: AvailabilityZone;
  readonly selectedId?: NodeId | undefined;
  readonly onSelect?: ((id: NodeId | undefined) => void) | undefined;
  readonly highlight?: Readonly<Record<NodeId, Highlight>> | undefined;
  readonly issues?: Readonly<Record<NodeId, 'error' | 'warning'>> | undefined;
  readonly related?: ReadonlySet<NodeId> | undefined;
  readonly metrics?: Readonly<Record<NodeId, NodeMetricBadge>> | undefined;
  readonly showApps?: boolean | undefined;
}

const LEVEL_ICON = { ok: '✓', warn: '⚠', bad: '⛔' } as const;
const category = (t: string) => t.split('.')[0] ?? 'unknown';

/** One AZ: its subnets with the resources in each, side by side (no traffic arrows). */
export function AzCanvas({
  graph,
  az,
  selectedId,
  onSelect,
  highlight,
  issues,
  related,
  metrics,
  showApps = false,
}: AzCanvasProps) {
  const layout = useMemo(() => layoutAz(graph, az, { boxHeight: showApps ? 79 : 64 }), [graph, az, showApps]);
  const stateClass = (id: NodeId) =>
    [
      selectedId === id ? 'is-selected' : '',
      highlight?.[id] === 'valid' ? 'is-candidate' : '',
      highlight?.[id] === 'invalid' ? 'is-dimmed' : '',
      related?.has(id) ? 'is-related' : '',
    ].join(' ');

  if (layout.subnets.length === 0) return <p className="muted">この AZ にはサブネットがありません。</p>;

  return (
    <div className="graph-viewport">
      <svg
        className="graph-canvas"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group"
        aria-label={`${az} の構成`}
        onClick={() => onSelect?.(undefined)}
      >
        {layout.subnets.map((z) => (
          <g
            key={z.subnetId}
            className={`zone zone-subnet ${stateClass(z.subnetId)}`}
            role="button"
            tabIndex={0}
            aria-label={`${z.label}（${z.tier === 'public' ? 'パブリック' : 'プライベート'}サブネット）`}
            data-node-id={z.subnetId}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(z.subnetId);
            }}
          >
            <rect x={z.x} y={z.y} width={z.width} height={z.height} rx={8} />
            <text x={z.x + 8} y={z.y + 15}>
              {z.label}（{z.tier === 'public' ? 'パブリック' : 'プライベート'}）
            </text>
          </g>
        ))}
        {layout.resources.map((b) => {
          const node = graph.nodes[b.id];
          if (!node) return null;
          const short = isServiceTypeId(node.serviceType) ? SERVICE_TEXT_JA[node.serviceType].short : '?';
          const summary =
            node.serviceType === 'lb.alb'
              ? 'このサブネットに配置'
              : partSummary(graph, b.id, { role: b.role, az });
          const apps = showApps ? appsLine(graph, b.id) : '';
          const metric = metrics?.[b.id];
          const issue = issues?.[b.id];
          return (
            <g
              key={b.key}
              className={`node node-${category(node.serviceType)} part-${b.role} ${stateClass(b.id)} ${metric ? `heat-${metric.level}` : ''}`}
              role="button"
              tabIndex={0}
              data-node-id={b.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(b.id);
              }}
            >
              <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={8} />
              <text x={b.x + 8} y={b.y + 18}>
                <tspan className="node-type">{short}</tspan>{' '}
                <tspan className="node-name" x={b.x + 8} dy={18}>
                  {node.name}
                </tspan>{' '}
                <tspan className="node-summary" x={b.x + 8} dy={17}>
                  {summary}
                </tspan>
                {apps && (
                  <>
                    {' '}
                    <tspan className="node-apps" x={b.x + 8} dy={15}>
                      {apps}
                    </tspan>
                  </>
                )}
              </text>
              {metric && (
                <text
                  className="node-metric"
                  x={b.x + b.width - 8}
                  y={b.y + 18}
                  textAnchor="end"
                  aria-hidden="true"
                >
                  {LEVEL_ICON[metric.level]}
                </text>
              )}
              {issue && (
                <circle
                  className={`issue-dot issue-${issue}`}
                  cx={b.x + b.width - 8}
                  cy={b.y + b.height - 10}
                  r={5}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

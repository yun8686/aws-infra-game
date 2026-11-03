import { useMemo } from 'react';
import type { InfrastructureGraph, NodeId } from '../../../domain/graph/types';
import { buildOverviewGroups, layoutOverview, type OverviewGroup } from '../layout/overview';
import type { Highlight, NodeMetricBadge } from './GraphCanvas';
import './graph-canvas.css';

export interface OverviewCanvasProps {
  readonly graph: InfrastructureGraph;
  readonly showApps: boolean;
  readonly selectedId?: NodeId | undefined;
  readonly highlight?: Readonly<Record<NodeId, Highlight>> | undefined;
  readonly issues?: Readonly<Record<NodeId, 'error' | 'warning'>> | undefined;
  readonly related?: ReadonlySet<NodeId> | undefined;
  readonly metrics?: Readonly<Record<NodeId, NodeMetricBadge>> | undefined;
  readonly onOpen: (group: OverviewGroup) => void;
}

const LEVEL_ICON = { ok: '✓', warn: '⚠', bad: '⛔' } as const;
const RANK = { ok: 0, warn: 1, bad: 2 } as const;

/** The worst member state, with how many members share it. */
const groupBadge = (group: OverviewGroup, metrics: Readonly<Record<NodeId, NodeMetricBadge>>) => {
  const badges = group.nodeIds.map((id) => metrics[id]).filter((b): b is NodeMetricBadge => !!b);
  if (badges.length === 0) return undefined;
  // Worst level first; among equals, a stopped resource is the most important thing to show.
  const worst = badges.reduce((a, b) =>
    RANK[b.level] > RANK[a.level] ||
    (RANK[b.level] === RANK[a.level] && b.text.includes('停止') && !a.text.includes('停止'))
      ? b
      : a,
  );
  const same = badges.filter((b) => b.level === worst.level).length;
  const text =
    badges.length > 1 && worst.level !== 'ok' ? `${worst.text}（${same}/${badges.length}）` : worst.text;
  return { level: worst.level, text };
};

/** Top level of the drill-down diagram: one box per layer, one arrow between layers (ADR 0017). */
export function OverviewCanvas({
  graph,
  showApps,
  selectedId,
  highlight,
  issues,
  related,
  metrics,
  onOpen,
}: OverviewCanvasProps) {
  const groups = useMemo(() => buildOverviewGroups(graph, { showApps }), [graph, showApps]);
  // Monitoring adds a status line under each layer's summary instead of crowding the title.
  const layout = useMemo(
    () => layoutOverview(graph, groups, undefined, { statusLine: !!metrics }),
    [graph, groups, metrics],
  );

  const state = (g: OverviewGroup) => {
    const members = g.nodeIds;
    const classes = [`group-${g.kind}`];
    if (selectedId && members.includes(selectedId)) classes.push('is-selected');
    if (highlight) {
      const marks = members.map((id) => highlight[id]).filter(Boolean);
      if (marks.includes('valid')) classes.push('is-candidate');
      else if (marks.length > 0) classes.push('is-dimmed');
    }
    if (related && members.some((id) => related.has(id))) classes.push('is-related');
    return classes.join(' ');
  };
  const issueOf = (g: OverviewGroup) => {
    const levels = g.nodeIds.map((id) => issues?.[id]);
    return levels.includes('error') ? 'error' : levels.includes('warning') ? 'warning' : undefined;
  };

  return (
    <div className="graph-viewport">
      <svg
        className="graph-canvas overview-canvas"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group"
        aria-label="構成の全体図"
      >
        <defs>
          <marker
            id="ov-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" className="edge-arrow" />
          </marker>
        </defs>
        {layout.vpc && (
          <g className="zone zone-vpc" aria-hidden="true">
            <rect
              x={layout.vpc.x}
              y={layout.vpc.y}
              width={layout.vpc.width}
              height={layout.vpc.height}
              rx={10}
            />
            <text x={layout.vpc.x + 6} y={layout.vpc.y + 13}>
              {layout.vpc.label}
            </text>
          </g>
        )}
        {layout.labels.map((l) => (
          <text key={l.text} className="overview-section" x={l.x} y={l.y}>
            {l.text}
          </text>
        ))}
        {layout.arrows.map((a, i) => (
          <line
            key={i}
            className={`edge edge-${a.kind}`}
            x1={a.from.x}
            y1={a.from.y}
            x2={a.to.x}
            y2={a.to.y}
            markerEnd="url(#ov-arrow)"
          />
        ))}
        {layout.boxes.map((b) => {
          const g = b.group;
          const badge = metrics ? groupBadge(g, metrics) : undefined;
          const issue = issueOf(g);
          const drill =
            g.nodeIds.length > 1 ||
            g.kind === 'compute' ||
            g.kind === 'unplaced' ||
            g.kind === 'network' ||
            g.kind === 'az';
          return (
            <g
              key={g.key}
              className={`node overview-box ${state(g)} ${badge ? `heat-${badge.level}` : ''}`}
              role="button"
              tabIndex={0}
              data-group-key={g.key}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(g);
              }}
            >
              <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={10} />
              <text x={b.x + 10} y={b.y + 20}>
                <tspan className="overview-title">{g.title}</tspan>
                {g.lines.map((line, i) => (
                  <tspan key={i} className="overview-line" x={b.x + 10} dy={i === 0 ? 19 : 15}>
                    {' '}
                    {line}
                  </tspan>
                ))}
              </text>
              {drill && (
                <text
                  className="overview-open"
                  x={b.x + b.width - 10}
                  y={b.y + b.height / 2 + 6}
                  textAnchor="end"
                  aria-hidden="true"
                >
                  ›
                </text>
              )}
              {badge && (
                <text className="node-metric" x={b.x + 10} y={b.y + b.height - 10} aria-hidden="true">
                  {LEVEL_ICON[badge.level]} {badge.text}
                </text>
              )}
              {issue && (
                <circle className={`issue-dot issue-${issue}`} cx={b.x + b.width - 10} cy={b.y + 10} r={5} />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

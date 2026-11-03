import { useMemo } from 'react';
import type { Diagram } from '../../model';
import { GROUP_ICONS, RESOURCE_ICONS, type IconSource } from './icons';
import { RESOURCE_LABEL, TIER_LABEL, frameTitle } from './labels';
import { ICON, layoutView, type ArrowShape, type BoxShape, type ItemShape } from './layout';
import './diagram.css';

export const LAYOUT_WIDTH = 360;

export type ItemMark = 'candidate' | 'dimmed';

export interface DiagramCanvasProps {
  readonly diagram: Diagram;
  readonly frameId: string | null;
  readonly selectedId?: string | undefined;
  readonly issues?: Readonly<Record<string, 'error' | 'warning'>> | undefined;
  /** Connect mode: candidates are highlighted, everything else dimmed. */
  readonly marks?: Readonly<Record<string, ItemMark>> | undefined;
  /** Extra line under an item (monitoring status). */
  readonly badges?: Readonly<Record<string, { text: string; level: 'ok' | 'warn' | 'bad' }>> | undefined;
  readonly onOpenFrame: (frameId: string) => void;
  readonly onSelect: (resourceId: string) => void;
}

const Icon = ({ src, x, y, size }: { src: IconSource; x: number; y: number; size: number }) => (
  <>
    <image
      className="icon-light"
      href={src.light}
      x={x}
      y={y}
      width={size}
      height={size}
      aria-hidden="true"
    />
    <image className="icon-dark" href={src.dark} x={x} y={y} width={size} height={size} aria-hidden="true" />
  </>
);

const boxIcon = (b: BoxShape): IconSource | undefined => {
  switch (b.kind) {
    case 'cloud':
      return GROUP_ICONS.cloud;
    case 'region':
      return GROUP_ICONS.region;
    case 'vpc':
      return GROUP_ICONS.vpc;
    case 'subnet':
      return b.tier === 'public' ? GROUP_ICONS.publicSubnet : GROUP_ICONS.privateSubnet;
    default:
      return undefined;
  }
};

const boxTitle = (b: BoxShape) =>
  b.kind === 'cloud'
    ? 'AWS Cloud'
    : b.kind === 'strip'
      ? 'VPC 共通'
      : b.kind === 'subnet' || b.kind === 'vpc'
        ? b.label
        : frameTitle(b.kind, b.label);

const boxDescription = (b: BoxShape) => {
  if (b.kind === 'subnet') return `${b.tier ? TIER_LABEL[b.tier] : 'サブネット'}。タップで中を開きます`;
  if (b.kind === 'az') return 'アベイラビリティーゾーン。タップで中を開きます';
  if (b.kind === 'vpc') return 'VPC。タップで中を開きます';
  return '';
};

/** Splits a name into at most two short lines for under-icon labels. */
const labelLines = (text: string, max = 10): string[] =>
  text.length <= max ? [text] : [text.slice(0, max), text.slice(max, max * 2)];

function Box({ b, onOpen }: { b: BoxShape; onOpen: (id: string) => void }) {
  const icon = boxIcon(b);
  const tappable = !b.open && !!b.frameId && b.kind !== 'cloud' && b.kind !== 'region';
  const title = boxTitle(b);
  const classes = [
    'frame',
    `frame-${b.kind}`,
    b.tier ? `frame-${b.tier}` : '',
    b.open ? 'is-open' : '',
    tappable ? 'is-tappable' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const header = (
    <>
      <rect className="frame-rect" x={b.x} y={b.y} width={b.w} height={b.h} rx={b.kind === 'cloud' ? 0 : 4} />
      {icon && <Icon src={icon} x={b.x} y={b.y} size={24} />}
      <text className="frame-label" x={b.x + (icon ? 30 : 8)} y={b.y + 17}>
        {title}
      </text>
      {b.preview && b.preview.length > 0 && (
        <g className="frame-preview" aria-hidden="true">
          {b.preview.map((p, i) => (
            <g key={p.type}>
              <Icon src={RESOURCE_ICONS[p.type]} x={b.x + 10 + i * 52} y={b.y + 32} size={24} />
              <text className="frame-preview-count" x={b.x + 38 + i * 52} y={b.y + 50}>
                ×{p.count}
              </text>
            </g>
          ))}
        </g>
      )}
      {tappable && (
        <text className="frame-chevron" x={b.x + b.w - 10} y={b.y + 17} textAnchor="end" aria-hidden="true">
          ›
        </text>
      )}
    </>
  );
  if (!tappable) return <g className={classes}>{header}</g>;
  return (
    <g
      className={classes}
      role="button"
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(b.frameId as string);
      }}
    >
      <desc>{boxDescription(b)}</desc>
      {header}
    </g>
  );
}

function Item({
  item,
  selected,
  issue,
  mark,
  badge,
  onSelect,
}: {
  item: ItemShape;
  selected: boolean;
  issue: 'error' | 'warning' | undefined;
  mark: ItemMark | undefined;
  badge: { text: string; level: 'ok' | 'warn' | 'bad' } | undefined;
  onSelect: (id: string) => void;
}) {
  const classes = [
    'item',
    `item-${item.variant}`,
    `type-${item.type}`,
    selected ? 'is-selected' : '',
    mark ? `is-${mark}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(item.resourceId);
  };
  const desc = `${RESOURCE_LABEL[item.type]}${issue === 'error' ? '。エラーあり' : issue === 'warning' ? '。警告あり' : ''}${badge ? `。${badge.text}` : ''}`;
  if (item.variant === 'band') {
    return (
      <g className={classes} role="button" aria-label={item.label} onClick={click}>
        <desc>{desc}</desc>
        <rect className="band-rect" x={item.x} y={item.y} width={item.w} height={item.h} rx={6} />
        <Icon src={RESOURCE_ICONS[item.type]} x={item.x + 8} y={item.y + 8} size={28} />
        <text className="band-label" x={item.x + 44} y={item.y + 19}>
          {item.label}
        </text>
        <text className="band-type" x={item.x + 44} y={item.y + 35} aria-hidden="true">
          {badge ? badge.text : RESOURCE_LABEL[item.type]}
        </text>
        {issue && (
          <circle className={`issue-dot issue-${issue}`} cx={item.x + item.w - 10} cy={item.y + 10} r={5} />
        )}
      </g>
    );
  }
  const ix = item.x + (item.w - ICON) / 2;
  const iy = item.y + 4;
  const lines = labelLines(item.label);
  return (
    <g className={classes} role="button" aria-label={lines.join('')} onClick={click}>
      <desc>{desc}</desc>
      <rect className="item-hit" x={item.x + 2} y={item.y} width={item.w - 4} height={item.h} rx={6} />
      <Icon src={RESOURCE_ICONS[item.type]} x={ix} y={iy} size={ICON} />
      {lines.map((line, i) => (
        <text
          key={i}
          className="item-label"
          x={item.x + item.w / 2}
          y={iy + ICON + 14 + i * 13}
          textAnchor="middle"
        >
          {line}
        </text>
      ))}
      {badge && (
        <text
          className={`item-badge badge-${badge.level}`}
          x={item.x + item.w / 2}
          y={iy + ICON + 14 + lines.length * 13}
          textAnchor="middle"
          aria-hidden="true"
        >
          {badge.text}
        </text>
      )}
      {issue && <circle className={`issue-dot issue-${issue}`} cx={ix + ICON + 2} cy={iy + 2} r={5} />}
    </g>
  );
}

function Arrow({ a }: { a: ArrowShape }) {
  const labelAtStart = a.outsideEnd === 'from';
  const lx = labelAtStart ? a.x1 : a.x2;
  const ly = labelAtStart ? a.y1 + 12 : a.y2 - 6;
  return (
    <g className={`arrow arrow-${a.kind}`} aria-hidden="true">
      <line className="arrow-halo" x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} />
      <line
        className="arrow-line"
        x1={a.x1}
        y1={a.y1}
        x2={a.x2}
        y2={a.y2}
        markerEnd={`url(#arrowhead-${a.kind})`}
      />
      {a.outsideLabel && (
        <text className="arrow-outside" x={lx + 6} y={ly}>
          {labelAtStart ? `${a.outsideLabel} から` : `${a.outsideLabel} へ`}
        </text>
      )}
    </g>
  );
}

/** AWS-style architecture diagram of one open frame (docs/REBUILD.md §5). */
export function DiagramCanvas({
  diagram,
  frameId,
  selectedId,
  issues,
  marks,
  badges,
  onOpenFrame,
  onSelect,
}: DiagramCanvasProps) {
  const view = useMemo(() => layoutView(diagram, frameId, LAYOUT_WIDTH), [diagram, frameId]);
  return (
    <div className="diagram-viewport">
      <svg
        className="diagram-canvas"
        viewBox={`-4 -4 ${view.width + 8} ${view.height + 8}`}
        role="group"
        aria-label="構成図"
      >
        <defs>
          {(['traffic', 'data'] as const).map((k) => (
            <marker
              key={k}
              id={`arrowhead-${k}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className={`arrowhead arrowhead-${k}`} />
            </marker>
          ))}
        </defs>
        {view.boxes.map((b) => (
          <Box key={b.key} b={b} onOpen={onOpenFrame} />
        ))}
        {view.arrows.map((a) => (
          <Arrow key={a.key} a={a} />
        ))}
        {view.items.map((i) => (
          <Item
            key={i.key}
            item={i}
            selected={selectedId === i.resourceId}
            issue={issues?.[i.resourceId]}
            mark={marks?.[i.resourceId]}
            badge={badges?.[i.resourceId]}
            onSelect={onSelect}
          />
        ))}
      </svg>
    </div>
  );
}

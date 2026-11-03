import {
  RESOURCE_DEFINITIONS,
  childFrames,
  compareIds,
  frameAncestry,
  getFrame,
  isWithin,
  listLinks,
  listResources,
  resourcesIn,
  subnetIdsOf,
  standbySubnetOf,
  igwOf,
  vpcOfFrame,
  usersOf,
  type Diagram,
  type Frame,
  type FrameKind,
  type LinkKind,
  type Resource,
  type ResourceType,
} from '../../model';

/**
 * Layout of one drill-down view of the diagram (docs/REBUILD.md §5). The open frame fills the canvas;
 * its child frames are boxes, resources are icons, and resources that span subnets are bands across
 * the subnets they use. Pure function of the diagram, so it is unit-tested without a browser.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type BoxKind = 'cloud' | FrameKind | 'strip';

export interface BoxShape extends Rect {
  readonly key: string;
  readonly kind: BoxKind;
  /** Frame shown by the box; undefined for the AWS Cloud and VPC-wide strip. */
  readonly frameId?: string;
  readonly label: string;
  readonly tier?: 'public' | 'private';
  /** The frame this view is about (drawn as the outer boundary, not tappable). */
  readonly open: boolean;
  /** Small icons previewing what is inside a collapsed frame. */
  readonly preview?: readonly { readonly type: ResourceType; readonly count: number }[];
}

export interface ItemShape extends Rect {
  readonly key: string;
  readonly resourceId: string;
  readonly type: ResourceType;
  readonly label: string;
  /** `icon`: icon with label below. `band`: wide bar across the subnets a resource spans. */
  readonly variant: 'icon' | 'band';
  /** Multi-AZ database: which copy this icon shows. */
  readonly role?: 'primary' | 'standby';
  /** Several servers drawn as one icon ("EC2 ×4"); tapping opens `openFrameId`. */
  readonly memberIds?: readonly string[];
  readonly openFrameId?: string;
}

export interface ArrowShape {
  readonly key: string;
  /** `sync`: Multi-AZ replication between a database's primary and standby (not a link). */
  readonly kind: LinkKind | 'sync';
  readonly linkIds: readonly string[];
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Name of the far end when it lies outside the open frame (arrow ends at the frame edge). */
  readonly outsideLabel?: string;
  readonly outsideEnd?: 'from' | 'to';
  /** Labels at the same frame edge are stacked one per line. */
  readonly labelRow?: number;
}

export interface DiagramView {
  readonly frameId: string;
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly BoxShape[];
  readonly items: readonly ItemShape[];
  readonly arrows: readonly ArrowShape[];
}

export const ICON = 40;
export const ITEM_W = 76;
export const ITEM_H = 80;
export const BAND_H = 44;
const PAD = 8;
const HEADER = 30;
const GAP = 8;
const USERS_ROW = ITEM_H + 28;
/** Room under the VPC header for the Internet Gateway's label. */
const IGW_SPACE = 30;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

class Canvas {
  readonly boxes: BoxShape[] = [];
  readonly items: ItemShape[] = [];
  box(b: BoxShape) {
    this.boxes.push(b);
  }
  item(i: Omit<ItemShape, 'key'>) {
    this.items.push({
      ...i,
      key: `${i.resourceId}@${this.items.filter((x) => x.resourceId === i.resourceId).length}`,
    });
  }
}

const isSpanning = (r: Resource) => RESOURCE_DEFINITIONS[r.type].spansSubnets;

type Entry = Resource | { readonly r: Resource; readonly role?: 'primary' | 'standby' };
const entry = (e: Entry) => ('r' in e ? e : { r: e, role: undefined });

/** Lay out icons in a grid inside `area`; returns the used height. */
const iconGrid = (c: Canvas, entries: readonly Entry[], x: number, y: number, w: number): number => {
  if (entries.length === 0) return 0;
  const perRow = Math.max(1, Math.floor(w / ITEM_W));
  const used = Math.min(perRow, entries.length) * ITEM_W;
  const offset = x + (w - used) / 2;
  entries.map(entry).forEach(({ r, role }, i) => {
    c.item({
      resourceId: r.id,
      type: r.type,
      label: r.name,
      variant: 'icon',
      ...(role ? { role } : {}),
      x: offset + (i % perRow) * ITEM_W,
      y: y + Math.floor(i / perRow) * ITEM_H,
      w: ITEM_W,
      h: ITEM_H,
    });
  });
  return Math.ceil(entries.length / perRow) * ITEM_H;
};

/** In the VPC view, servers that would need more than one row are drawn as one "EC2 ×n" icon. */
const clusters = (count: number, w: number) => count > Math.max(1, Math.floor(w / ITEM_W));

const gridHeight = (count: number, w: number) =>
  count === 0 ? 0 : Math.ceil(count / Math.max(1, Math.floor(w / ITEM_W))) * ITEM_H;

/** Icons in a subnet: its EC2 instances, and databases whose primary or standby is there. */
const subnetIcons = (d: Diagram, subnetId: string) => {
  const own = resourcesIn(d, subnetId);
  const servers = own.filter((r) => r.type !== 'rds');
  const dbs: Entry[] = listResources(d).flatMap((r): Entry[] => {
    if (r.type !== 'rds') return [];
    const standby = standbySubnetOf(d, r);
    if (r.frameId === subnetId) return [{ r, ...(standby ? { role: 'primary' as const } : {}) }];
    return standby === subnetId ? [{ r, role: 'standby' as const }] : [];
  });
  return { servers, dbs };
};

/** Spanning resources that use a subnet. */
const spanningUsing = (d: Diagram, subnetId: string) =>
  listResources(d).filter((r) => isSpanning(r) && subnetIdsOf(d, r).includes(subnetId));

const subnetsOrdered = (d: Diagram, azId: string) =>
  childFrames(d, azId)
    .filter((f): f is Frame & { kind: 'subnet' } => f.kind === 'subnet')
    .sort((a, b) =>
      a.config.tier === b.config.tier ? compareIds(a.id, b.id) : a.config.tier === 'public' ? -1 : 1,
    );

const preview = (d: Diagram, frameId: string): NonNullable<BoxShape['preview']> => {
  const counts = new Map<ResourceType, number>();
  for (const r of listResources(d)) {
    if (r.type === 'users') continue;
    const inside = isWithin(d, r.frameId, frameId);
    const usesInside = isSpanning(r) && subnetIdsOf(d, r).some((s) => isWithin(d, s, frameId));
    if (inside || usesInside) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  }
  const order: ResourceType[] = ['igw', 'alb', 'ec2', 'asg', 'rds', 'sg', 'cloudwatch'];
  return order.filter((t) => counts.has(t)).map((t) => ({ type: t, count: counts.get(t) ?? 0 }));
};

const PREVIEW_H = 36;

// ---- Views -----------------------------------------------------------------------------

const regionView = (d: Diagram, region: Frame, width: number, c: Canvas): number => {
  const users = usersOf(d);
  if (users) iconGrid(c, [users], 0, 0, width);
  const cloudY = USERS_ROW;
  const regionX = PAD;
  const regionY = cloudY + HEADER;
  const innerX = regionX + PAD;
  const innerW = width - 2 * regionX - 2 * PAD;
  let y = regionY + HEADER;
  for (const vpc of childFrames(d, region.id)) {
    const h = HEADER + PREVIEW_H + PAD;
    c.box({
      key: vpc.id,
      kind: 'vpc',
      frameId: vpc.id,
      label: vpc.name,
      open: false,
      x: innerX,
      y,
      w: innerW,
      h,
      preview: preview(d, vpc.id),
    });
    y += h + GAP;
  }
  const own = resourcesIn(d, region.id);
  y += iconGrid(c, own, innerX, y, innerW);
  const regionH = Math.max(y - regionY + PAD, HEADER + 120);
  c.box({
    key: region.id,
    kind: 'region',
    frameId: region.id,
    label: region.name,
    open: true,
    x: regionX,
    y: regionY,
    w: width - 2 * regionX,
    h: regionH,
  });
  c.box({
    key: 'cloud',
    kind: 'cloud',
    label: 'AWS Cloud',
    open: false,
    x: 0,
    y: cloudY,
    w: width,
    h: regionH + HEADER + PAD,
  });
  return cloudY + regionH + HEADER + PAD;
};

interface Placed {
  readonly resource: Resource;
  readonly cols: number[];
  readonly row: number;
}

const vpcView = (d: Diagram, vpc: Frame, width: number, c: Canvas): number => {
  const users = usersOf(d);
  if (users) iconGrid(c, [users], 0, 0, width);
  const top = USERS_ROW;
  const innerX = PAD;
  const innerW = width - 2 * PAD;
  const azs = childFrames(d, vpc.id).filter((f): f is Frame & { kind: 'az' } => f.kind === 'az');
  azs.sort((a, b) => (a.config.zone < b.config.zone ? -1 : 1));
  const cols = azs.length;
  const colW = cols > 0 ? (innerW - GAP * (cols - 1)) / cols : innerW;
  const subnetsByAz = azs.map((az) => subnetsOrdered(d, az.id));
  const rows = Math.max(0, ...subnetsByAz.map((s) => s.length));
  const cell = new Map<string, { col: number; row: number }>();
  subnetsByAz.forEach((list, col) => list.forEach((s, row) => cell.set(s.id, { col, row })));

  // Spanning resources whose subnets share one row become bands in that row; others go to the strip.
  const bands: Placed[] = [];
  const strip: Resource[] = [];
  for (const r of listResources(d)) {
    if (r.frameId !== vpc.id || r.type === 'igw') continue;
    if (!isSpanning(r)) {
      strip.push(r);
      continue;
    }
    const cells = subnetIdsOf(d, r)
      .map((s) => cell.get(s))
      .filter((x): x is { col: number; row: number } => !!x);
    const rowSet = new Set(cells.map((x) => x.row));
    if (cells.length > 0 && rowSet.size === 1)
      bands.push({ resource: r, cols: cells.map((x) => x.col), row: cells[0]!.row });
    else strip.push(r);
  }

  const subnetInnerW = colW - 2 * PAD;
  // Each row: servers, then bands (load balancer, Auto Scaling), then databases.
  const rowParts = Array.from({ length: rows }, (_, row) => {
    const icons = subnetsByAz.map((list) => (list[row] ? subnetIcons(d, list[row].id) : undefined));
    const servers = Math.max(
      0,
      ...icons.map((i) => {
        const n = i?.servers.length ?? 0;
        return clusters(n, subnetInnerW) ? ITEM_H : gridHeight(n, subnetInnerW);
      }),
    );
    const bandsH = bands.filter((b) => b.row === row).length * (BAND_H + 4);
    const dbs = Math.max(0, ...icons.map((i) => gridHeight(i?.dbs.length ?? 0, subnetInnerW)));
    return { servers, bandsH, dbs };
  });
  const rowHeights = rowParts.map((p) => HEADER + Math.max(p.servers + p.bandsH + p.dbs, 24) + PAD);

  // The Internet Gateway sits on the VPC's top border, as in AWS diagrams.
  const igw = igwOf(d, vpc.id);
  if (igw) {
    c.item({
      resourceId: igw.id,
      type: igw.type,
      label: igw.name,
      variant: 'icon',
      x: width / 2 - ITEM_W / 2,
      y: top - ICON / 2 - 4,
      w: ITEM_W,
      h: ITEM_H,
    });
  }
  const azTop = top + HEADER + PAD + (igw ? IGW_SPACE : 0);
  const gridTop = azTop + HEADER;
  const rowY = rowHeights.reduce<number[]>((acc, h, i) => [...acc, (acc[i] ?? gridTop) + h + GAP], [gridTop]);
  const azH = HEADER + (rows > 0 ? (rowY[rows] ?? gridTop) - gridTop : 60) + PAD;

  azs.forEach((az, col) => {
    const x = innerX + col * (colW + GAP);
    c.box({
      key: az.id,
      kind: 'az',
      frameId: az.id,
      label: az.name,
      open: false,
      x,
      y: azTop,
      w: colW,
      h: azH,
    });
    subnetsByAz[col]!.forEach((s, row) => {
      const y = rowY[row] ?? gridTop;
      const h = rowHeights[row] ?? 0;
      c.box({
        key: s.id,
        kind: 'subnet',
        frameId: s.id,
        label: s.name,
        tier: s.config.tier,
        open: false,
        x: x + PAD / 2,
        y,
        w: colW - PAD,
        h,
      });
      const icons = subnetIcons(d, s.id);
      const parts = rowParts[row] ?? { servers: 0, bandsH: 0, dbs: 0 };
      if (clusters(icons.servers.length, subnetInnerW)) {
        c.item({
          resourceId: `cluster:${s.id}`,
          type: 'ec2',
          label: `EC2 ×${icons.servers.length}`,
          variant: 'icon',
          memberIds: icons.servers.map((r) => r.id),
          openFrameId: s.id,
          x: x + PAD + (subnetInnerW - ITEM_W) / 2,
          y: y + HEADER,
          w: ITEM_W,
          h: ITEM_H,
        });
      } else iconGrid(c, icons.servers, x + PAD, y + HEADER, subnetInnerW);
      iconGrid(c, icons.dbs, x + PAD, y + HEADER + parts.servers + parts.bandsH, subnetInnerW);
    });
  });

  for (let row = 0; row < rows; row++) {
    const inRow = bands
      .filter((b) => b.row === row)
      .sort((a, b) => bandOrder(a.resource) - bandOrder(b.resource));
    inRow.forEach((b, i) => {
      const minCol = Math.min(...b.cols);
      const maxCol = Math.max(...b.cols);
      const x = innerX + minCol * (colW + GAP) + PAD;
      const w = (maxCol - minCol + 1) * colW + (maxCol - minCol) * GAP - 2 * PAD;
      const y = (rowY[row] ?? gridTop) + HEADER + (rowParts[row]?.servers ?? 0) + i * (BAND_H + 4);
      c.item({
        resourceId: b.resource.id,
        type: b.resource.type,
        label: b.resource.name,
        variant: 'band',
        x,
        y,
        w,
        h: BAND_H,
      });
    });
  }

  let y = azTop + (cols > 0 ? azH + GAP : 0);
  if (strip.length > 0) {
    const h = HEADER + gridHeight(strip.length, innerW - 2 * PAD) + PAD;
    c.box({ key: `${vpc.id}:strip`, kind: 'strip', label: 'VPC', open: false, x: innerX, y, w: innerW, h });
    iconGrid(c, strip, innerX + PAD, y + HEADER, innerW - 2 * PAD);
    y += h + GAP;
  }
  const vpcH = Math.max(y - top + PAD, HEADER + 120);
  c.box({
    key: vpc.id,
    kind: 'vpc',
    frameId: vpc.id,
    label: vpc.name,
    open: true,
    x: 0,
    y: top,
    w: width,
    h: vpcH,
  });
  return top + vpcH;
};

const BAND_ORDER: Partial<Record<ResourceType, number>> = { alb: 0, asg: 1 };
const bandOrder = (r: Resource) => BAND_ORDER[r.type] ?? 1;

/**
 * One subnet's contents in request order: load balancers, EC2 instances, Auto Scaling groups,
 * then databases (primary or standby), so arrows flow downwards.
 */
const subnetContents = (d: Diagram, subnetId: string, x: number, y: number, w: number, c: Canvas): number => {
  let cy = y;
  const bands = spanningUsing(d, subnetId).sort((a, b) => bandOrder(a) - bandOrder(b));
  const band = (r: Resource) => {
    c.item({ resourceId: r.id, type: r.type, label: r.name, variant: 'band', x, y: cy, w, h: BAND_H });
    cy += BAND_H + 4;
  };
  const { servers, dbs } = subnetIcons(d, subnetId);
  bands.filter((r) => r.type === 'alb').forEach(band);
  const grid = iconGrid(c, servers, x, cy, w);
  cy += grid > 0 ? grid + 4 : 0;
  bands.filter((r) => r.type !== 'alb').forEach(band);
  cy += iconGrid(c, dbs, x, cy, w);
  return Math.max(cy - y, 24);
};

const azView = (d: Diagram, az: Frame, width: number, c: Canvas): number => {
  const top = ITEM_H / 2;
  let y = top + HEADER;
  for (const s of subnetsOrdered(d, az.id)) {
    const inner = subnetContents(d, s.id, PAD * 2, y + HEADER, width - PAD * 4, c);
    const h = HEADER + inner + PAD;
    c.box({
      key: s.id,
      kind: 'subnet',
      frameId: s.id,
      label: s.name,
      tier: s.config.tier,
      open: false,
      x: PAD,
      y,
      w: width - 2 * PAD,
      h,
    });
    y += h + GAP;
  }
  const h = Math.max(y - top + PAD, HEADER + 120);
  c.box({ key: az.id, kind: 'az', frameId: az.id, label: az.name, open: true, x: 0, y: top, w: width, h });
  return top + h + ITEM_H / 2;
};

const subnetView = (d: Diagram, subnet: Frame & { kind: 'subnet' }, width: number, c: Canvas): number => {
  const top = ITEM_H / 2;
  const inner = subnetContents(d, subnet.id, PAD * 2, top + HEADER + PAD, width - PAD * 4, c);
  const h = Math.max(HEADER + PAD + inner + PAD, HEADER + 120);
  c.box({
    key: subnet.id,
    kind: 'subnet',
    frameId: subnet.id,
    label: subnet.name,
    tier: subnet.config.tier,
    open: true,
    x: 0,
    y: top,
    w: width,
    h,
  });
  return top + h + ITEM_H / 2;
};

// ---- Arrows ------------------------------------------------------------------------------

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

type Anchor = { rect: Rect; wide: boolean; key: string } | { outside: true; label: string };
type Point = { x: number; y: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const iconCenter = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + ICON / 2 + 4 });

/** Where an arrow attaches to `a`, given the other end `b`: wide shapes connect straight up or down. */
const refPoint = (a: { rect: Rect; wide: boolean }, b: { rect: Rect; wide: boolean }): Point => {
  if (!a.wide) return iconCenter(a.rect);
  const lo = a.rect.x + 12;
  const hi = a.rect.x + a.rect.w - 12;
  if (b.wide) {
    const left = Math.max(lo, b.rect.x + 12);
    const right = Math.min(hi, b.rect.x + b.rect.w - 12);
    if (left <= right) return { x: (left + right) / 2, y: center(a.rect).y };
  }
  const other = b.wide ? center(b.rect) : iconCenter(b.rect);
  return { x: clamp(other.x, lo, hi), y: center(a.rect).y };
};

/** Clip from `a`'s attachment point towards `toward` at its outline. */
const attach = (a: { rect: Rect; wide: boolean }, from: Point, toward: Point): Point => {
  const r = a.rect;
  if (a.wide) {
    if (toward.y < r.y) return { x: from.x, y: r.y };
    if (toward.y > r.y + r.h) return { x: from.x, y: r.y + r.h };
    return { x: toward.x < from.x ? r.x : r.x + r.w, y: from.y };
  }
  const half = ICON / 2 + 4;
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  if (dx === 0 && dy === 0) return from;
  // Going down, leave below the name so the arrow does not run over it.
  const down = r.y + 4 + ICON + 18 - from.y;
  const t = Math.min(
    dx !== 0 ? half / Math.abs(dx) : Infinity,
    dy !== 0 ? (dy > 0 ? down : half) / Math.abs(dy) : Infinity,
  );
  return { x: from.x + dx * t, y: from.y + dy * t };
};

const arrowsFor = (d: Diagram, c: Canvas, openBox: BoxShape): ArrowShape[] => {
  const anchorOf = (resourceId: string): Anchor => {
    // A Multi-AZ database is reached at its primary; the standby only gets the sync line.
    const item = c.items.find(
      (i) => (i.resourceId === resourceId || i.memberIds?.includes(resourceId)) && i.role !== 'standby',
    );
    if (item) return { rect: item, wide: item.variant === 'band', key: item.key };
    const r = d.resources[resourceId];
    const label = r?.name ?? resourceId;
    if (!r) return { outside: true, label };
    const frames = isSpanning(r) ? subnetIdsOf(d, r) : r.frameId ? [r.frameId] : [];
    const box = c.boxes.find((b) => !b.open && b.frameId && frames.some((f) => isWithin(d, f, b.frameId!)));
    if (box) return { rect: box, wide: true, key: box.key };
    return { outside: true, label };
  };

  // Traffic from users enters a VPC through its Internet Gateway: users → IGW → target.
  const segments: { id: string; kind: LinkKind; from: string; to: string }[] = [];
  for (const l of listLinks(d)) {
    const source = d.resources[l.from];
    const target = d.resources[l.to];
    const igw = source?.type === 'users' && target ? igwOf(d, vpcOfFrame(d, target.frameId)?.id) : undefined;
    if (igw) {
      segments.push({ id: l.id, kind: l.kind, from: l.from, to: igw.id });
      segments.push({ id: l.id, kind: l.kind, from: igw.id, to: l.to });
    } else segments.push({ id: l.id, kind: l.kind, from: l.from, to: l.to });
  }

  const merged = new Map<string, Mutable<ArrowShape>>();
  const rightLanes = new Map<string, number>();
  const outsideNames = new Map<string, string[]>();
  for (const l of segments) {
    const a = anchorOf(l.from);
    const b = anchorOf(l.to);
    if ('outside' in a && 'outside' in b) continue;
    if (!('outside' in a) && !('outside' in b) && a.key === b.key) continue;
    let shape: Omit<ArrowShape, 'key' | 'linkIds' | 'kind'>;
    if ('outside' in a && !('outside' in b)) {
      const ref = b.wide ? center(b.rect) : iconCenter(b.rect);
      const start = { x: ref.x, y: openBox.y };
      const end = attach(b, ref, start);
      shape = { x1: start.x, y1: start.y, x2: end.x, y2: end.y, outsideLabel: a.label, outsideEnd: 'from' };
    } else if (!('outside' in a) && 'outside' in b) {
      // Leave along the right edge so the stub does not run over what sits below the source.
      const lane = rightLanes.get(a.key) ?? rightLanes.size;
      rightLanes.set(a.key, lane);
      const laneX = openBox.x + openBox.w - 16 - lane * 14;
      const ref = a.wide
        ? { x: Math.min(laneX, a.rect.x + a.rect.w - 12), y: center(a.rect).y }
        : iconCenter(a.rect);
      const end = { x: a.wide ? ref.x : laneX, y: openBox.y + openBox.h };
      const start = attach(a, ref, end);
      shape = { x1: start.x, y1: start.y, x2: end.x, y2: end.y, outsideLabel: b.label, outsideEnd: 'to' };
    } else if (!('outside' in a) && !('outside' in b)) {
      const ra = refPoint(a, b);
      const rb = refPoint(b, a);
      const s = attach(a, ra, rb);
      const e = attach(b, rb, ra);
      shape = { x1: s.x, y1: s.y, x2: e.x, y2: e.y };
    } else continue;
    // Stubs to or from outside the open frame are merged per inside end ("web-5 ほか7件").
    const key = `${l.kind}:${'outside' in a ? 'out' : a.key}>${'outside' in b ? 'out' : b.key}`;
    const outsideName = 'outside' in a ? a.label : 'outside' in b ? b.label : undefined;
    const prev = merged.get(key);
    if (prev) {
      prev.linkIds = [...prev.linkIds, l.id];
      if (outsideName && !(outsideNames.get(key) ?? []).includes(outsideName)) {
        const names = [...(outsideNames.get(key) ?? []), outsideName];
        outsideNames.set(key, names);
        prev.outsideLabel = `${names[0]} ほか${names.length - 1}件`;
      }
    } else {
      if (outsideName) outsideNames.set(key, [outsideName]);
      merged.set(key, { key, kind: l.kind, linkIds: [l.id], ...shape });
    }
  }
  for (const db of listResources(d)) {
    const primary = c.items.find((i) => i.resourceId === db.id && i.role === 'primary');
    const standby = c.items.find((i) => i.resourceId === db.id && i.role === 'standby');
    if (!primary || !standby) continue;
    const p = iconCenter(primary);
    const q = iconCenter(standby);
    const s1 = attach({ rect: primary, wide: false }, p, q);
    const s2 = attach({ rect: standby, wide: false }, q, p);
    merged.set(`sync:${db.id}`, {
      key: `sync:${db.id}`,
      kind: 'sync',
      linkIds: [],
      x1: s1.x,
      y1: s1.y,
      x2: s2.x,
      y2: s2.y,
    });
  }

  // Several stubs from the same outside resource: name it once. Labels on one edge get their own line.
  const named = new Set<string>();
  const rows = { from: 0, to: 0 };
  return [...merged.values()].map((a) => {
    if (!a.outsideLabel || !a.outsideEnd) return a;
    const k = `${a.outsideEnd}:${a.outsideLabel}`;
    if (!named.has(k)) {
      named.add(k);
      return { ...a, labelRow: rows[a.outsideEnd]++ };
    }
    const { outsideLabel, ...rest } = a;
    return rest;
  });
};

// ---- Entry point ------------------------------------------------------------------------

/** Lays out the view of `frameId` (any frame; falls back to the Region) at the given width. */
export const layoutView = (d: Diagram, frameId: string | null, width: number): DiagramView => {
  const chain = frameAncestry(d, frameId);
  const frame =
    chain.at(-1) ??
    frameAncestry(d, Object.values(d.frames).find((f) => f.kind === 'region')?.id ?? null).at(-1);
  if (!frame) return { frameId: '', width, height: 0, boxes: [], items: [], arrows: [] };
  const c = new Canvas();
  let height: number;
  switch (frame.kind) {
    case 'region':
      height = regionView(d, frame, width, c);
      break;
    case 'vpc':
      height = vpcView(d, frame, width, c);
      break;
    case 'az':
      height = azView(d, frame, width, c);
      break;
    case 'subnet':
      height = subnetView(d, frame, width, c);
      break;
  }
  const openBox = c.boxes.find((b) => b.open) as BoxShape;
  // Draw outer frames first so inner boxes sit on top.
  const order: Record<BoxKind, number> = { cloud: 0, region: 1, vpc: 2, az: 3, strip: 3, subnet: 4 };
  const boxes = [...c.boxes].sort(
    (a, b) => order[a.kind] - order[b.kind] || (a.open === b.open ? 0 : a.open ? -1 : 1),
  );
  return { frameId: frame.id, width, height, boxes, items: c.items, arrows: arrowsFor(d, c, openBox) };
};

/** Breadcrumb: Region › VPC › AZ › Subnet down to the open frame. */
export const breadcrumb = (d: Diagram, frameId: string | null): Frame[] => frameAncestry(d, frameId);

/** The frame to open to see a resource in context (EC2: its subnet; others: their frame). */
export const frameToShow = (d: Diagram, resourceId: string): string | null => {
  const r = d.resources[resourceId];
  if (!r) return null;
  if (r.type === 'users') return Object.values(d.frames).find((f) => f.kind === 'region')?.id ?? null;
  return r.frameId && getFrame(d, r.frameId) ? r.frameId : null;
};

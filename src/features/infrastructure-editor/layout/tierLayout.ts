import { readConfig } from '../../../domain/catalog/catalog';
import { AZS, type AvailabilityZone } from '../../../domain/catalog/services';
import { listConnections, listNodes, nodesOfType } from '../../../domain/graph/graph';
import { azsOf, securityGroupsOf } from '../../../domain/graph/network';
import type { ConnectionId, InfraNode, InfrastructureGraph, NodeId } from '../../../domain/graph/types';

/**
 * Deterministic "tier × AZ" layout (ADR 0005), tuned for a portrait phone.
 * Rows are architecture tiers top → bottom; columns are availability zones.
 * Pure function: no DOM, no player positioning.
 */

export const LAYOUT = {
  margin: 12,
  columnWidth: 108,
  columnGap: 8,
  nodeHeight: 64,
  rowGap: 12,
  bandPadding: 22,
  chipHeight: 32,
} as const;

type Tier = 'entry' | 'edge' | 'compute' | 'data' | 'unplaced';
const TIER_OF: Record<string, Tier> = {
  'external.internet': 'entry',
  'lb.alb': 'edge',
  'compute.ec2': 'compute',
  'compute.autoscaling': 'compute',
  'database.rds': 'data',
};

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How a resource is drawn. Resources placed in several subnets are drawn once per AZ ('zonal'),
 * so nothing looks as if it straddles subnets; a Multi-AZ database shows its primary and standby.
 * Load balancers and the Internet are genuinely multi-AZ / outside the VPC and span ('single').
 */
export type PartRole = 'single' | 'zonal' | 'primary' | 'standby';

export interface LayoutNode extends Rect {
  readonly id: NodeId;
  /** Unique per drawn part: `${id}` or `${id}@${az}`. */
  readonly key: string;
  readonly role: PartRole;
  readonly az?: AvailabilityZone;
  readonly partIndex: number;
  readonly partCount: number;
  readonly securityGroupIds: readonly NodeId[];
}

/** Dashed link between the parts of one resource, or primary → standby replication. */
export interface LayoutLink {
  readonly kind: 'group' | 'replication';
  readonly nodeId: NodeId;
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

export interface LayoutZone extends Rect {
  readonly kind: 'vpc' | 'az' | 'subnet';
  readonly key: string;
  readonly label: string;
  readonly nodeIds: readonly NodeId[];
}

export interface LayoutEdge {
  readonly id: ConnectionId;
  readonly kind: 'routes_to' | 'data_access';
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

/** Nodes shown as chips (security groups, monitoring) instead of tier boxes. */
export interface LayoutChip extends Rect {
  readonly id: NodeId;
}

export interface GraphLayoutResult {
  readonly width: number;
  readonly height: number;
  readonly columns: readonly AvailabilityZone[];
  readonly nodes: readonly LayoutNode[];
  readonly zones: readonly LayoutZone[];
  readonly edges: readonly LayoutEdge[];
  readonly links: readonly LayoutLink[];
  readonly chips: readonly LayoutChip[];
}

interface Span {
  readonly start: number;
  readonly end: number;
}

interface PartPlan {
  readonly span: Span;
  readonly role: PartRole;
  readonly az?: AvailabilityZone;
}
interface Item {
  readonly node: InfraNode;
  readonly parts: readonly PartPlan[];
}

/** Greedy packing: each item goes to the first lane where none of its parts' columns are taken. */
const packLanes = (items: readonly Item[]): number[] => {
  const lanes: Set<number>[] = [];
  return items.map((item) => {
    const cols = item.parts.flatMap((p) =>
      Array.from({ length: p.span.end - p.span.start + 1 }, (_, i) => p.span.start + i),
    );
    let lane = lanes.findIndex((taken) => cols.every((c) => !taken.has(c)));
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(new Set());
    }
    for (const c of cols) lanes[lane]?.add(c);
    return lane;
  });
};

export const layoutGraph = (graph: InfrastructureGraph): GraphLayoutResult => {
  const L = LAYOUT;
  const subnets = nodesOfType(graph, 'network.subnet');
  const usedAzs = new Set<AvailabilityZone>();
  for (const s of subnets) {
    const az = readConfig(s, 'network.subnet')?.az;
    if (az) usedAzs.add(az);
  }
  const columns = AZS.filter((az) => usedAzs.has(az));
  const colCount = Math.max(columns.length, 1);
  const width = L.margin * 2 + colCount * L.columnWidth + (colCount - 1) * L.columnGap;
  const colX = (i: number) => L.margin + i * (L.columnWidth + L.columnGap);
  const spanX = (span: Span) => ({
    x: colX(span.start),
    width: colX(span.end) + L.columnWidth - colX(span.start),
  });

  const fullSpan: Span = { start: 0, end: colCount - 1 };
  const colOf = (az: AvailabilityZone) => columns.indexOf(az);

  const partsOf = (node: InfraNode): PartPlan[] | undefined => {
    const azs = azsOf(graph, node.id).filter((az) => colOf(az) >= 0);
    if (azs.length === 0) return undefined;
    const at = (az: AvailabilityZone, role: PartRole): PartPlan => ({
      span: { start: colOf(az), end: colOf(az) },
      role,
      az,
    });
    if (node.serviceType === 'compute.ec2' || node.serviceType === 'compute.autoscaling') {
      return azs.map((az) => at(az, 'zonal'));
    }
    if (node.serviceType === 'database.rds') {
      const primary = azs[0] as AvailabilityZone;
      const standby = readConfig(node, 'database.rds')?.multiAz ? azs[1] : undefined;
      return standby ? [at(primary, 'primary'), at(standby, 'standby')] : [at(primary, 'primary')];
    }
    const idx = azs.map(colOf);
    return [{ span: { start: Math.min(...idx), end: Math.max(...idx) }, role: 'single' }];
  };

  const byTier: Record<Tier, Item[]> = { entry: [], edge: [], compute: [], data: [], unplaced: [] };
  let unplacedCount = 0;
  for (const node of listNodes(graph)) {
    const tier = TIER_OF[node.serviceType];
    if (!tier) continue;
    if (tier === 'entry') {
      byTier.entry.push({ node, parts: [{ span: fullSpan, role: 'single' }] });
      continue;
    }
    const parts = partsOf(node);
    if (parts) byTier[tier].push({ node, parts });
    else {
      // Unplaced nodes flow left to right, one per column.
      const col = unplacedCount++ % colCount;
      byTier.unplaced.push({ node, parts: [{ span: { start: col, end: col }, role: 'single' }] });
    }
  }

  const nodes: LayoutNode[] = [];
  const zones: LayoutZone[] = [];
  let y = L.margin;

  const placeTier = (tier: Tier): { top: number; bottom: number } => {
    const items = byTier[tier];
    const top = y;
    if (items.length === 0) return { top, bottom: top };
    const lanes = packLanes(items);
    const laneCount = Math.max(...lanes) + 1;
    items.forEach((item, i) => {
      const sgs = securityGroupsOf(graph, item.node.id).map((sg) => sg.id);
      item.parts.forEach((part, partIndex) => {
        const { x, width: w } = spanX(part.span);
        const inset = tier === 'entry' ? Math.max(0, (w - L.columnWidth) / 2) : 0;
        nodes.push({
          id: item.node.id,
          key: part.az && item.parts.length > 1 ? `${item.node.id}@${part.az}` : item.node.id,
          role: part.role,
          ...(part.az ? { az: part.az } : {}),
          partIndex,
          partCount: item.parts.length,
          x: x + inset,
          y: top + (lanes[i] ?? 0) * (L.nodeHeight + L.rowGap),
          width: w - inset * 2,
          height: L.nodeHeight,
          securityGroupIds: sgs,
        });
      });
    });
    y = top + laneCount * (L.nodeHeight + L.rowGap) - L.rowGap;
    return { top, bottom: y };
  };

  placeTier('entry');
  y += L.rowGap * 2;
  const vpcTop = y;
  y += L.bandPadding;
  const publicTop = y;
  y += L.bandPadding;
  placeTier('edge');
  y += 10;
  const publicBottom = y;
  y += L.rowGap;
  const privateTop = y;
  y += L.bandPadding;
  placeTier('compute');
  y += L.rowGap;
  placeTier('data');
  y += 10;
  const privateBottom = y;
  y += L.rowGap;
  const vpcBottom = y;

  const vpcs = nodesOfType(graph, 'network.vpc');
  if (vpcs.length > 0) {
    zones.push({
      kind: 'vpc',
      key: 'vpc',
      label: vpcs.map((v) => v.name).join(' / '),
      nodeIds: vpcs.map((v) => v.id),
      x: L.margin / 2,
      y: vpcTop,
      width: width - L.margin,
      height: vpcBottom - vpcTop,
    });
  }
  columns.forEach((az, i) => {
    for (const [tier, top, bottom] of [
      ['public', publicTop, publicBottom],
      ['private', privateTop, privateBottom],
    ] as const) {
      const members = subnets.filter((s) => {
        const cfg = readConfig(s, 'network.subnet');
        return cfg?.az === az && cfg.tier === tier;
      });
      if (members.length === 0) continue;
      zones.push({
        kind: 'subnet',
        key: `${az}:${tier}`,
        label: members.map((m) => m.name).join(' / '),
        nodeIds: members.map((m) => m.id),
        x: colX(i) - 2,
        y: top,
        width: L.columnWidth + 4,
        height: bottom - top,
      });
    }
  });

  if (byTier.unplaced.length > 0) {
    y += L.rowGap;
    placeTier('unplaced');
    y += L.rowGap;
  }

  // Chips: security groups and monitoring.
  const chips: LayoutChip[] = [];
  const chipNodes = nodesOfType(graph, 'network.security_group', 'monitoring.cloudwatch');
  if (chipNodes.length > 0) {
    y += L.rowGap;
    const chipWidth = L.columnWidth;
    const perRow = colCount;
    chipNodes.forEach((n, i) => {
      chips.push({
        id: n.id,
        x: colX(i % perRow),
        y: y + Math.floor(i / perRow) * (L.chipHeight + L.columnGap),
        width: chipWidth,
        height: L.chipHeight,
      });
    });
    y += Math.ceil(chipNodes.length / perRow) * (L.chipHeight + L.columnGap) - L.columnGap;
  }

  const partsById = new Map<NodeId, LayoutNode[]>();
  for (const n of nodes) partsById.set(n.id, [...(partsById.get(n.id) ?? []), n]);
  const bottom = (r: LayoutNode) => ({ x: r.x + r.width / 2, y: r.y + r.height });
  const topOf = (r: LayoutNode) => ({ x: r.x + r.width / 2, y: r.y });

  const edges: LayoutEdge[] = [];
  for (const c of listConnections(graph)) {
    if (c.connectionType !== 'routes_to' && c.connectionType !== 'data_access') continue;
    const sources = partsById.get(c.sourceNodeId) ?? [];
    // Requests go to every zonal part; database traffic goes to the primary only.
    const targets = (partsById.get(c.targetNodeId) ?? []).filter((t) => t.role !== 'standby');
    for (const s of sources) {
      const sameAz = targets.filter((t) => s.az !== undefined && t.az === s.az);
      const chosen =
        s.role === 'zonal' && c.connectionType === 'routes_to' && sameAz.length > 0 ? sameAz : targets;
      for (const t of chosen) {
        edges.push({ id: c.id, kind: c.connectionType, from: bottom(s), to: topOf(t) });
      }
    }
  }

  const links: LayoutLink[] = [];
  for (const [id, parts] of partsById) {
    for (let i = 1; i < parts.length; i++) {
      const a = parts[i - 1] as LayoutNode;
      const b = parts[i] as LayoutNode;
      links.push({
        kind: b.role === 'standby' ? 'replication' : 'group',
        nodeId: id,
        from: { x: a.x + a.width, y: a.y + a.height / 2 },
        to: { x: b.x, y: b.y + b.height / 2 },
      });
    }
  }

  return { width, height: y + L.margin, columns, nodes, zones, edges, links, chips };
};

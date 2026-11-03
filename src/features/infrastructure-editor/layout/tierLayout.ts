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
  nodeHeight: 52,
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

export interface LayoutNode extends Rect {
  readonly id: NodeId;
  readonly securityGroupIds: readonly NodeId[];
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
  readonly chips: readonly LayoutChip[];
}

interface Span {
  readonly start: number;
  readonly end: number;
}

/** Greedy interval packing: returns a lane index per item so spans in one lane never overlap. */
const packLanes = <T extends { span: Span }>(items: readonly T[]): number[] => {
  const lanes: Span[][] = [];
  return items.map((item) => {
    let lane = lanes.findIndex((l) => l.every((s) => item.span.end < s.start || item.span.start > s.end));
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane]?.push(item.span);
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
  const spanOf = (node: InfraNode): Span | undefined => {
    const idx = azsOf(graph, node.id)
      .map((az) => columns.indexOf(az))
      .filter((i) => i >= 0);
    if (idx.length === 0) return undefined;
    return { start: Math.min(...idx), end: Math.max(...idx) };
  };

  const byTier: Record<Tier, { node: InfraNode; span: Span }[]> = {
    entry: [],
    edge: [],
    compute: [],
    data: [],
    unplaced: [],
  };
  for (const node of listNodes(graph)) {
    const tier = TIER_OF[node.serviceType];
    if (!tier) continue;
    if (tier === 'entry') {
      byTier.entry.push({ node, span: fullSpan });
      continue;
    }
    const span = spanOf(node);
    if (span) byTier[tier].push({ node, span });
    else byTier.unplaced.push({ node, span: { start: 0, end: 0 } });
  }
  // Unplaced nodes flow left to right, one per column.
  byTier.unplaced = byTier.unplaced.map((item, i) => ({
    ...item,
    span: { start: i % colCount, end: i % colCount },
  }));

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
      const { x, width: w } = spanX(item.span);
      const inset = tier === 'entry' ? Math.max(0, (w - L.columnWidth) / 2) : 0;
      nodes.push({
        id: item.node.id,
        x: x + inset,
        y: top + (lanes[i] ?? 0) * (L.nodeHeight + L.rowGap),
        width: w - inset * 2,
        height: L.nodeHeight,
        securityGroupIds: securityGroupsOf(graph, item.node.id).map((sg) => sg.id),
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

  const rectOf = new Map(nodes.map((n) => [n.id, n]));
  const edges: LayoutEdge[] = [];
  for (const c of listConnections(graph)) {
    if (c.connectionType !== 'routes_to' && c.connectionType !== 'data_access') continue;
    const a = rectOf.get(c.sourceNodeId);
    const b = rectOf.get(c.targetNodeId);
    if (!a || !b) continue;
    edges.push({
      id: c.id,
      kind: c.connectionType,
      from: { x: a.x + a.width / 2, y: a.y + a.height },
      to: { x: b.x + b.width / 2, y: b.y },
    });
  }

  return { width, height: y + L.margin, columns, nodes, zones, edges, chips };
};

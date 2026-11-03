import { APP_IDS, type AppId } from '../../../domain/catalog/apps';
import { readConfig } from '../../../domain/catalog/catalog';
import { listConnections, listNodes, nodesOfType, sourcesOf } from '../../../domain/graph/graph';
import { azsOf, subnetsOf } from '../../../domain/graph/network';
import type { InfrastructureGraph, NodeId } from '../../../domain/graph/types';
import { APP_TEXT_JA } from '../../../data/i18n/ja/apps';
import { LAYOUT } from './tierLayout';

/**
 * Layered overview for drill-down (ADR 0017): the request path as one box per layer, with one
 * arrow between layers. Servers are grouped by the set of applications they run, so separated
 * apps appear as separate boxes. Each group can be opened to see its resources per AZ.
 */

export type GroupKind = 'entry' | 'lb' | 'compute' | 'database' | 'unplaced' | 'network' | 'subnet';

export interface OverviewGroup {
  /** Stable key used for navigation, e.g. `compute:orders` or `lb`. */
  readonly key: string;
  readonly kind: GroupKind;
  readonly title: string;
  readonly lines: readonly string[];
  /** Resources inside the group (for selection, highlighting and drill-down). */
  readonly nodeIds: readonly NodeId[];
}

export interface OverviewBox {
  readonly group: OverviewGroup;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OverviewEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'routes_to' | 'data_access';
}

export interface OverviewLayout {
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly OverviewBox[];
  readonly arrows: readonly {
    readonly from: { readonly x: number; readonly y: number };
    readonly to: { readonly x: number; readonly y: number };
    readonly kind: OverviewEdge['kind'];
  }[];
  readonly labels: readonly { readonly x: number; readonly y: number; readonly text: string }[];
  readonly vpc?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly label: string;
  };
}

const countByAz = (graph: InfrastructureGraph, ids: readonly NodeId[], azs: readonly string[]): string =>
  azs.map((az) => `${az} ${ids.filter((id) => azsOf(graph, id).includes(az as never)).length}`).join('・');

const usedAzs = (graph: InfrastructureGraph): string[] =>
  [
    ...new Set(
      nodesOfType(graph, 'network.subnet')
        .map((s) => readConfig(s, 'network.subnet')?.az)
        .filter(Boolean),
    ),
  ].sort() as string[];

export const buildOverviewGroups = (
  graph: InfrastructureGraph,
  options: { readonly showApps?: boolean } = {},
): OverviewGroup[] => {
  const groups: OverviewGroup[] = [];
  const azs = usedAzs(graph);
  const placed = (id: NodeId) => subnetsOf(graph, id).length > 0;

  const internet = nodesOfType(graph, 'external.internet');
  if (internet.length > 0) {
    groups.push({
      key: 'entry',
      kind: 'entry',
      title: 'Internet',
      lines: ['ユーザーからのアクセス'],
      nodeIds: internet.map((n) => n.id),
    });
  }

  const albs = nodesOfType(graph, 'lb.alb').filter((n) => placed(n.id));
  if (albs.length > 0) {
    groups.push({
      key: 'lb',
      kind: 'lb',
      title: albs.length === 1 ? `ALB ${albs[0]?.name}` : `ロードバランサー ×${albs.length}`,
      lines: albs.map((a) => {
        const cfg = readConfig(a, 'lb.alb');
        const where = subnetsOf(graph, a.id)
          .map((s) => s.name)
          .join(' / ');
        return `${albs.length > 1 ? `${a.name}: ` : ''}${cfg?.listener.toUpperCase() ?? ''}・${cfg?.scheme === 'internal' ? '内部向け' : 'インターネット向け'}・${where}`;
      }),
      nodeIds: albs.map((n) => n.id),
    });
  }

  // Servers grouped by the apps they run.
  const computes = nodesOfType(graph, 'compute.ec2', 'compute.autoscaling').filter((n) => placed(n.id));
  const byApps = new Map<string, NodeId[]>();
  for (const c of computes) {
    const apps = readConfig(c, 'compute.ec2')?.apps ?? readConfig(c, 'compute.autoscaling')?.apps ?? ['shop'];
    // Catalog order (shop before orders) for stable keys, titles and box order.
    const key = [...apps].sort((a, b) => APP_IDS.indexOf(a) - APP_IDS.indexOf(b)).join('+');
    byApps.set(key, [...(byApps.get(key) ?? []), c.id]);
  }
  const rank = (key: string) => key.split('+').map((a) => APP_IDS.indexOf(a as AppId));
  const byCatalog = ([a]: [string, NodeId[]], [b]: [string, NodeId[]]) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
      const d = (ra[i] ?? -1) - (rb[i] ?? -1);
      if (d !== 0) return d;
    }
    return 0;
  };
  for (const [appsKey, ids] of [...byApps].sort(byCatalog)) {
    // Short names keep titles inside half-width boxes when separated groups sit side by side.
    const appNames = appsKey.split('+').map((a) => APP_TEXT_JA[a as keyof typeof APP_TEXT_JA]?.short ?? a);
    const ec2 = ids.filter((id) => graph.nodes[id]?.serviceType === 'compute.ec2');
    const asgs = ids.filter((id) => graph.nodes[id]?.serviceType === 'compute.autoscaling');
    const lines: string[] = [];
    if (ec2.length > 0) lines.push(`EC2 ${ec2.length}台（${countByAz(graph, ec2, azs)}）`);
    for (const id of asgs) {
      const cfg = readConfig(graph.nodes[id], 'compute.autoscaling');
      lines.push(
        `ASG ${graph.nodes[id]?.name ?? id} ${cfg?.minCapacity}〜${cfg?.maxCapacity}台（${azsOf(graph, id).join('・')}）`,
      );
    }
    groups.push({
      key: `compute:${appsKey}`,
      kind: 'compute',
      title: options.showApps ? `サーバー（${appNames.join('・')}）` : 'サーバー',
      lines,
      nodeIds: ids,
    });
  }

  const dbs = nodesOfType(graph, 'database.rds').filter((n) => placed(n.id));
  if (dbs.length > 0) {
    groups.push({
      key: 'database',
      kind: 'database',
      title: dbs.length === 1 ? `RDS ${dbs[0]?.name}` : `データベース ×${dbs.length}`,
      lines: dbs.map((d) => {
        const cfg = readConfig(d, 'database.rds');
        const dazs = azsOf(graph, d.id);
        const redundancy = cfg?.multiAz
          ? `Multi-AZ（${dazs.slice(0, 2).join('・')}）`
          : `単一AZ（${dazs[0] ?? '?'}）`;
        return `${dbs.length > 1 ? `${d.name}: ` : ''}${cfg?.instanceClass ?? ''}・${redundancy}`;
      }),
      nodeIds: dbs.map((n) => n.id),
    });
  }

  const unplaced = listNodes(graph).filter(
    (n) =>
      ['lb.alb', 'compute.ec2', 'compute.autoscaling', 'database.rds'].includes(n.serviceType) &&
      !placed(n.id),
  );
  if (unplaced.length > 0) {
    groups.push({
      key: 'unplaced',
      kind: 'unplaced',
      title: '配置先が未設定',
      lines: [unplaced.map((n) => n.name).join('、')],
      nodeIds: unplaced.map((n) => n.id),
    });
  }

  const vpcs = nodesOfType(graph, 'network.vpc');
  const subnets = nodesOfType(graph, 'network.subnet');
  const sgs = nodesOfType(graph, 'network.security_group');
  const others = nodesOfType(graph, 'monitoring.cloudwatch');
  if (vpcs.length + subnets.length + sgs.length + others.length > 0) {
    const pub = subnets.filter((s) => readConfig(s, 'network.subnet')?.tier === 'public').length;
    groups.push({
      key: 'network',
      kind: 'network',
      title: 'ネットワーク・セキュリティ',
      lines: [
        `${vpcs.map((v) => v.name).join('・') || 'VPC なし'}：サブネット ${subnets.length}（パブリック ${pub}・プライベート ${subnets.length - pub}）`,
        `${azs.length > 0 ? `${azs.join(' / ')}・` : ''}セキュリティグループ ${sgs.length}${others.length > 0 ? `・CloudWatch ${others.length}` : ''}`,
      ],
      nodeIds: [...vpcs, ...subnets, ...sgs, ...others].map((n) => n.id),
    });
  }
  // One card per subnet (public before private, then by AZ): drill down to what is placed in it.
  const ordered = [...subnets].sort((a, b) => {
    const ca = readConfig(a, 'network.subnet');
    const cb = readConfig(b, 'network.subnet');
    const ta = ca?.tier === 'public' ? 0 : 1;
    const tb = cb?.tier === 'public' ? 0 : 1;
    return ta - tb || ((ca?.az ?? '') < (cb?.az ?? '') ? -1 : 1);
  });
  for (const subnet of ordered) {
    const cfg = readConfig(subnet, 'network.subnet');
    const residents = sourcesOf(graph, subnet.id, 'placed_in').filter(
      (n) => n.serviceType !== 'network.subnet',
    );
    const count = (...types: string[]) => residents.filter((n) => types.includes(n.serviceType)).length;
    const parts = [
      count('lb.alb') ? `ALB ${count('lb.alb')}` : '',
      count('compute.ec2') ? `EC2 ${count('compute.ec2')}` : '',
      count('compute.autoscaling') ? `ASG ${count('compute.autoscaling')}` : '',
      count('database.rds') ? `RDS ${count('database.rds')}` : '',
    ].filter(Boolean);
    groups.push({
      key: `subnet:${subnet.id}`,
      kind: 'subnet',
      title: subnet.name,
      lines: [
        `${cfg?.az ?? '?'}・${cfg?.tier === 'public' ? 'パブリック' : 'プライベート'}`,
        parts.length > 0 ? parts.join('・') : 'なし',
      ],
      nodeIds: [subnet.id, ...residents.map((n) => n.id)],
    });
  }
  return groups;
};

/** Traffic between groups (one arrow per pair). */
export const overviewEdges = (
  graph: InfrastructureGraph,
  groups: readonly OverviewGroup[],
): OverviewEdge[] => {
  const groupOf = new Map<NodeId, string>();
  // Subnet cards are another way to slice the same resources; traffic is drawn between layers only.
  for (const g of groups) if (g.kind !== 'subnet') for (const id of g.nodeIds) groupOf.set(id, g.key);
  const seen = new Set<string>();
  const out: OverviewEdge[] = [];
  for (const c of listConnections(graph)) {
    if (c.connectionType !== 'routes_to' && c.connectionType !== 'data_access') continue;
    const from = groupOf.get(c.sourceNodeId);
    const to = groupOf.get(c.targetNodeId);
    if (!from || !to || from === to) continue;
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to, kind: c.connectionType });
  }
  return out;
};

/** The layer a resource belongs to (subnet cards are a different slice, not layers). */
export const groupContaining = (
  groups: readonly OverviewGroup[],
  nodeId: NodeId,
): OverviewGroup | undefined => groups.find((g) => g.kind !== 'subnet' && g.nodeIds.includes(nodeId));

const ROW_ORDER: readonly GroupKind[] = [
  'entry',
  'lb',
  'compute',
  'database',
  'unplaced',
  'network',
  'subnet',
];

/** Rows top → bottom; groups in one row sit side by side. Width matches the detailed diagram. */
export const layoutOverview = (
  graph: InfrastructureGraph,
  groups: readonly OverviewGroup[],
  width = 376,
  options: { readonly statusLine?: boolean } = {},
): OverviewLayout => {
  const L = LAYOUT;
  const lineH = 15;
  const gap = 10;
  const rowGap = 34;
  const boxes: OverviewBox[] = [];
  const labels: { x: number; y: number; text: string }[] = [];
  let y = L.margin;
  let vpcTop: number | undefined;
  let vpcBottom = y;
  for (const kind of ROW_ORDER) {
    const row = groups.filter((g) => g.kind === kind);
    if (row.length === 0) continue;
    if (kind === 'network') y += 10;
    if (kind === 'subnet') {
      labels.push({ x: L.margin, y: y + 4, text: 'サブネットごとに見る' });
      y += 14;
    }
    if (kind === 'subnet') {
      // Grid: columns are AZs, rows are public then private (extra subnets of a cell wrap to a new row).
      const cfgOf = (g: OverviewGroup) => readConfig(graph.nodes[g.nodeIds[0] ?? ''], 'network.subnet');
      const zones = [...new Set(row.map((g) => cfgOf(g)?.az ?? ''))].sort();
      const cols = Math.max(1, zones.length);
      const cellW = (width - L.margin * 2 - gap * (cols - 1)) / cols;
      const cellH = 44 + 2 * lineH + (options.statusLine ? lineH + 2 : 0);
      const grid: (OverviewGroup | undefined)[][] = [];
      for (const tier of ['public', 'private'] as const) {
        const tierRows: (OverviewGroup | undefined)[][] = [];
        for (const g of row.filter((x) => (cfgOf(x)?.tier ?? 'private') === tier)) {
          const col = Math.max(0, zones.indexOf(cfgOf(g)?.az ?? ''));
          let target = tierRows.find((cells) => cells[col] === undefined);
          if (!target) {
            target = Array.from({ length: cols }, () => undefined);
            tierRows.push(target);
          }
          target[col] = g;
        }
        grid.push(...tierRows);
      }
      grid.forEach((cells, r) =>
        cells.forEach((g, c) => {
          if (g)
            boxes.push({
              group: g,
              x: L.margin + c * (cellW + gap),
              y: y + r * (cellH + gap),
              width: cellW,
              height: cellH,
            });
        }),
      );
      y += grid.length * (cellH + gap) - gap + rowGap;
      continue;
    }
    const inside = kind === 'lb' || kind === 'compute' || kind === 'database' || kind === 'unplaced';
    if (inside && vpcTop === undefined) {
      vpcTop = y - 14;
      y += 8;
    }
    const usable = width - L.margin * 2 - (inside ? 12 : 0);
    const boxW = (usable - gap * (row.length - 1)) / row.length;
    const extra = options.statusLine && kind !== 'network' && kind !== 'entry' ? lineH + 2 : 0;
    const h = Math.max(...row.map((g) => 44 + g.lines.length * lineH)) + extra;
    row.forEach((g, i) => {
      const narrow = kind === 'entry';
      const w = narrow ? Math.min(boxW, 160) : boxW;
      const x0 = L.margin + (inside ? 6 : 0) + i * (boxW + gap) + (narrow ? (boxW - w) / 2 : 0);
      boxes.push({ group: g, x: x0, y, width: w, height: narrow ? 44 + g.lines.length * lineH : h });
    });
    y += h + rowGap;
    if (inside) vpcBottom = y - rowGap + 12;
  }
  const centerTop = (b: OverviewBox) => ({ x: b.x + b.width / 2, y: b.y });
  const centerBottom = (b: OverviewBox) => ({ x: b.x + b.width / 2, y: b.y + b.height });
  const byKey = new Map(boxes.map((b) => [b.group.key, b]));
  const arrows = overviewEdges(graph, groups).flatMap((e) => {
    const a = byKey.get(e.from);
    const b = byKey.get(e.to);
    if (!a || !b) return [];
    return [{ from: centerBottom(a), to: centerTop(b), kind: e.kind }];
  });
  const vpcName = nodesOfType(graph, 'network.vpc')
    .map((v) => v.name)
    .join(' / ');
  return {
    width,
    height: y - rowGap + L.margin + 10,
    boxes,
    arrows,
    labels,
    ...(vpcTop !== undefined && vpcName
      ? {
          vpc: {
            x: L.margin / 2,
            y: vpcTop,
            width: width - L.margin,
            height: vpcBottom - vpcTop,
            label: vpcName,
          },
        }
      : {}),
  };
};

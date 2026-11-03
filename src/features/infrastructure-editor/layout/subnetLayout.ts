import { readConfig } from '../../../domain/catalog/catalog';
import { nodesOfType, sourcesOf } from '../../../domain/graph/graph';
import { azsOf } from '../../../domain/graph/network';
import type { InfrastructureGraph, NodeId } from '../../../domain/graph/types';
import type { PartRole } from './tierLayout';

/**
 * Subnet drill-down (ADR 0017 extension): the resources placed in a subnet side by side, so a server
 * and a database in the same subnet sit next to each other. No traffic arrows here; the request path lives in the overview.
 */

export interface AzSubnetZone {
  readonly subnetId: NodeId;
  readonly label: string;
  readonly tier: 'public' | 'private';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AzResourceBox {
  readonly id: NodeId;
  /** Unique per drawn box (a resource placed in two subnets of the AZ appears in each). */
  readonly key: string;
  readonly role: PartRole;
  readonly subnetId: NodeId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AzLayout {
  readonly width: number;
  readonly height: number;
  readonly subnets: readonly AzSubnetZone[];
  readonly resources: readonly AzResourceBox[];
}

const ORDER: Record<string, number> = {
  'lb.alb': 0,
  'compute.ec2': 1,
  'compute.autoscaling': 1,
  'database.rds': 2,
};

/** Subnet drill-down: draw the given subnets (one, normally) with the resources placed in each side by side. */
export const layoutSubnets = (
  graph: InfrastructureGraph,
  subnetIds: readonly NodeId[],
  options: { readonly width?: number; readonly boxHeight?: number } = {},
): AzLayout => {
  const width = options.width ?? 376;
  const boxH = options.boxHeight ?? 64;
  const margin = 12;
  const pad = 8;
  const gap = 8;
  const header = 22;
  const cols = 2;
  const boxW = (width - margin * 2 - pad * 2 - gap * (cols - 1)) / cols;

  const subnets = nodesOfType(graph, 'network.subnet')
    .filter((s) => subnetIds.includes(s.id))
    .sort((a, b) => {
      const ta = readConfig(a, 'network.subnet')?.tier === 'public' ? 0 : 1;
      const tb = readConfig(b, 'network.subnet')?.tier === 'public' ? 0 : 1;
      return ta - tb || (a.name < b.name ? -1 : 1);
    });

  const zones: AzSubnetZone[] = [];
  const boxes: AzResourceBox[] = [];
  let y = margin;
  for (const subnet of subnets) {
    const residents = sourcesOf(graph, subnet.id, 'placed_in')
      .filter((n) => n.serviceType in ORDER)
      .sort(
        (a, b) => (ORDER[a.serviceType] ?? 9) - (ORDER[b.serviceType] ?? 9) || (a.name < b.name ? -1 : 1),
      );
    const rows = Math.max(1, Math.ceil(residents.length / cols));
    const height = header + rows * boxH + (rows - 1) * gap + pad + (residents.length === 0 ? -boxH + 22 : 0);
    zones.push({
      subnetId: subnet.id,
      label: subnet.name,
      tier: readConfig(subnet, 'network.subnet')?.tier ?? 'private',
      x: margin,
      y,
      width: width - margin * 2,
      height,
    });
    const az = readConfig(subnet, 'network.subnet')?.az;
    residents.forEach((n, i) => {
      const rds = readConfig(n, 'database.rds');
      const role: PartRole = rds
        ? rds.multiAz && azsOf(graph, n.id)[1] === az
          ? 'standby'
          : 'primary'
        : n.serviceType === 'lb.alb'
          ? 'single'
          : 'zonal';
      boxes.push({
        id: n.id,
        key: `${n.id}@${subnet.id}`,
        role,
        subnetId: subnet.id,
        x: margin + pad + (i % cols) * (boxW + gap),
        y: y + header + Math.floor(i / cols) * (boxH + gap),
        width: boxW,
        height: boxH,
      });
    });
    y += height + 12;
  }
  return { width, height: y + margin - 12, subnets: zones, resources: boxes };
};

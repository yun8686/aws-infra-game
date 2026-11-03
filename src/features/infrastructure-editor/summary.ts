import { readConfig } from '../../domain/catalog/catalog';
import type { AvailabilityZone, SecurityGroupRule } from '../../domain/catalog/services';
import { sourcesOf, targetsOf, incoming, outgoing } from '../../domain/graph/graph';
import { azsOf, securityGroupsOf, subnetsOf } from '../../domain/graph/network';
import type { InfrastructureGraph, NodeId } from '../../domain/graph/types';
import type { PartRole } from './layout/tierLayout';
import { BALANCE } from '../../domain/simulation/balance';

/**
 * Plain-language summaries of a resource's key settings, so the diagram and the sheet show
 * what is configured without opening every form. Presentation only; numbers come from config.
 */

/** One short line for a drawn part of a resource. */
export const partSummary = (
  graph: InfrastructureGraph,
  nodeId: NodeId,
  part: { readonly role: PartRole; readonly az?: AvailabilityZone | undefined },
): string => {
  const node = graph.nodes[nodeId];
  if (!node) return '';
  const ec2 = readConfig(node, 'compute.ec2');
  if (ec2) return `${ec2.instanceSize}・${BALANCE.instance[ec2.instanceSize].capacityRps} rps`;
  const asg = readConfig(node, 'compute.autoscaling');
  if (asg) return `${asg.instanceSize}・${asg.minCapacity}〜${asg.maxCapacity}台`;
  const rds = readConfig(node, 'database.rds');
  if (rds) {
    if (part.role === 'standby') return 'スタンバイ';
    return `${rds.instanceClass}・${rds.multiAz ? 'プライマリ' : '単一AZ'}`;
  }
  const alb = readConfig(node, 'lb.alb');
  if (alb)
    return `${alb.listener.toUpperCase()}・${alb.scheme === 'internal' ? '内部向け' : 'インターネット向け'}`;
  return '';
};

const portText = (port: SecurityGroupRule['port']): string =>
  port === 'all'
    ? 'すべてのポート'
    : port === 80
      ? 'HTTP(80)'
      : port === 443
        ? 'HTTPS(443)'
        : port === 5432
          ? 'DB(5432)'
          : `ポート${port}`;

export const ruleText = (graph: InfrastructureGraph, rule: SecurityGroupRule): string => {
  const src =
    rule.source.kind === 'anywhere'
      ? 'どこからでも'
      : rule.source.kind === 'vpc'
        ? '同じVPC内'
        : `SG ${graph.nodes[rule.source.nodeId]?.name ?? rule.source.nodeId}`;
  return `${portText(rule.port)} ← ${src}`;
};

export interface OverviewLine {
  readonly label: string;
  readonly value: string;
}

const names = (graph: InfrastructureGraph, ids: readonly NodeId[]) =>
  ids.map((id) => graph.nodes[id]?.name ?? id).join('、');

/** What the resource is connected to and how it is protected, as label/value lines. */
export const describeNode = (graph: InfrastructureGraph, nodeId: NodeId): OverviewLine[] => {
  const node = graph.nodes[nodeId];
  if (!node) return [];
  const out: OverviewLine[] = [];

  const subnets = subnetsOf(graph, nodeId);
  if (subnets.length > 0) {
    out.push({
      label: '配置',
      value: subnets
        .map((s) => {
          const cfg = readConfig(s, 'network.subnet');
          return `${s.name}（${cfg?.az ?? '?'}・${cfg?.tier === 'public' ? 'パブリック' : 'プライベート'}）`;
        })
        .join('、'),
    });
  }
  const vpc = targetsOf(graph, nodeId, 'placed_in').filter((n) => n.serviceType === 'network.vpc');
  if (vpc.length > 0)
    out.push({
      label: 'VPC',
      value: names(
        graph,
        vpc.map((v) => v.id),
      ),
    });

  const ec2 = readConfig(node, 'compute.ec2');
  if (ec2) {
    const size = BALANCE.instance[ec2.instanceSize];
    out.push({
      label: 'サーバー',
      value: `1台・${ec2.instanceSize}（処理能力 ${size.capacityRps} rps・${size.costPerHour} cr/時）。故障しても自動では復旧しません`,
    });
  }
  const asg = readConfig(node, 'compute.autoscaling');
  if (asg) {
    out.push({
      label: '台数',
      value: `最小${asg.minCapacity}〜最大${asg.maxCapacity}台（開始${asg.desiredCapacity}台、CPU ${asg.targetCpuPct}%を目安に増減）`,
    });
  }
  const rds = readConfig(node, 'database.rds');
  if (rds) {
    const azs = azsOf(graph, nodeId);
    out.push({
      label: '冗長化',
      value: rds.multiAz
        ? `Multi-AZ（プライマリ ${azs[0] ?? '?'}、スタンバイ ${azs[1] ?? '?'}）`
        : `単一AZ（${azs[0] ?? '?'}）`,
    });
  }

  const sgs = securityGroupsOf(graph, nodeId);
  if (sgs.length > 0) {
    out.push({
      label: '保護',
      value: sgs
        .map((sg) => {
          const rules = readConfig(sg, 'network.security_group')?.inboundRules ?? [];
          return `${sg.name}（${rules.length > 0 ? rules.map((r) => ruleText(graph, r)).join('／') : '受信ルールなし'}）`;
        })
        .join('、'),
    });
  }
  const from = sourcesOf(graph, nodeId, 'routes_to');
  if (from.length > 0)
    out.push({
      label: 'リクエスト元',
      value: names(
        graph,
        from.map((n) => n.id),
      ),
    });
  const to = targetsOf(graph, nodeId, 'routes_to');
  if (to.length > 0)
    out.push({
      label: '転送先',
      value: names(
        graph,
        to.map((n) => n.id),
      ),
    });
  const db = outgoing(graph, nodeId, 'data_access');
  if (db.length > 0) {
    out.push({
      label: 'データベース',
      value: db
        .map(
          (c) =>
            `${graph.nodes[c.targetNodeId]?.name ?? c.targetNodeId}（プール ${(c.config as { poolSize?: number } | undefined)?.poolSize ?? '?'}）`,
        )
        .join('、'),
    });
  }
  const clients = incoming(graph, nodeId, 'data_access');
  if (clients.length > 0)
    out.push({
      label: '利用元',
      value: names(
        graph,
        clients.map((c) => c.sourceNodeId),
      ),
    });

  if (node.serviceType === 'network.security_group') {
    const rules = readConfig(node, 'network.security_group')?.inboundRules ?? [];
    out.push({
      label: '受信ルール',
      value: rules.length > 0 ? rules.map((r) => ruleText(graph, r)).join('／') : 'なし（すべて拒否）',
    });
    const users = sourcesOf(graph, nodeId, 'secured_by');
    out.push({
      label: '適用先',
      value:
        users.length > 0
          ? names(
              graph,
              users.map((n) => n.id),
            )
          : 'なし',
    });
  }
  if (node.serviceType === 'network.subnet') {
    const residents = sourcesOf(graph, nodeId, 'placed_in');
    out.push({
      label: '配置されているもの',
      value:
        residents.length > 0
          ? names(
              graph,
              residents.map((n) => n.id),
            )
          : 'なし',
    });
  }
  return out;
};

/** Nodes to emphasise when a resource is selected: its security groups and subnets (or users, for an SG). */
export const relatedNodeIds = (graph: InfrastructureGraph, nodeId: NodeId): Set<NodeId> => {
  const node = graph.nodes[nodeId];
  if (!node) return new Set();
  if (node.serviceType === 'network.security_group')
    return new Set(sourcesOf(graph, nodeId, 'secured_by').map((n) => n.id));
  return new Set([...securityGroupsOf(graph, nodeId), ...subnetsOf(graph, nodeId)].map((n) => n.id));
};

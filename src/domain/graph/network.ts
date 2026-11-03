import type { AvailabilityZone, SecurityGroupRule } from '../catalog/services';
import { getServiceDefinition, readConfig } from '../catalog/catalog';
import { incoming, nodesOfType, sourcesOf, targetsOf } from './graph';
import type { InfraNode, InfrastructureGraph, NodeId } from './types';

/** Subnets a node is placed in (only valid subnet nodes). */
export const subnetsOf = (graph: InfrastructureGraph, nodeId: NodeId): InfraNode[] =>
  targetsOf(graph, nodeId, 'placed_in').filter((n) => n.serviceType === 'network.subnet');

/** All VPC ids a node belongs to (normally 0 or 1; more indicates a mixed-VPC placement error). */
export const vpcIdsOf = (graph: InfrastructureGraph, nodeId: NodeId): NodeId[] => {
  const node = graph.nodes[nodeId];
  if (!node) return [];
  if (node.serviceType === 'network.vpc') return [node.id];
  const direct = targetsOf(graph, nodeId, 'placed_in');
  const ids = new Set<NodeId>();
  for (const parent of direct) {
    if (parent.serviceType === 'network.vpc') ids.add(parent.id);
    else if (parent.serviceType === 'network.subnet') {
      for (const vpc of targetsOf(graph, parent.id, 'placed_in')) {
        if (vpc.serviceType === 'network.vpc') ids.add(vpc.id);
      }
    }
  }
  return [...ids].sort();
};

export const azsOf = (graph: InfrastructureGraph, nodeId: NodeId): AvailabilityZone[] => {
  const azs = new Set<AvailabilityZone>();
  for (const s of subnetsOf(graph, nodeId)) {
    const cfg = readConfig(s, 'network.subnet');
    if (cfg) azs.add(cfg.az);
  }
  return [...azs].sort();
};

export const subnetTiersOf = (graph: InfrastructureGraph, nodeId: NodeId): ('public' | 'private')[] =>
  subnetsOf(graph, nodeId)
    .map((s) => readConfig(s, 'network.subnet')?.tier)
    .filter((t): t is 'public' | 'private' => t !== undefined);

export const securityGroupsOf = (graph: InfrastructureGraph, nodeId: NodeId): InfraNode[] =>
  targetsOf(graph, nodeId, 'secured_by').filter((n) => n.serviceType === 'network.security_group');

/** The port a node accepts inbound traffic on, if it is a traffic target. */
export const inboundPortOf = (node: InfraNode): number | undefined => {
  const def = getServiceDefinition(node.serviceType);
  if (!def?.inboundPort) return undefined;
  const parsed = def.configSchema.safeParse(node.config);
  return parsed.success ? def.inboundPort(parsed.data) : undefined;
};

const ruleMatchesPort = (rule: SecurityGroupRule, port: number): boolean =>
  rule.port === 'all' || rule.port === port;

const ruleAllowsSource = (
  graph: InfrastructureGraph,
  rule: SecurityGroupRule,
  sg: InfraNode,
  source: InfraNode,
): boolean => {
  switch (rule.source.kind) {
    case 'anywhere':
      return true;
    case 'vpc': {
      if (source.serviceType === 'external.internet') return false;
      const sgVpcs = vpcIdsOf(graph, sg.id);
      return vpcIdsOf(graph, source.id).some((v) => sgVpcs.includes(v));
    }
    case 'security_group': {
      const ref = rule.source.nodeId;
      return securityGroupsOf(graph, source.id).some((g) => g.id === ref);
    }
  }
};

/**
 * Whether inbound traffic from `source` to `target` is allowed by the target's security groups.
 * A target with no security group receives no inbound traffic.
 */
export const isTrafficAllowed = (graph: InfrastructureGraph, sourceId: NodeId, targetId: NodeId): boolean => {
  const source = graph.nodes[sourceId];
  const target = graph.nodes[targetId];
  if (!source || !target) return false;
  const port = inboundPortOf(target);
  if (port === undefined) return false;
  return securityGroupsOf(graph, targetId).some((sg) => {
    const cfg = readConfig(sg, 'network.security_group');
    return (
      cfg?.inboundRules.some((r) => ruleMatchesPort(r, port) && ruleAllowsSource(graph, r, sg, source)) ??
      false
    );
  });
};

/** Node ids reachable from Internet nodes along `routes_to`, in BFS order. */
export const reachableFromInternet = (graph: InfrastructureGraph): Set<NodeId> => {
  const seen = new Set<NodeId>();
  const queue = nodesOfType(graph, 'external.internet').map((n) => n.id);
  while (queue.length > 0) {
    const id = queue.shift() as NodeId;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of targetsOf(graph, id, 'routes_to')) queue.push(next.id);
  }
  return seen;
};

export const hasIncomingTraffic = (graph: InfrastructureGraph, nodeId: NodeId): boolean =>
  incoming(graph, nodeId, 'routes_to').length > 0 || sourcesOf(graph, nodeId, 'data_access').length > 0;

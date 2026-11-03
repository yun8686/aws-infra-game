import { getConnectionDefinition, getServiceDefinition, readConfig } from '../catalog/catalog';
import { CONNECTION_TYPES } from '../catalog/ids';
import { listConnections, listNodes, outgoing, sourcesOf } from '../graph/graph';
import { azsOf, securityGroupsOf, subnetTiersOf, vpcIdsOf } from '../graph/network';
import type { InfraNode, InfrastructureGraph } from '../graph/types';
import { finding, type Finding } from './findings';

/** Duplicate edges (same source, target and type). */
export const duplicateFindings = (graph: InfrastructureGraph): Finding[] => {
  const seen = new Map<string, string>();
  const out: Finding[] = [];
  for (const c of listConnections(graph)) {
    const key = `${c.connectionType}|${c.sourceNodeId}|${c.targetNodeId}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, c.id);
    else
      out.push(
        finding('connection.duplicate', 'error', 'connection', {
          connectionIds: [first, c.id],
          nodeIds: [c.sourceNodeId, c.targetNodeId],
        }),
      );
  }
  return out;
};

/** Per-source cardinality limits on non-placement connection types. */
export const cardinalityFindings = (graph: InfrastructureGraph, node: InfraNode): Finding[] => {
  const out: Finding[] = [];
  for (const type of CONNECTION_TYPES) {
    const max = getConnectionDefinition(type)?.maxOutgoingPerSource;
    if (max === undefined) continue;
    const conns = outgoing(graph, node.id, type);
    if (conns.length > max) {
      out.push(
        finding(
          'connection.too_many',
          'error',
          'connection',
          {
            nodeIds: [node.id],
            connectionIds: conns.map((c) => c.id),
          },
          { params: { connectionType: type, max } },
        ),
      );
    }
  }
  return out;
};

export interface PlacementCheckOptions {
  /** Skip checks that only make sense for a finished graph (missing placement, AZ spread). */
  readonly incremental?: boolean;
}

/** Placement rules for a single node. */
export const nodePlacementFindings = (
  graph: InfrastructureGraph,
  node: InfraNode,
  options: PlacementCheckOptions = {},
): Finding[] => {
  const def = getServiceDefinition(node.serviceType);
  if (!def) return [];
  const out: Finding[] = [];
  const placementConns = outgoing(graph, node.id, 'placed_in');
  const refs = { nodeIds: [node.id], connectionIds: placementConns.map((c) => c.id) };

  if (def.placement) {
    if (!options.incremental && placementConns.length < def.placement.min) {
      out.push(
        finding('placement.missing', 'error', 'placement', refs, {
          params: { targetType: def.placement.targets.join(',') },
        }),
      );
    }
    if (placementConns.length > def.placement.max) {
      out.push(
        finding('placement.too_many', 'error', 'placement', refs, { params: { max: def.placement.max } }),
      );
    }
  }

  const vpcs = vpcIdsOf(graph, node.id);
  if (vpcs.length > 1)
    out.push(finding('placement.mixed_vpc', 'error', 'placement', { nodeIds: [node.id, ...vpcs] }));

  const sgs = securityGroupsOf(graph, node.id);
  for (const sg of sgs) {
    const sgVpcs = vpcIdsOf(graph, sg.id);
    if (vpcs.length === 1 && sgVpcs.length === 1 && vpcs[0] !== sgVpcs[0]) {
      out.push(
        finding('placement.security_group_vpc_mismatch', 'error', 'placement', { nodeIds: [node.id, sg.id] }),
      );
    }
  }

  if (options.incremental) return out;

  if (node.serviceType === 'lb.alb' && placementConns.length > 0 && azsOf(graph, node.id).length < 2) {
    out.push(finding('placement.alb_requires_two_azs', 'error', 'placement', refs));
  }
  if (node.serviceType === 'lb.alb') {
    const cfg = readConfig(node, 'lb.alb');
    if (cfg?.scheme === 'internet-facing' && subnetTiersOf(graph, node.id).includes('private')) {
      out.push(finding('placement.internet_facing_requires_public_subnet', 'error', 'placement', refs));
    }
  }
  if (node.serviceType === 'database.rds') {
    const cfg = readConfig(node, 'database.rds');
    if (cfg?.multiAz && azsOf(graph, node.id).length < 2) {
      out.push(finding('placement.rds_multi_az_requires_two_azs', 'error', 'placement', refs));
    }
  }
  if (node.serviceType === 'compute.ec2') {
    const fromInternet = sourcesOf(graph, node.id, 'routes_to').some(
      (s) => s.serviceType === 'external.internet',
    );
    if (fromInternet && subnetTiersOf(graph, node.id).includes('private')) {
      out.push(finding('placement.internet_target_requires_public_subnet', 'error', 'placement', refs));
    }
  }
  return out;
};

export const placementFindings = (graph: InfrastructureGraph): Finding[] =>
  listNodes(graph).flatMap((n) => [...nodePlacementFindings(graph, n), ...cardinalityFindings(graph, n)]);

import { getServiceDefinition, readConfig } from '../catalog/catalog';
import { COMPUTE_TYPES, SECURABLE_TYPES, SERVICE_TYPES } from '../catalog/ids';
import { incoming, listNodes, nodesOfType, outgoing, sourcesOf } from '../graph/graph';
import { isTrafficAllowed, reachableFromInternet, securityGroupsOf } from '../graph/network';
import type { InfrastructureGraph } from '../graph/types';
import { finding, type Finding } from './findings';

export const dependencyFindings = (graph: InfrastructureGraph): Finding[] => {
  const out: Finding[] = [];
  const internets = nodesOfType(graph, 'external.internet');

  if (internets.length === 0) out.push(finding('entry.missing', 'error', 'dependency'));
  if (internets.length > 1)
    out.push(finding('entry.multiple', 'error', 'dependency', { nodeIds: internets.map((n) => n.id) }));

  for (const type of SERVICE_TYPES) {
    const max = getServiceDefinition(type)?.maxPerGraph;
    const nodes = nodesOfType(graph, type);
    if (max !== undefined && nodes.length > max && type !== 'external.internet') {
      out.push(
        finding(
          'graph.max_per_graph',
          'error',
          'dependency',
          { nodeIds: nodes.map((n) => n.id) },
          {
            params: { serviceType: type, max },
          },
        ),
      );
    }
  }

  const reachable = reachableFromInternet(graph);
  const computes = nodesOfType(graph, ...COMPUTE_TYPES);

  if (internets.length > 0 && !computes.some((c) => reachable.has(c.id))) {
    out.push(
      finding('dependency.no_request_path', 'error', 'dependency', { nodeIds: internets.map((n) => n.id) }),
    );
  }

  for (const internet of internets) {
    for (const c of outgoing(graph, internet.id, 'routes_to')) {
      const target = graph.nodes[c.targetNodeId];
      if (readConfig(target, 'lb.alb')?.scheme === 'internal') {
        out.push(
          finding('dependency.internal_alb_from_internet', 'error', 'dependency', {
            nodeIds: [c.targetNodeId],
            connectionIds: [c.id],
          }),
        );
      }
    }
  }

  for (const alb of nodesOfType(graph, 'lb.alb')) {
    if (outgoing(graph, alb.id, 'routes_to').length === 0) {
      out.push(finding('dependency.alb_no_targets', 'warning', 'dependency', { nodeIds: [alb.id] }));
    }
    if (!reachable.has(alb.id)) {
      out.push(finding('dependency.orphaned_resource', 'warning', 'dependency', { nodeIds: [alb.id] }));
    }
  }

  for (const compute of computes) {
    if (!reachable.has(compute.id)) {
      out.push(finding('dependency.unreachable_compute', 'warning', 'dependency', { nodeIds: [compute.id] }));
    }
  }

  for (const db of nodesOfType(graph, 'database.rds')) {
    if (!sourcesOf(graph, db.id, 'data_access').some((s) => reachable.has(s.id))) {
      out.push(finding('dependency.orphaned_resource', 'warning', 'dependency', { nodeIds: [db.id] }));
    }
  }

  for (const node of nodesOfType(graph, ...SECURABLE_TYPES)) {
    if (securityGroupsOf(graph, node.id).length === 0) {
      out.push(finding('dependency.no_security_group', 'warning', 'dependency', { nodeIds: [node.id] }));
    }
  }

  const trafficConns = listNodes(graph).flatMap((n) => [
    ...incoming(graph, n.id, 'routes_to'),
    ...incoming(graph, n.id, 'data_access'),
  ]);
  for (const c of trafficConns) {
    if (securityGroupsOf(graph, c.targetNodeId).length === 0) continue; // reported as no_security_group
    if (!isTrafficAllowed(graph, c.sourceNodeId, c.targetNodeId)) {
      out.push(
        finding('dependency.traffic_blocked_by_security_group', 'warning', 'dependency', {
          nodeIds: [c.sourceNodeId, c.targetNodeId],
          connectionIds: [c.id],
        }),
      );
    }
  }

  for (const sg of nodesOfType(graph, 'network.security_group')) {
    const cfg = readConfig(sg, 'network.security_group');
    for (const rule of cfg?.inboundRules ?? []) {
      if (rule.source.kind !== 'security_group') continue;
      const ref = graph.nodes[rule.source.nodeId];
      if (ref?.serviceType !== 'network.security_group') {
        out.push(
          finding(
            'dependency.security_group_rule_dangling_reference',
            'error',
            'dependency',
            {
              nodeIds: [sg.id],
            },
            { params: { referencedNodeId: rule.source.nodeId } },
          ),
        );
      }
    }
  }
  return out;
};

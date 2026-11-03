import { readConfig } from '../catalog/catalog';
import { PORTS } from '../catalog/ids';
import { nodesOfType, outgoing } from '../graph/graph';
import { securityGroupsOf, subnetTiersOf } from '../graph/network';
import type { InfrastructureGraph } from '../graph/types';
import { finding, type Finding } from './findings';

const isAdminPort = (port: number | 'all'): boolean =>
  port !== 'all' && (PORTS.admin as readonly number[]).includes(port);

export const securityFindings = (graph: InfrastructureGraph): Finding[] => {
  const out: Finding[] = [];
  const dbSgIds = new Set(
    nodesOfType(graph, 'database.rds').flatMap((db) => securityGroupsOf(graph, db.id).map((sg) => sg.id)),
  );

  for (const sg of nodesOfType(graph, 'network.security_group')) {
    const cfg = readConfig(sg, 'network.security_group');
    for (const rule of cfg?.inboundRules ?? []) {
      if (rule.source.kind !== 'anywhere') continue;
      const refs = { nodeIds: [sg.id] };
      if (rule.port === 'all') {
        out.push(
          finding('security.all_ports_open_to_internet', 'warning', 'security', refs, {
            riskLevel: 'critical',
          }),
        );
      } else if (rule.port === PORTS.database && dbSgIds.has(sg.id)) {
        out.push(
          finding('security.db_port_open_to_internet', 'warning', 'security', refs, {
            riskLevel: 'critical',
          }),
        );
      } else if (isAdminPort(rule.port)) {
        out.push(
          finding('security.admin_port_open_to_internet', 'warning', 'security', refs, {
            riskLevel: 'major',
            params: { port: rule.port },
          }),
        );
      }
    }
  }

  for (const db of nodesOfType(graph, 'database.rds')) {
    if (subnetTiersOf(graph, db.id).includes('public')) {
      out.push(
        finding(
          'security.db_in_public_subnet',
          'warning',
          'security',
          { nodeIds: [db.id] },
          { riskLevel: 'major' },
        ),
      );
    }
  }

  for (const internet of nodesOfType(graph, 'external.internet')) {
    for (const c of outgoing(graph, internet.id, 'routes_to')) {
      if (graph.nodes[c.targetNodeId]?.serviceType === 'compute.ec2') {
        out.push(
          finding(
            'security.compute_directly_exposed',
            'warning',
            'security',
            {
              nodeIds: [c.targetNodeId],
              connectionIds: [c.id],
            },
            { riskLevel: 'minor' },
          ),
        );
      }
    }
  }
  return out;
};

import { getConnectionDefinition, getServiceDefinition } from '../catalog/catalog';
import { listConnections, listNodes } from '../graph/graph';
import type { InfraConnection, InfrastructureGraph } from '../graph/types';
import { finding, type Finding } from './findings';

const firstIssuePath = (issues: readonly { path: readonly PropertyKey[] }[]): string =>
  issues[0]?.path.map(String).join('.') ?? '';

export const structureFindings = (graph: InfrastructureGraph): Finding[] => {
  const out: Finding[] = [];
  for (const [key, node] of Object.entries(graph.nodes).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (key !== node.id) out.push(finding('graph.id_mismatch', 'error', 'structure', { nodeIds: [node.id] }));
  }
  for (const [key, conn] of Object.entries(graph.connections).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (key !== conn.id)
      out.push(finding('graph.id_mismatch', 'error', 'structure', { connectionIds: [conn.id] }));
  }
  for (const node of listNodes(graph)) {
    const def = getServiceDefinition(node.serviceType);
    if (!def) {
      out.push(
        finding(
          'node.unknown_service',
          'error',
          'structure',
          { nodeIds: [node.id] },
          {
            params: { serviceType: node.serviceType },
          },
        ),
      );
      continue;
    }
    const parsed = def.configSchema.safeParse(node.config);
    if (!parsed.success) {
      out.push(
        finding(
          'node.invalid_config',
          'error',
          'config',
          { nodeIds: [node.id] },
          {
            params: {
              field: firstIssuePath(parsed.error.issues),
              reason: parsed.error.issues[0]?.message ?? '',
            },
          },
        ),
      );
    }
  }
  for (const conn of listConnections(graph)) out.push(...connectionShapeFindings(graph, conn));
  return out;
};

/**
 * Checks that depend only on the connection itself and its two endpoints.
 * Shared by graph validation and the `connect` command.
 */
export const connectionShapeFindings = (graph: InfrastructureGraph, conn: InfraConnection): Finding[] => {
  const refs = { connectionIds: [conn.id], nodeIds: [conn.sourceNodeId, conn.targetNodeId] };
  const source = graph.nodes[conn.sourceNodeId];
  const target = graph.nodes[conn.targetNodeId];
  if (!source || !target) return [finding('graph.dangling_connection', 'error', 'structure', refs)];
  const def = getConnectionDefinition(conn.connectionType);
  if (!def) {
    return [
      finding('connection.unknown_type', 'error', 'structure', refs, {
        params: { connectionType: conn.connectionType },
      }),
    ];
  }
  if (source.id === target.id) return [finding('connection.self_loop', 'error', 'connection', refs)];
  const allowed = def.allowed.some(
    (r) =>
      (r.from as readonly string[]).includes(source.serviceType) &&
      (r.to as readonly string[]).includes(target.serviceType),
  );
  if (!allowed) {
    return [
      finding('connection.not_allowed', 'error', 'connection', refs, {
        params: {
          connectionType: def.type,
          sourceType: source.serviceType,
          targetType: target.serviceType,
        },
      }),
    ];
  }
  const parsed = def.configSchema.safeParse(conn.config ?? def.defaultConfig);
  if (!parsed.success) {
    return [
      finding('connection.invalid_config', 'error', 'config', refs, {
        params: { field: firstIssuePath(parsed.error.issues), reason: parsed.error.issues[0]?.message ?? '' },
      }),
    ];
  }
  return [];
};

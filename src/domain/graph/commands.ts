import { getConnectionDefinition, getServiceDefinition } from '../catalog/catalog';
import { isServiceTypeId, type ConnectionTypeId, type ServiceTypeId } from '../catalog/ids';
import type { SecurityGroupConfig } from '../catalog/services';
import { err, ok, type Result } from '../shared/result';
import { finding, type Finding } from '../validation/findings';
import { duplicateFindings, cardinalityFindings, nodePlacementFindings } from '../validation/placement';
import { connectionShapeFindings } from '../validation/structure';
import { connectionsOf, nextConnectionId, nextNodeId, nodesOfType } from './graph';
import type { ConnectionId, InfraConnection, InfraNode, InfrastructureGraph, NodeId } from './types';

/**
 * Restrictions applied by a mission on top of the graph. Template, free-construction and sandbox
 * modes differ only in the policy they pass; the commands are identical.
 */
export interface EditPolicy {
  /** If set, only these service types may be added. */
  readonly allowedServiceTypes?: readonly ServiceTypeId[];
  /** `no-delete`: may be configured but not removed. `read-only`: neither. */
  readonly lockedNodes?: Readonly<Record<NodeId, 'no-delete' | 'read-only'>>;
}

export type CommandResult<E = Record<never, never>> = Result<
  { readonly graph: InfrastructureGraph } & E,
  readonly Finding[]
>;

const reject = (f: Finding): Result<never, readonly Finding[]> => err([f]);

const firstIssue = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) => ({
  field: issues[0]?.path.map(String).join('.') ?? '',
  reason: issues[0]?.message ?? '',
});

// ---- Nodes ------------------------------------------------------------------

export interface AddNodeInput {
  readonly serviceType: string;
  readonly name?: string;
  /** Full config; defaults are used when omitted. */
  readonly config?: unknown;
}

export const addNode = (
  graph: InfrastructureGraph,
  input: AddNodeInput,
  policy: EditPolicy = {},
): CommandResult<{ readonly nodeId: NodeId }> => {
  const def = getServiceDefinition(input.serviceType);
  if (!def) {
    return reject(
      finding('node.unknown_service', 'error', 'edit', {}, { params: { serviceType: input.serviceType } }),
    );
  }
  if (def.systemManaged) {
    return reject(finding('edit.system_managed', 'error', 'edit', {}, { params: { serviceType: def.type } }));
  }
  if (policy.allowedServiceTypes && !policy.allowedServiceTypes.includes(def.type)) {
    return reject(
      finding('edit.service_not_allowed', 'error', 'edit', {}, { params: { serviceType: def.type } }),
    );
  }
  if (def.maxPerGraph !== undefined && nodesOfType(graph, def.type).length >= def.maxPerGraph) {
    return reject(
      finding(
        'graph.max_per_graph',
        'error',
        'edit',
        {},
        { params: { serviceType: def.type, max: def.maxPerGraph } },
      ),
    );
  }
  const parsed = def.configSchema.safeParse(input.config ?? def.defaultConfig);
  if (!parsed.success) {
    return reject(
      finding('node.invalid_config', 'error', 'config', {}, { params: firstIssue(parsed.error.issues) }),
    );
  }
  const id = nextNodeId(graph, def.idPrefix);
  const node: InfraNode = { id, serviceType: def.type, name: input.name ?? id, config: parsed.data };
  return ok({ graph: { ...graph, nodes: { ...graph.nodes, [id]: node } }, nodeId: id });
};

const lockOf = (policy: EditPolicy, nodeId: NodeId) => policy.lockedNodes?.[nodeId];

export interface RemoveNodeEffects {
  readonly removedConnectionIds: readonly ConnectionId[];
  /** Security groups whose rules referencing the removed node were dropped. */
  readonly modifiedNodeIds: readonly NodeId[];
}

/**
 * Removes a node and everything that depends on it: its connections and any security-group rules
 * that reference it. Call without committing the result to preview the impact for a confirmation dialog.
 */
export const removeNode = (
  graph: InfrastructureGraph,
  nodeId: NodeId,
  policy: EditPolicy = {},
): CommandResult<RemoveNodeEffects> => {
  const node = graph.nodes[nodeId];
  if (!node) return reject(finding('edit.node_not_found', 'error', 'edit', { nodeIds: [nodeId] }));
  if (getServiceDefinition(node.serviceType)?.systemManaged) {
    return reject(finding('edit.system_managed', 'error', 'edit', { nodeIds: [nodeId] }));
  }
  if (lockOf(policy, nodeId))
    return reject(finding('edit.node_locked', 'error', 'edit', { nodeIds: [nodeId] }));

  const removedConnectionIds = connectionsOf(graph, nodeId).map((c) => c.id);
  const connections = { ...graph.connections };
  for (const id of removedConnectionIds) delete connections[id];

  const nodes: Record<NodeId, InfraNode> = { ...graph.nodes };
  delete nodes[nodeId];
  const modifiedNodeIds: NodeId[] = [];
  if (node.serviceType === 'network.security_group') {
    for (const sg of nodesOfType(graph, 'network.security_group')) {
      if (sg.id === nodeId) continue;
      const cfg = sg.config as SecurityGroupConfig;
      if (!Array.isArray(cfg?.inboundRules)) continue;
      const kept = cfg.inboundRules.filter(
        (r) => !(r.source.kind === 'security_group' && r.source.nodeId === nodeId),
      );
      if (kept.length !== cfg.inboundRules.length) {
        nodes[sg.id] = { ...sg, config: { ...cfg, inboundRules: kept } };
        modifiedNodeIds.push(sg.id);
      }
    }
  }
  return ok({ graph: { ...graph, nodes, connections }, removedConnectionIds, modifiedNodeIds });
};

export const updateNodeConfig = (
  graph: InfrastructureGraph,
  nodeId: NodeId,
  config: unknown,
  policy: EditPolicy = {},
): CommandResult => {
  const node = graph.nodes[nodeId];
  if (!node) return reject(finding('edit.node_not_found', 'error', 'edit', { nodeIds: [nodeId] }));
  if (lockOf(policy, nodeId) === 'read-only') {
    return reject(finding('edit.node_locked', 'error', 'edit', { nodeIds: [nodeId] }));
  }
  const def = getServiceDefinition(node.serviceType);
  if (!def) return reject(finding('node.unknown_service', 'error', 'edit', { nodeIds: [nodeId] }));
  const parsed = def.configSchema.safeParse(config);
  if (!parsed.success) {
    return reject(
      finding(
        'node.invalid_config',
        'error',
        'config',
        { nodeIds: [nodeId] },
        { params: firstIssue(parsed.error.issues) },
      ),
    );
  }
  return ok({ graph: { ...graph, nodes: { ...graph.nodes, [nodeId]: { ...node, config: parsed.data } } } });
};

export const renameNode = (graph: InfrastructureGraph, nodeId: NodeId, name: string): CommandResult => {
  const node = graph.nodes[nodeId];
  if (!node) return reject(finding('edit.node_not_found', 'error', 'edit', { nodeIds: [nodeId] }));
  return ok({ graph: { ...graph, nodes: { ...graph.nodes, [nodeId]: { ...node, name } } } });
};

// ---- Connections ------------------------------------------------------------

export interface ConnectInput {
  readonly sourceNodeId: NodeId;
  readonly targetNodeId: NodeId;
  readonly connectionType: ConnectionTypeId;
  readonly config?: unknown;
}

/** Findings that would make `connect` reject. Used by the editor to explain disabled targets. */
export const checkConnect = (
  graph: InfrastructureGraph,
  input: ConnectInput,
  policy: EditPolicy = {},
): Finding[] => tryConnect(graph, input, policy).findings;

const tryConnect = (
  graph: InfrastructureGraph,
  input: ConnectInput,
  policy: EditPolicy,
): { findings: Finding[]; graph?: InfrastructureGraph; connectionId?: ConnectionId } => {
  for (const id of [input.sourceNodeId, input.targetNodeId]) {
    if (!graph.nodes[id])
      return { findings: [finding('edit.node_not_found', 'error', 'edit', { nodeIds: [id] })] };
  }
  if (lockOf(policy, input.sourceNodeId) === 'read-only') {
    return { findings: [finding('edit.node_locked', 'error', 'edit', { nodeIds: [input.sourceNodeId] })] };
  }
  const def = getConnectionDefinition(input.connectionType);
  const id = nextConnectionId(graph);
  const connection: InfraConnection = {
    id,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    connectionType: input.connectionType,
    config: input.config ?? def?.defaultConfig ?? {},
  };
  const shape = connectionShapeFindings(graph, connection);
  if (shape.length > 0) return { findings: shape };

  const parsedConfig = def?.configSchema.safeParse(connection.config);
  const stored = parsedConfig?.success ? { ...connection, config: parsedConfig.data } : connection;
  const next: InfrastructureGraph = { ...graph, connections: { ...graph.connections, [id]: stored } };

  // Reject only problems introduced by this edge; finished-graph checks are left to validation.
  const source = next.nodes[input.sourceNodeId] as InfraNode;
  const introduced = [
    ...duplicateFindings(next).filter((f) => f.connectionIds.includes(id)),
    ...nodePlacementFindings(next, source, { incremental: true }),
    ...cardinalityFindings(next, source),
  ].filter((f) => f.severity === 'error');
  if (introduced.length > 0) return { findings: introduced };
  return { findings: [], graph: next, connectionId: id };
};

export const connect = (
  graph: InfrastructureGraph,
  input: ConnectInput,
  policy: EditPolicy = {},
): CommandResult<{ readonly connectionId: ConnectionId }> => {
  const result = tryConnect(graph, input, policy);
  if (!result.graph || !result.connectionId) return err(result.findings);
  return ok({ graph: result.graph, connectionId: result.connectionId });
};

export const disconnect = (
  graph: InfrastructureGraph,
  connectionId: ConnectionId,
  policy: EditPolicy = {},
): CommandResult => {
  const conn = graph.connections[connectionId];
  if (!conn)
    return reject(finding('edit.connection_not_found', 'error', 'edit', { connectionIds: [connectionId] }));
  if (lockOf(policy, conn.sourceNodeId) === 'read-only') {
    return reject(finding('edit.node_locked', 'error', 'edit', { nodeIds: [conn.sourceNodeId] }));
  }
  const connections = { ...graph.connections };
  delete connections[connectionId];
  return ok({ graph: { ...graph, connections } });
};

export const updateConnectionConfig = (
  graph: InfrastructureGraph,
  connectionId: ConnectionId,
  config: unknown,
  policy: EditPolicy = {},
): CommandResult => {
  const conn = graph.connections[connectionId];
  if (!conn)
    return reject(finding('edit.connection_not_found', 'error', 'edit', { connectionIds: [connectionId] }));
  if (lockOf(policy, conn.sourceNodeId) === 'read-only') {
    return reject(finding('edit.node_locked', 'error', 'edit', { nodeIds: [conn.sourceNodeId] }));
  }
  const def = getConnectionDefinition(conn.connectionType);
  const parsed = def?.configSchema.safeParse(config);
  if (!parsed?.success) {
    return reject(
      finding(
        'connection.invalid_config',
        'error',
        'config',
        { connectionIds: [connectionId] },
        {
          params: parsed ? firstIssue(parsed.error.issues) : { field: '', reason: '' },
        },
      ),
    );
  }
  return ok({
    graph: {
      ...graph,
      connections: { ...graph.connections, [connectionId]: { ...conn, config: parsed.data } },
    },
  });
};

export const isPlayerAddable = (type: string): boolean =>
  isServiceTypeId(type) && !getServiceDefinition(type)?.systemManaged;

export interface DuplicateNodeEffects {
  readonly nodeId: NodeId;
  readonly copiedConnectionIds: readonly ConnectionId[];
}

/**
 * "Launch another like this": copies a node's config and its non-placement connections
 * (security groups, incoming traffic, data access, monitoring). Placement is left to the player,
 * because a single instance belongs to exactly one subnet.
 */
export const duplicateNode = (
  graph: InfrastructureGraph,
  nodeId: NodeId,
  policy: EditPolicy = {},
): CommandResult<DuplicateNodeEffects> => {
  const node = graph.nodes[nodeId];
  if (!node) return reject(finding('edit.node_not_found', 'error', 'edit', { nodeIds: [nodeId] }));
  const added = addNode(graph, { serviceType: node.serviceType, config: node.config }, policy);
  if (!added.ok) return added;
  let next = added.value.graph;
  const newId = added.value.nodeId;
  next = {
    ...next,
    nodes: {
      ...next.nodes,
      [newId]: { ...(next.nodes[newId] as InfraNode), name: nextCopyName(graph, node.name) },
    },
  };
  const copied: ConnectionId[] = [];
  for (const c of connectionsOf(graph, nodeId)) {
    if (c.connectionType === 'placed_in') continue;
    const input: ConnectInput = {
      sourceNodeId: c.sourceNodeId === nodeId ? newId : c.sourceNodeId,
      targetNodeId: c.targetNodeId === nodeId ? newId : c.targetNodeId,
      connectionType: c.connectionType as ConnectionTypeId,
      ...(c.config !== undefined ? { config: c.config } : {}),
    };
    const r = connect(next, input, policy);
    if (r.ok) {
      next = r.value.graph;
      copied.push(r.value.connectionId);
    }
  }
  return ok({ graph: next, nodeId: newId, copiedConnectionIds: copied });
};

/** web-1 → web-2 (next free number); other names get a numeric suffix. */
const nextCopyName = (graph: InfrastructureGraph, name: string): string => {
  const base = name.replace(/-\d+$/, '');
  const used = new Set(Object.values(graph.nodes).map((n) => n.name));
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
};

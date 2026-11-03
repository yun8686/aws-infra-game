import { compareIds } from '../shared/result';
import type { ConnectionTypeId } from '../catalog/ids';
import {
  GRAPH_SCHEMA_VERSION,
  type ConnectionId,
  type InfraConnection,
  type InfraNode,
  type InfrastructureGraph,
  type NodeId,
} from './types';

export const createEmptyGraph = (): InfrastructureGraph => ({
  schemaVersion: GRAPH_SCHEMA_VERSION,
  nodes: {},
  connections: {},
});

/** Nodes sorted by id, so every consumer iterates in the same order. */
export const listNodes = (graph: InfrastructureGraph): InfraNode[] =>
  Object.values(graph.nodes).sort((a, b) => compareIds(a.id, b.id));

export const listConnections = (graph: InfrastructureGraph): InfraConnection[] =>
  Object.values(graph.connections).sort((a, b) => compareIds(a.id, b.id));

export const nodesOfType = (graph: InfrastructureGraph, ...types: readonly string[]): InfraNode[] =>
  listNodes(graph).filter((n) => types.includes(n.serviceType));

export const outgoing = (
  graph: InfrastructureGraph,
  nodeId: NodeId,
  type?: ConnectionTypeId,
): InfraConnection[] =>
  listConnections(graph).filter(
    (c) => c.sourceNodeId === nodeId && (type === undefined || c.connectionType === type),
  );

export const incoming = (
  graph: InfrastructureGraph,
  nodeId: NodeId,
  type?: ConnectionTypeId,
): InfraConnection[] =>
  listConnections(graph).filter(
    (c) => c.targetNodeId === nodeId && (type === undefined || c.connectionType === type),
  );

export const connectionsOf = (graph: InfrastructureGraph, nodeId: NodeId): InfraConnection[] =>
  listConnections(graph).filter((c) => c.sourceNodeId === nodeId || c.targetNodeId === nodeId);

/** Targets of a node's outgoing connections of a given type that exist in the graph. */
export const targetsOf = (graph: InfrastructureGraph, nodeId: NodeId, type: ConnectionTypeId): InfraNode[] =>
  outgoing(graph, nodeId, type)
    .map((c) => graph.nodes[c.targetNodeId])
    .filter((n): n is InfraNode => n !== undefined);

export const sourcesOf = (graph: InfrastructureGraph, nodeId: NodeId, type: ConnectionTypeId): InfraNode[] =>
  incoming(graph, nodeId, type)
    .map((c) => graph.nodes[c.sourceNodeId])
    .filter((n): n is InfraNode => n !== undefined);

const nextNumericId = (existing: readonly string[], prefix: string): string => {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let max = 0;
  for (const id of existing) {
    const match = pattern.exec(id);
    if (match?.[1]) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${max + 1}`;
};

/** Deterministic id generation: `<prefix>-<n>` where n is one more than the highest existing n. */
export const nextNodeId = (graph: InfrastructureGraph, prefix: string): NodeId =>
  nextNumericId(Object.keys(graph.nodes), prefix);

export const nextConnectionId = (graph: InfrastructureGraph): ConnectionId =>
  nextNumericId(Object.keys(graph.connections), 'conn');

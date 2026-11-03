export type NodeId = string;
export type ConnectionId = string;

export const GRAPH_SCHEMA_VERSION = 1 as const;

/**
 * A resource in the infrastructure graph.
 * `serviceType` is a plain string so that unknown types loaded from content or saves
 * can be reported by validation instead of crashing.
 */
export interface InfraNode {
  readonly id: NodeId;
  readonly serviceType: string;
  readonly name: string;
  /** Validated against the service definition's schema; never trusted blindly. */
  readonly config: unknown;
}

export interface InfraConnection {
  readonly id: ConnectionId;
  readonly sourceNodeId: NodeId;
  readonly targetNodeId: NodeId;
  readonly connectionType: string;
  readonly config?: unknown;
}

/** Semantic infrastructure only. Presentation data lives in GraphLayout. */
export interface InfrastructureGraph {
  readonly schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  readonly nodes: Readonly<Record<NodeId, InfraNode>>;
  readonly connections: Readonly<Record<ConnectionId, InfraConnection>>;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Presentation metadata. Never an input to validation or simulation. */
export interface GraphLayout {
  readonly positions: Readonly<Record<NodeId, Point>>;
  readonly collapsedNodeIds?: readonly NodeId[];
}

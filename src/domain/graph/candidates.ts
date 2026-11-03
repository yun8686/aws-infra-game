import { allowedConnectionTypes } from '../catalog/catalog';
import type { ConnectionTypeId } from '../catalog/ids';
import { finding, type Finding } from '../validation/findings';
import { checkConnect, type ConnectInput, type EditPolicy } from './commands';
import { listNodes } from './graph';
import type { InfrastructureGraph, NodeId } from './types';

export interface ConnectCandidate {
  readonly nodeId: NodeId;
  /** Connections that can be created between the selected node and this one (either direction). */
  readonly options: readonly ConnectInput[];
  /** Why no connection is possible; empty when `options` is non-empty. */
  readonly reasons: readonly Finding[];
}

/**
 * For tap-to-connect: given a selected node, which other nodes can it be connected to, how, and if not, why.
 * Direction is inferred so the player can tap the two nodes in either order.
 */
export const connectionCandidates = (
  graph: InfrastructureGraph,
  selectedId: NodeId,
  policy: EditPolicy = {},
  onlyType?: ConnectionTypeId,
): ConnectCandidate[] => {
  const selected = graph.nodes[selectedId];
  if (!selected) return [];
  return listNodes(graph)
    .filter((n) => n.id !== selectedId)
    .map((other) => {
      const attempts: ConnectInput[] = [
        ...allowedConnectionTypes(selected.serviceType, other.serviceType).map((t) => ({
          sourceNodeId: selected.id,
          targetNodeId: other.id,
          connectionType: t,
        })),
        ...allowedConnectionTypes(other.serviceType, selected.serviceType).map((t) => ({
          sourceNodeId: other.id,
          targetNodeId: selected.id,
          connectionType: t,
        })),
      ].filter((a) => onlyType === undefined || a.connectionType === onlyType);
      if (attempts.length === 0) {
        return {
          nodeId: other.id,
          options: [],
          reasons: [
            finding(
              'connection.not_allowed',
              'error',
              'connection',
              { nodeIds: [selected.id, other.id] },
              {
                params: {
                  sourceType: selected.serviceType,
                  targetType: other.serviceType,
                  connectionType: onlyType ?? '',
                },
              },
            ),
          ],
        };
      }
      const options: ConnectInput[] = [];
      const reasons: Finding[] = [];
      for (const a of attempts) {
        const problems = checkConnect(graph, a, policy);
        if (problems.length === 0) options.push(a);
        else reasons.push(...problems);
      }
      return { nodeId: other.id, options, reasons: options.length > 0 ? [] : reasons };
    });
};

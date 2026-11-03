import {
  addNode,
  connect,
  removeNode,
  updateNodeConfig,
  type EditPolicy,
} from '../../src/domain/graph/commands';
import type { InfrastructureGraph } from '../../src/domain/graph/types';
import { unwrap } from './builders';

export const setConfig = (
  g: InfrastructureGraph,
  id: string,
  patch: Record<string, unknown>,
  policy: EditPolicy = {},
) => unwrap(updateNodeConfig(g, id, { ...(g.nodes[id]?.config as object), ...patch }, policy)).graph;

/** Replace the template's fixed web tier with an Auto Scaling group across both private subnets. */
export const replaceWebWithAutoScaling = (
  g: InfrastructureGraph,
  config: Record<string, unknown>,
  policy: EditPolicy = {},
): { graph: InfrastructureGraph; asgId: string } => {
  const added = unwrap(addNode(g, { serviceType: 'compute.autoscaling', config }, policy));
  let graph = added.graph;
  const id = added.nodeId;
  for (const [target, type] of [
    ['subnet-3', 'placed_in'],
    ['subnet-4', 'placed_in'],
    ['sg-2', 'secured_by'],
  ] as const) {
    graph = unwrap(
      connect(graph, { sourceNodeId: id, targetNodeId: target, connectionType: type }, policy),
    ).graph;
  }
  graph = unwrap(
    connect(graph, { sourceNodeId: 'alb-1', targetNodeId: id, connectionType: 'routes_to' }, policy),
  ).graph;
  graph = unwrap(
    connect(graph, { sourceNodeId: id, targetNodeId: 'rds-1', connectionType: 'data_access' }, policy),
  ).graph;
  graph = unwrap(removeNode(graph, 'ec2-1', policy)).graph;
  return { graph, asgId: id };
};

export const ASG_SMALL = {
  instanceSize: 'small',
  minCapacity: 2,
  desiredCapacity: 2,
  maxCapacity: 14,
  targetCpuPct: 60,
  warmupSec: 120,
};

/** Reference solution A: elastic small instances + larger database. */
export const solutionA = (template: InfrastructureGraph, policy: EditPolicy = {}) =>
  setConfig(
    replaceWebWithAutoScaling(template, ASG_SMALL, policy).graph,
    'rds-1',
    { instanceClass: 'db.large' },
    policy,
  );

/** Reference solution B: fewer, larger elastic instances with more headroom + larger database. */
export const solutionB = (template: InfrastructureGraph, policy: EditPolicy = {}) =>
  setConfig(
    replaceWebWithAutoScaling(
      template,
      { ...ASG_SMALL, instanceSize: 'medium', maxCapacity: 8, targetCpuPct: 50 },
      policy,
    ).graph,
    'rds-1',
    { instanceClass: 'db.large' },
    policy,
  );

/** Meets the SLOs with static over-provisioning, but costs more than the budget allows. */
export const overProvisioned = (template: InfrastructureGraph) =>
  setConfig(setConfig(template, 'ec2-1', { instanceCount: 12 }), 'rds-1', { instanceClass: 'db.large' });

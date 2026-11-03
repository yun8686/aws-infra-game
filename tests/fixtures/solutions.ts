import {
  addNode,
  connect,
  duplicateNode,
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

const webServerIds = (g: InfrastructureGraph): string[] =>
  Object.values(g.nodes)
    .filter((n) => n.serviceType === 'compute.ec2')
    .map((n) => n.id)
    .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));

/**
 * Make exactly `count` web EC2 instances, copying the first one ("launch another like this") and
 * placing new ones round-robin over `subnets`. Removes the newest instances when reducing.
 */
export const setWebServers = (
  g: InfrastructureGraph,
  count: number,
  options: { subnets?: readonly string[]; size?: string; policy?: EditPolicy } = {},
): InfrastructureGraph => {
  const subnets = options.subnets ?? ['subnet-3'];
  const policy = options.policy ?? {};
  let graph = g;
  while (webServerIds(graph).length < count) {
    const first = webServerIds(graph)[0];
    if (!first) throw new Error('no web server to copy');
    const d = unwrap(duplicateNode(graph, first, policy));
    const subnet = subnets[(webServerIds(d.graph).length - 1) % subnets.length] as string;
    graph = unwrap(
      connect(d.graph, { sourceNodeId: d.nodeId, targetNodeId: subnet, connectionType: 'placed_in' }, policy),
    ).graph;
  }
  while (webServerIds(graph).length > count) {
    graph = unwrap(removeNode(graph, webServerIds(graph).at(-1) as string, policy)).graph;
  }
  if (options.size)
    for (const id of webServerIds(graph))
      graph = setConfig(graph, id, { instanceSize: options.size }, policy);
  return graph;
};

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
  for (const web of webServerIds(graph)) graph = unwrap(removeNode(graph, web, policy)).graph;
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
  setConfig(setWebServers(template, 12), 'rds-1', { instanceClass: 'db.large' });

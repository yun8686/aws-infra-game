import { readConfig } from '../../domain/catalog/catalog';
import { nodesOfType } from '../../domain/graph/graph';
import type { InfrastructureGraph, NodeId } from '../../domain/graph/types';
import type { SimulationResult, StepMetrics } from '../../domain/simulation/types';
import type { NodeMetricBadge } from '../infrastructure-editor/components/GraphCanvas';

/** Pure derivations from a simulation result for the monitoring views. */

export const pick = (steps: readonly StepMetrics[], f: (s: StepMetrics) => number): number[] => steps.map(f);

export const computeNodeIds = (graph: InfrastructureGraph): NodeId[] =>
  nodesOfType(graph, 'compute.ec2', 'compute.autoscaling').map((n) => n.id);

export const databaseNodeIds = (graph: InfrastructureGraph): NodeId[] =>
  nodesOfType(graph, 'database.rds').map((n) => n.id);

const level = (u: number): NodeMetricBadge['level'] => (u >= 0.9 ? 'bad' : u >= 0.7 ? 'warn' : 'ok');
const pct = (u: number) => `${Math.round(u * 100)}%`;

/** Status badges for the graph overlay at one minute. */
export const badgesAt = (
  sim: SimulationResult,
  graph: InfrastructureGraph,
  minute: number,
): Record<NodeId, NodeMetricBadge> => {
  const step = sim.steps[minute];
  if (!step) return {};
  const out: Record<NodeId, NodeMetricBadge> = {};
  for (const [id, m] of Object.entries(step.nodes)) {
    const node = graph.nodes[id];
    if (!node) continue;
    if (node.serviceType === 'database.rds') {
      if (m.available === false) {
        out[id] = { text: '停止中', level: 'bad' };
        continue;
      }
      const connRatio = m.maxConnections ? (m.connections ?? 0) / m.maxConnections : 0;
      const u = Math.max(m.utilization ?? 0, connRatio);
      out[id] = {
        text: connRatio > 1 ? `接続 ${pct(connRatio)}` : `負荷 ${pct(m.utilization ?? 0)}`,
        level: level(u),
      };
    } else if (node.serviceType === 'compute.ec2') {
      // A single instance (ADR 0015): running or stopped, and how busy.
      if ((m.instances ?? 0) === 0) {
        out[id] = { text: (m.failedInstances ?? 0) > 0 ? '停止（故障）' : '停止', level: 'bad' };
        continue;
      }
      const u = m.utilization ?? 0;
      out[id] = { text: `CPU ${u > 1 ? '過負荷' : pct(u)}`, level: level(u) };
    } else if (node.serviceType === 'compute.autoscaling') {
      const running = m.instances ?? 0;
      if (running === 0) {
        out[id] = { text: '稼働 0台', level: 'bad' };
        continue;
      }
      const u = m.utilization ?? 0;
      // Short enough for a one-column node: demand beyond capacity reads as overload, not a huge percentage.
      out[id] = { text: `${u > 1 ? '過負荷' : pct(u)}・${running}台`, level: level(u) };
    } else if (node.serviceType === 'lb.alb') {
      out[id] = { text: `${Math.round(m.loadPerSec)} rps`, level: 'ok' };
    }
  }
  return out;
};

export const isAutoScaling = (graph: InfrastructureGraph, id: NodeId): boolean =>
  readConfig(graph.nodes[id], 'compute.autoscaling') !== undefined;

export const ec2NodeIds = (graph: InfrastructureGraph): NodeId[] =>
  nodesOfType(graph, 'compute.ec2').map((n) => n.id);
export const autoScalingNodeIds = (graph: InfrastructureGraph): NodeId[] =>
  nodesOfType(graph, 'compute.autoscaling').map((n) => n.id);

/** Load over capacity across all EC2 instances (failed ones contribute no capacity). */
export const ec2Utilization = (step: StepMetrics, ids: readonly NodeId[]): number => {
  let load = 0;
  let capacity = 0;
  for (const id of ids) {
    load += step.nodes[id]?.loadPerSec ?? 0;
    capacity += step.nodes[id]?.capacityPerSec ?? 0;
  }
  return capacity > 0 ? load / capacity : load > 0 ? 2 : 0;
};

export const ec2Running = (step: StepMetrics, ids: readonly NodeId[]): number =>
  ids.reduce((a, id) => a + (step.nodes[id]?.instances ?? 0), 0);

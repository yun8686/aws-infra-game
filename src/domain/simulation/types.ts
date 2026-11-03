import type { ConnectionId, NodeId } from '../graph/types';
import type { Finding } from '../validation/findings';

export type BottleneckCause =
  | 'compute_saturated'
  | 'compute_high_utilization'
  | 'db_capacity'
  | 'db_high_utilization'
  | 'db_connections'
  | 'sg_blocked'
  | 'no_healthy_targets';

export interface NodeStepMetrics {
  /** Requests (or queries for databases) per second arriving at the node. */
  readonly loadPerSec: number;
  readonly utilization?: number;
  readonly instances?: number;
  readonly capacityPerSec?: number;
  readonly connections?: number;
  readonly maxConnections?: number;
  readonly backlog?: number;
}

export interface StepMetrics {
  readonly minute: number;
  readonly offeredRps: number;
  readonly successRps: number;
  readonly errorRps: number;
  readonly errorRate: number;
  /** Success-weighted mean latency; timeout when nothing succeeds. */
  readonly latencyMs: number;
  readonly costPerHour: number;
  readonly nodes: Readonly<Record<NodeId, NodeStepMetrics>>;
}

export interface Bottleneck {
  readonly cause: BottleneckCause;
  readonly nodeIds: readonly NodeId[];
  readonly connectionIds: readonly ConnectionId[];
  readonly startMinute: number;
  readonly endMinute: number;
  /** Highest pressure observed (utilization or connection demand ratio). */
  readonly peak: number;
  readonly failedRequests: number;
}

export interface SimulationSummary {
  readonly totalRequests: number;
  readonly failedRequests: number;
  readonly errorRate: number;
  readonly peakErrorRate: number;
  readonly meanLatencyMs: number;
  readonly p95LatencyMs: number;
  /** Share of steps whose error rate stayed at or below the availability threshold. */
  readonly availability: number;
}

export interface CostSummary {
  readonly runCost: number;
  readonly baselineHourly: number;
  readonly projectedMonthly: number;
  readonly runCostByNode: Readonly<Record<NodeId, number>>;
}

export interface SimulationResult {
  readonly engineVersion: number;
  readonly balanceVersion: number;
  readonly inputHash: string;
  readonly scenarioId: string;
  readonly seed: number;
  readonly steps: readonly StepMetrics[];
  readonly summary: SimulationSummary;
  readonly cost: CostSummary;
  readonly bottlenecks: readonly Bottleneck[];
  /** Non-blocking validation findings (warnings, security) carried along for evaluation. */
  readonly findings: readonly Finding[];
}

import type { AppId } from '../model';
import type { ConnectionId, NodeId } from './ids';
import type { Finding } from '../model';

export type BottleneckCause =
  | 'compute_saturated'
  | 'compute_high_utilization'
  | 'db_capacity'
  | 'db_high_utilization'
  | 'db_connections'
  | 'sg_blocked'
  | 'no_healthy_targets'
  | 'unhealthy_target'
  | 'compute_unavailable'
  | 'db_unavailable'
  | 'no_database'
  | 'no_app_target';

export type TimelineEventKind =
  | 'instance_failure'
  | 'az_outage_start'
  | 'az_outage_end'
  | 'db_failure'
  | 'failure_detected'
  | 'instance_launched'
  | 'instance_ready'
  | 'scale_out'
  | 'scale_in'
  | 'db_unavailable'
  | 'db_failover'
  | 'db_recovered';

/** Something that happened during the run, for the result timeline. */
export interface TimelineEvent {
  readonly minute: number;
  readonly kind: TimelineEventKind;
  readonly nodeIds: readonly NodeId[];
  readonly params?: Readonly<Record<string, string | number>>;
}

export interface NodeStepMetrics {
  /** Requests (or queries for databases) per second arriving at the node. */
  readonly loadPerSec: number;
  readonly utilization?: number;
  /** Running (in-service) instances. */
  readonly instances?: number;
  readonly pendingInstances?: number;
  readonly failedInstances?: number;
  /** Auto Scaling desired capacity. */
  readonly desiredCapacity?: number;
  readonly available?: boolean;
  readonly capacityPerSec?: number;
  readonly connections?: number;
  readonly maxConnections?: number;
  readonly backlog?: number;
  /** Requests per second arriving per application (compute nodes). */
  readonly loadByApp?: Readonly<Partial<Record<AppId, number>>>;
}

/** Per-application view of one step (ADR 0016). */
export interface AppStepMetrics {
  readonly offeredRps: number;
  readonly successRps: number;
  readonly errorRps: number;
  readonly errorRate: number;
  readonly latencyMs: number;
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
  readonly apps: Readonly<Partial<Record<AppId, AppStepMetrics>>>;
}

export interface Bottleneck {
  readonly cause: BottleneckCause;
  readonly nodeIds: readonly NodeId[];
  readonly connectionIds: readonly ConnectionId[];
  /** Applications whose requests failed (empty = node-level pressure). */
  readonly appIds: readonly AppId[];
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

/** Summary per application plus the totals. */
export interface SimulationSummaryWithApps extends SimulationSummary {
  readonly apps: Readonly<Partial<Record<AppId, SimulationSummary>>>;
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
  readonly summary: SimulationSummaryWithApps;
  readonly cost: CostSummary;
  readonly bottlenecks: readonly Bottleneck[];
  readonly timeline: readonly TimelineEvent[];
  /** Non-blocking validation findings (warnings, security) carried along for evaluation. */
  readonly findings: readonly Finding[];
}

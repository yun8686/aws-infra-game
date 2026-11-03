import type { InfrastructureGraph, NodeId } from '../graph/types';
import { err, ok, type Result } from '../shared/result';
import type { Finding } from '../validation/findings';
import { validateGraph } from '../validation/validateGraph';
import { BALANCE } from './balance';
import { aggregateBottlenecks, type StepIssue } from './bottlenecks';
import { compileGraph, type ExecutionModel } from './compile';
import { nodeCostPerHour } from './cost';
import { fnv1a, stableStringify } from './hash';
import { createPrng } from './prng';
import { baseRpsAt, scenarioSchema, type Scenario } from './scenario';
import type { CostSummary, NodeStepMetrics, SimulationResult, SimulationSummary, StepMetrics } from './types';

export const ENGINE_VERSION = 1;

export interface SimulationInput {
  readonly graph: InfrastructureGraph;
  readonly scenario: Scenario;
  readonly seed: number;
}

export type SimulationError =
  | { readonly kind: 'invalid_graph'; readonly findings: readonly Finding[] }
  | { readonly kind: 'invalid_scenario'; readonly message: string };

export const computeInputHash = (input: SimulationInput): string =>
  fnv1a(
    stableStringify({
      engine: ENGINE_VERSION,
      balance: BALANCE.version,
      graph: input.graph,
      scenario: input.scenario,
      seed: input.seed,
    }),
  );

/** Queueing factor: grows sharply as utilization approaches the cap. */
const queueFactor = (rho: number): number =>
  1 / (1 - Math.min(Math.max(rho, 0), BALANCE.latency.maxUtilizationForQueueing));

interface StepOutcome {
  readonly metrics: StepMetrics;
  readonly issues: StepIssue[];
}

const runStep = (
  model: ExecutionModel,
  scenario: Scenario,
  minute: number,
  offeredRps: number,
  backlog: Map<NodeId, number>,
): Omit<StepOutcome, 'metrics'> & { metrics: Omit<StepMetrics, 'costPerHour'> } => {
  const stepSec = scenario.stepSec;
  const issues: StepIssue[] = [];
  const nodes: Record<NodeId, NodeStepMetrics> = {};
  const fail = (issue: StepIssue) => {
    if (issue.failedRps > 0 || issue.pressure > 0) issues.push(issue);
  };
  let failedRps = 0;
  const failRps = (issue: StepIssue) => {
    failedRps += issue.failedRps;
    fail(issue);
  };

  // 1–2. Entry and load balancers → arrivals at compute groups.
  const arrivals = new Map<NodeId, { rps: number; viaAlbRps: number }>();
  const arrive = (id: NodeId, rps: number, viaAlb: boolean) => {
    const a = arrivals.get(id) ?? { rps: 0, viaAlbRps: 0 };
    arrivals.set(id, { rps: a.rps + rps, viaAlbRps: a.viaAlbRps + (viaAlb ? rps : 0) });
  };

  const share = model.entryRoutes.length > 0 ? offeredRps / model.entryRoutes.length : 0;
  if (model.entryRoutes.length === 0) failedRps += offeredRps;
  for (const route of model.entryRoutes) {
    if (!route.allowed) {
      failRps({
        cause: 'sg_blocked',
        nodeIds: [route.targetId],
        connectionIds: [route.connectionId],
        failedRps: share,
        pressure: 1,
      });
      continue;
    }
    const alb = model.albs.get(route.targetId);
    if (!alb) {
      arrive(route.targetId, share, false);
      continue;
    }
    nodes[alb.id] = { loadPerSec: (nodes[alb.id]?.loadPerSec ?? 0) + share };
    const eligible = alb.targets.filter(
      (t) => t.allowed && (model.computes.get(t.targetId)?.instances ?? 0) > 0,
    );
    if (eligible.length === 0) {
      failRps({
        cause: 'no_healthy_targets',
        nodeIds: [alb.id],
        connectionIds: [],
        failedRps: share,
        pressure: 1,
      });
      continue;
    }
    const totalInstances = eligible.reduce((s, t) => s + (model.computes.get(t.targetId)?.instances ?? 0), 0);
    for (const t of eligible) {
      arrive(t.targetId, (share * (model.computes.get(t.targetId)?.instances ?? 0)) / totalInstances, true);
    }
  }

  // 3. Compute groups.
  const served = new Map<NodeId, { rps: number; rho: number; waitSec: number; albFraction: number }>();
  for (const compute of model.computes.values()) {
    const a = arrivals.get(compute.id) ?? { rps: 0, viaAlbRps: 0 };
    const capacity = compute.instances * compute.capacityPerInstance;
    const demand = a.rps * stepSec + (backlog.get(compute.id) ?? 0);
    const servedReq = Math.min(demand, capacity * stepSec);
    const excess = demand - servedReq;
    const nextBacklog = Math.min(excess, capacity * BALANCE.queueSeconds);
    const dropped = excess - nextBacklog;
    backlog.set(compute.id, nextBacklog);
    const rho = capacity > 0 ? a.rps / capacity : a.rps > 0 ? Infinity : 0;
    if (dropped > 0) {
      failRps({
        cause: 'compute_saturated',
        nodeIds: [compute.id],
        connectionIds: [],
        failedRps: dropped / stepSec,
        pressure: rho,
      });
    } else if (rho >= BALANCE.highUtilization) {
      fail({
        cause: 'compute_high_utilization',
        nodeIds: [compute.id],
        connectionIds: [],
        failedRps: 0,
        pressure: rho,
      });
    }
    served.set(compute.id, {
      rps: servedReq / stepSec,
      rho,
      waitSec: capacity > 0 ? nextBacklog / capacity : 0,
      albFraction: a.rps > 0 ? a.viaAlbRps / a.rps : 0,
    });
    nodes[compute.id] = {
      loadPerSec: a.rps,
      utilization: Number.isFinite(rho) ? rho : 1,
      instances: compute.instances,
      capacityPerSec: capacity,
      backlog: nextBacklog,
    };
  }

  // 4. Databases.
  const dbState = new Map<NodeId, { connSuccess: number; capSuccess: number; rho: number }>();
  for (const db of model.dbs.values()) {
    let connections = 0;
    let qps = 0;
    for (const compute of model.computes.values()) {
      for (const link of compute.dbLinks) {
        if (link.dbId !== db.id || !link.allowed) continue;
        connections += compute.instances * link.poolSize;
        qps += (served.get(compute.id)?.rps ?? 0) * scenario.queriesPerRequest;
      }
    }
    const connSuccess = connections > db.maxConnections ? db.maxConnections / connections : 1;
    const executed = qps * connSuccess;
    const capSuccess = executed > db.capacityQps ? db.capacityQps / executed : 1;
    const rho = executed / db.capacityQps;
    dbState.set(db.id, { connSuccess, capSuccess, rho });
    nodes[db.id] = {
      loadPerSec: qps,
      utilization: rho,
      capacityPerSec: db.capacityQps,
      connections,
      maxConnections: db.maxConnections,
    };
  }

  // Attribute DB failures per compute group, and compute latency.
  let successRps = 0;
  let latencyWeighted = 0;
  const dbIssueTotals = new Map<string, StepIssue>();
  const addDbIssue = (issue: StepIssue) => {
    const key = `${issue.cause}|${issue.nodeIds.join()}|${issue.connectionIds.join()}`;
    const prev = dbIssueTotals.get(key);
    dbIssueTotals.set(key, prev ? { ...prev, failedRps: prev.failedRps + issue.failedRps } : issue);
  };
  for (const compute of model.computes.values()) {
    const s = served.get(compute.id);
    if (!s || s.rps === 0) continue;
    let remaining = s.rps;
    let latency =
      BALANCE.latency.albMs * s.albFraction +
      BALANCE.latency.computeMs * queueFactor(s.rho) +
      s.waitSec * 1000;
    for (const link of compute.dbLinks) {
      if (!link.allowed) {
        addDbIssue({
          cause: 'sg_blocked',
          nodeIds: [link.dbId],
          connectionIds: [link.connectionId],
          failedRps: remaining,
          pressure: 1,
        });
        remaining = 0;
        break;
      }
      const st = dbState.get(link.dbId);
      if (!st) continue;
      const connFailed = remaining * (1 - st.connSuccess);
      if (connFailed > 0) {
        const db = model.dbs.get(link.dbId);
        const pressure = db ? (nodes[link.dbId]?.connections ?? 0) / db.maxConnections : 1;
        addDbIssue({
          cause: 'db_connections',
          nodeIds: [link.dbId],
          connectionIds: [],
          failedRps: connFailed,
          pressure,
        });
      }
      remaining -= connFailed;
      const capFailed = remaining * (1 - st.capSuccess);
      if (capFailed > 0) {
        addDbIssue({
          cause: 'db_capacity',
          nodeIds: [link.dbId],
          connectionIds: [],
          failedRps: capFailed,
          pressure: st.rho,
        });
      }
      remaining -= capFailed;
      latency += BALANCE.latency.dbPerQueryMs * scenario.queriesPerRequest * queueFactor(st.rho);
    }
    successRps += remaining;
    latencyWeighted += remaining * Math.min(latency, BALANCE.latency.timeoutMs);
  }
  for (const issue of dbIssueTotals.values()) failRps(issue);
  for (const [dbId, st] of dbState) {
    if (st.capSuccess === 1 && st.rho >= BALANCE.highUtilization) {
      fail({
        cause: 'db_high_utilization',
        nodeIds: [dbId],
        connectionIds: [],
        failedRps: 0,
        pressure: st.rho,
      });
    }
  }

  // Requests still waiting in a backlog are neither successes nor failures in this step.
  const errorRps = Math.max(0, Math.min(offeredRps, failedRps));
  return {
    issues,
    metrics: {
      minute,
      offeredRps,
      successRps,
      errorRps,
      errorRate: offeredRps > 0 ? errorRps / offeredRps : 0,
      latencyMs: successRps > 0 ? latencyWeighted / successRps : BALANCE.latency.timeoutMs,
      nodes,
    },
  };
};

const summarize = (steps: readonly StepMetrics[], stepSec: number): SimulationSummary => {
  const total = steps.reduce((s, m) => s + m.offeredRps * stepSec, 0);
  const failed = steps.reduce((s, m) => s + m.errorRps * stepSec, 0);
  const success = steps.reduce((s, m) => s + m.successRps, 0);
  const latencies = steps.map((m) => m.latencyMs).sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);
  return {
    totalRequests: total,
    failedRequests: failed,
    errorRate: total > 0 ? failed / total : 0,
    peakErrorRate: Math.max(0, ...steps.map((m) => m.errorRate)),
    meanLatencyMs:
      success > 0
        ? steps.reduce((s, m) => s + m.latencyMs * m.successRps, 0) / success
        : BALANCE.latency.timeoutMs,
    p95LatencyMs: latencies[p95Index] ?? 0,
    availability:
      steps.length > 0
        ? steps.filter((m) => m.errorRate <= BALANCE.availabilityErrorRateThreshold).length / steps.length
        : 1,
  };
};

/**
 * Runs a deterministic, discrete time-step simulation (ADR 0008).
 * Refuses graphs with validation errors.
 */
export const simulate = (input: SimulationInput): Result<SimulationResult, SimulationError> => {
  const scenarioCheck = scenarioSchema.safeParse(input.scenario);
  if (!scenarioCheck.success) {
    return err({ kind: 'invalid_scenario', message: scenarioCheck.error.issues[0]?.message ?? 'invalid' });
  }
  const scenario = scenarioCheck.data;
  const report = validateGraph(input.graph);
  if (!report.canSimulate) return err({ kind: 'invalid_graph', findings: report.findings });

  const model = compileGraph(input.graph);
  const rand = createPrng(input.seed);
  const stepCount = Math.round((scenario.durationMin * 60) / scenario.stepSec);
  const backlog = new Map<NodeId, number>();
  const steps: StepMetrics[] = [];
  const issuesByStep: StepIssue[][] = [];
  const runCostByNode: Record<NodeId, number> = {};

  for (let i = 0; i < stepCount; i++) {
    const minute = (i * scenario.stepSec) / 60;
    const noise = 1 + (scenario.workload.noisePct / 100) * (2 * rand() - 1);
    const offered = baseRpsAt(scenario, minute) * noise;
    const { metrics, issues } = runStep(model, scenario, minute, offered, backlog);

    let costPerHour = 0;
    for (const id of model.billableNodeIds) {
      const node = input.graph.nodes[id];
      if (!node) continue;
      const rate = nodeCostPerHour(node, model.computes.get(id)?.instances);
      costPerHour += rate;
      runCostByNode[id] = (runCostByNode[id] ?? 0) + (rate * scenario.stepSec) / 3600;
    }
    steps.push({ ...metrics, costPerHour });
    issuesByStep.push(issues);
  }

  const runCost = Object.values(runCostByNode).reduce((a, b) => a + b, 0);
  const baselineHourly = steps[0]?.costPerHour ?? 0;
  const runHours = (stepCount * scenario.stepSec) / 3600;
  const cost: CostSummary = {
    runCost,
    baselineHourly,
    projectedMonthly:
      baselineHourly * BALANCE.hoursPerMonth + Math.max(0, runCost - baselineHourly * runHours),
    runCostByNode,
  };

  return ok({
    engineVersion: ENGINE_VERSION,
    balanceVersion: BALANCE.version,
    inputHash: computeInputHash(input),
    scenarioId: scenario.id,
    seed: input.seed,
    steps,
    summary: summarize(steps, scenario.stepSec),
    cost,
    bottlenecks: aggregateBottlenecks(issuesByStep, scenario.stepSec),
    findings: report.findings,
  });
};

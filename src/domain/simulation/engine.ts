import type { InfrastructureGraph, NodeId } from '../graph/types';
import { err, ok, type Result } from '../shared/result';
import type { Finding } from '../validation/findings';
import { validateGraph } from '../validation/validateGraph';
import { BALANCE } from './balance';
import { aggregateBottlenecks, type StepIssue } from './bottlenecks';
import { compileGraph, type ExecutionModel } from './compile';
import { advanceLifecycle, applyEvents, autoScale } from './lifecycle';
import { count, createState, dbIsAvailable, type GroupState, type SimState } from './state';
import { nodeCostPerHour } from './cost';
import { fnv1a, stableStringify } from './hash';
import { createPrng } from './prng';
import { baseRpsAt, scenarioSchema, type Scenario } from './scenario';
import type { CostSummary, NodeStepMetrics, SimulationResult, SimulationSummary, StepMetrics } from './types';

export const ENGINE_VERSION = 2;

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

interface StepOutput {
  readonly metrics: Omit<StepMetrics, 'costPerHour'>;
  readonly issues: StepIssue[];
  /** Requests per second routed to each compute group (the Auto Scaling signal). */
  readonly routed: ReadonlyMap<NodeId, number>;
}

const runStep = (
  model: ExecutionModel,
  state: SimState,
  scenario: Scenario,
  minute: number,
  nowSec: number,
  offeredRps: number,
): StepOutput => {
  const stepSec = scenario.stepSec;
  const issues: StepIssue[] = [];
  const nodes: Record<NodeId, NodeStepMetrics> = {};
  let failedRps = 0;
  const note = (issue: StepIssue) => {
    if (issue.failedRps > 0 || issue.pressure > 0) issues.push(issue);
  };
  const failRps = (issue: StepIssue) => {
    failedRps += issue.failedRps;
    note(issue);
  };

  const running = (id: NodeId) =>
    state.groups.get(id) ? count(state.groups.get(id) as GroupState, 'running') : 0;
  /** Failed instances that a router still sends traffic to (health checks have not caught up yet). */
  const undetectedFailed = (id: NodeId, detectionSec: number) =>
    state.groups
      .get(id)
      ?.instances.filter((i) => i.state === 'failed' && nowSec - i.failedAtSec < detectionSec).length ?? 0;

  // 1–2. Entry and load balancers → arrivals at compute groups.
  const arrivals = new Map<NodeId, { rps: number; viaAlbRps: number }>();
  const arrive = (id: NodeId, rps: number, viaAlb: boolean) => {
    const a = arrivals.get(id) ?? { rps: 0, viaAlbRps: 0 };
    arrivals.set(id, { rps: a.rps + rps, viaAlbRps: a.viaAlbRps + (viaAlb ? rps : 0) });
  };
  /** Traffic routed to each group, including requests lost to failed instances (scaling signal). */
  const routed = new Map<NodeId, number>();
  /** Route `rps` to a group whose routable set includes `bad` failed instances. */
  const deliver = (targetId: NodeId, rps: number, bad: number, viaAlb: boolean) => {
    routed.set(targetId, (routed.get(targetId) ?? 0) + rps);
    const routable = running(targetId) + bad;
    const lost = routable > 0 ? (rps * bad) / routable : rps;
    if (lost > 0) {
      failRps({
        cause: routable > 0 ? 'unhealthy_target' : 'compute_unavailable',
        nodeIds: [targetId],
        connectionIds: [],
        failedRps: lost,
        pressure: routable > 0 ? bad / routable : 1,
      });
    }
    if (rps - lost > 0) arrive(targetId, rps - lost, viaAlb);
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
      // Direct Internet → server: no health checks, so failed instances keep receiving traffic.
      deliver(route.targetId, share, undetectedFailed(route.targetId, Infinity), false);
      continue;
    }
    nodes[alb.id] = { loadPerSec: (nodes[alb.id]?.loadPerSec ?? 0) + share };
    const weights = alb.targets
      .filter((t) => t.allowed)
      .map((t) => {
        const bad = undetectedFailed(t.targetId, alb.detectionSec);
        return { t, bad, routable: running(t.targetId) + bad };
      })
      .filter((w) => w.routable > 0);
    const total = weights.reduce((sum, w) => sum + w.routable, 0);
    if (total === 0) {
      failRps({
        cause: 'no_healthy_targets',
        nodeIds: [alb.id],
        connectionIds: [],
        failedRps: share,
        pressure: 1,
      });
      continue;
    }
    for (const w of weights) deliver(w.t.targetId, (share * w.routable) / total, w.bad, true);
  }

  // 3. Compute groups.
  const served = new Map<NodeId, { rps: number; rho: number; waitSec: number; albFraction: number }>();
  for (const g of state.groups.values()) {
    const id = g.model.id;
    const a = arrivals.get(id) ?? { rps: 0, viaAlbRps: 0 };
    const capacity = count(g, 'running') * g.model.capacityPerInstance;
    const demand = a.rps * stepSec + g.backlog;
    const servedReq = Math.min(demand, capacity * stepSec);
    const excess = demand - servedReq;
    g.backlog = Math.min(excess, capacity * BALANCE.queueSeconds);
    const dropped = excess - g.backlog;
    const rho = capacity > 0 ? a.rps / capacity : a.rps > 0 ? Infinity : 0;
    if (dropped > 0) {
      failRps({
        cause: 'compute_saturated',
        nodeIds: [id],
        connectionIds: [],
        failedRps: dropped / stepSec,
        pressure: Number.isFinite(rho) ? rho : 1,
      });
    } else if (rho >= BALANCE.highUtilization) {
      note({
        cause: 'compute_high_utilization',
        nodeIds: [id],
        connectionIds: [],
        failedRps: 0,
        pressure: rho,
      });
    }
    served.set(id, {
      rps: servedReq / stepSec,
      rho,
      waitSec: capacity > 0 ? g.backlog / capacity : 0,
      albFraction: a.rps > 0 ? a.viaAlbRps / a.rps : 0,
    });
    nodes[id] = {
      loadPerSec: a.rps,
      utilization: Number.isFinite(rho) ? rho : 1,
      instances: count(g, 'running'),
      pendingInstances: count(g, 'pending'),
      failedInstances: count(g, 'failed'),
      ...(g.model.autoScaling ? { desiredCapacity: g.desired } : {}),
      capacityPerSec: capacity,
      backlog: g.backlog,
    };
  }

  // 4. Databases.
  const dbStep = new Map<
    NodeId,
    { available: boolean; connSuccess: number; capSuccess: number; rho: number }
  >();
  for (const d of state.dbs.values()) {
    const db = d.model;
    const available = dbIsAvailable(d, nowSec);
    let connections = 0;
    let qps = 0;
    for (const g of state.groups.values()) {
      for (const link of g.model.dbLinks) {
        if (link.dbId !== db.id || !link.allowed) continue;
        connections += count(g, 'running') * link.poolSize;
        qps += (served.get(g.model.id)?.rps ?? 0) * scenario.queriesPerRequest;
      }
    }
    const connSuccess = connections > db.maxConnections ? db.maxConnections / connections : 1;
    const executed = available ? qps * connSuccess : 0;
    const capSuccess = executed > db.capacityQps ? db.capacityQps / executed : 1;
    const rho = executed / db.capacityQps;
    dbStep.set(db.id, { available, connSuccess, capSuccess, rho });
    nodes[db.id] = {
      loadPerSec: qps,
      utilization: rho,
      capacityPerSec: db.capacityQps,
      connections,
      maxConnections: db.maxConnections,
      available,
    };
  }

  // Attribute DB failures per compute group, and compute latency.
  let successRps = 0;
  let latencyWeighted = 0;
  const dbIssues = new Map<string, StepIssue>();
  const addDbIssue = (issue: StepIssue) => {
    const key = `${issue.cause}|${issue.nodeIds.join()}|${issue.connectionIds.join()}`;
    const prev = dbIssues.get(key);
    dbIssues.set(key, prev ? { ...prev, failedRps: prev.failedRps + issue.failedRps } : issue);
  };
  for (const g of state.groups.values()) {
    const sv = served.get(g.model.id);
    if (!sv || sv.rps === 0) continue;
    let remaining = sv.rps;
    let latency =
      BALANCE.latency.albMs * sv.albFraction +
      BALANCE.latency.computeMs * queueFactor(sv.rho) +
      sv.waitSec * 1000;
    for (const link of g.model.dbLinks) {
      if (remaining <= 0) break;
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
      const st = dbStep.get(link.dbId);
      if (!st) continue;
      if (!st.available) {
        addDbIssue({
          cause: 'db_unavailable',
          nodeIds: [link.dbId],
          connectionIds: [],
          failedRps: remaining,
          pressure: 1,
        });
        remaining = 0;
        break;
      }
      const connFailed = remaining * (1 - st.connSuccess);
      if (connFailed > 0) {
        const n = nodes[link.dbId];
        addDbIssue({
          cause: 'db_connections',
          nodeIds: [link.dbId],
          connectionIds: [],
          failedRps: connFailed,
          pressure: n?.maxConnections ? (n.connections ?? 0) / n.maxConnections : 1,
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
  for (const issue of dbIssues.values()) failRps(issue);
  for (const [dbId, st] of dbStep) {
    if (st.available && st.capSuccess === 1 && st.rho >= BALANCE.highUtilization) {
      note({
        cause: 'db_high_utilization',
        nodeIds: [dbId],
        connectionIds: [],
        failedRps: 0,
        pressure: st.rho,
      });
    }
  }

  const errorRps = Math.max(0, failedRps);
  return {
    issues,
    routed,
    metrics: {
      minute,
      offeredRps,
      successRps,
      errorRps,
      errorRate: offeredRps > 0 ? Math.min(1, errorRps / offeredRps) : 0,
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
  const state = createState(model);
  const noiseRand = createPrng(input.seed);
  // Separate stream so adding events never shifts the workload noise.
  const eventRand = createPrng((input.seed ^ 0x9e3779b9) >>> 0);
  const events = scenario.events ?? [];
  const stepCount = Math.round((scenario.durationMin * 60) / scenario.stepSec);
  const steps: StepMetrics[] = [];
  const issuesByStep: StepIssue[][] = [];
  const runCostByNode: Record<NodeId, number> = {};

  for (let i = 0; i < stepCount; i++) {
    const nowSec = i * scenario.stepSec;
    const minute = nowSec / 60;
    applyEvents(state, events, minute, nowSec, eventRand);
    advanceLifecycle(state, nowSec);

    const noise = 1 + (scenario.workload.noisePct / 100) * (2 * noiseRand() - 1);
    const offered = baseRpsAt(scenario, minute) * noise;
    const { metrics, issues, routed } = runStep(model, state, scenario, minute, nowSec, offered);

    // Billing uses the instances that existed during the step, before scaling decisions.
    let costPerHour = 0;
    for (const id of model.billableNodeIds) {
      const node = input.graph.nodes[id];
      if (!node) continue;
      const g = state.groups.get(id);
      const rate = nodeCostPerHour(node, g ? count(g, 'running') + count(g, 'pending') : undefined);
      costPerHour += rate;
      runCostByNode[id] = (runCostByNode[id] ?? 0) + (rate * scenario.stepSec) / 3600;
    }
    steps.push({ ...metrics, costPerHour });
    issuesByStep.push(issues);

    for (const g of state.groups.values()) autoScale(state, g, routed.get(g.model.id) ?? 0, nowSec);
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
    timeline: state.timeline,
    findings: report.findings,
  });
};

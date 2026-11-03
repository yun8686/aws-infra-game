import type { AppId } from '../model';
import { validateDiagram, hasErrors, type Diagram } from '../model';
import type { NodeId } from './ids';
import { err, ok, type Result } from './result';
import type { Finding } from '../model';
import { BALANCE } from './balance';
import { aggregateBottlenecks, type StepIssue } from './bottlenecks';
import { compileDiagram, type ExecutionModel } from './compile';
import { advanceLifecycle, applyEvents, autoScale } from './lifecycle';
import { count, createState, dbIsAvailable, type GroupState, type SimState } from './state';
import { resourceCostPerHour } from './cost';
import { fnv1a, stableStringify } from './hash';
import { createPrng } from './prng';
import { scenarioApps, scenarioSchema, workloadRpsAt, type Scenario, type ScenarioApp } from './scenario';
import type {
  AppStepMetrics,
  CostSummary,
  NodeStepMetrics,
  SimulationResult,
  SimulationSummary,
  SimulationSummaryWithApps,
  StepMetrics,
} from './types';

/** 5: engine 4 behaviour on the diagram model (ADR 0018). */
export const ENGINE_VERSION = 5;

export interface SimulationInput {
  readonly diagram: Diagram;
  readonly scenario: Scenario;
  readonly seed: number;
}

export type SimulationError =
  | { readonly kind: 'invalid_diagram'; readonly findings: readonly Finding[] }
  | { readonly kind: 'invalid_scenario'; readonly message: string };

export const computeInputHash = (input: SimulationInput): string =>
  fnv1a(
    stableStringify({
      engine: ENGINE_VERSION,
      balance: BALANCE.version,
      diagram: input.diagram,
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
  /** CPU units per second routed to each compute group (the Auto Scaling signal). */
  readonly routed: ReadonlyMap<NodeId, number>;
}

/**
 * One time step. Server capacity is measured in CPU units: one shop request costs 1 unit and other
 * apps cost `cpuPerRequest` units, so apps on the same server compete for the same capacity.
 * With a single app of weight 1 this reduces exactly to the single-app model of engine 3.
 */
const runStep = (
  model: ExecutionModel,
  state: SimState,
  scenario: Scenario,
  apps: readonly ScenarioApp[],
  minute: number,
  nowSec: number,
  offered: ReadonlyMap<AppId, number>,
): StepOutput => {
  const stepSec = scenario.stepSec;
  const appOf = new Map(apps.map((a) => [a.appId, a]));
  const cpu = (app: AppId) => appOf.get(app)?.cpuPerRequest ?? 1;
  const issues: StepIssue[] = [];
  const nodes: Record<NodeId, NodeStepMetrics> = {};
  const failed = new Map<AppId, number>();
  const note = (issue: StepIssue) => {
    if (issue.failedRps > 0 || issue.pressure > 0) issues.push(issue);
  };
  const failRps = (issue: StepIssue) => {
    for (const app of issue.appIds) failed.set(app, (failed.get(app) ?? 0) + issue.failedRps);
    note(issue);
  };

  const runs = (computeId: NodeId, app: AppId) => model.computes.get(computeId)?.apps.includes(app) ?? false;
  const running = (id: NodeId) =>
    state.groups.get(id) ? count(state.groups.get(id) as GroupState, 'running') : 0;
  /** Failed instances that a router still sends traffic to (health checks have not caught up yet). */
  const undetectedFailed = (id: NodeId, detectionSec: number) =>
    state.groups
      .get(id)
      ?.instances.filter((i) => i.state === 'failed' && nowSec - i.failedAtSec < detectionSec).length ?? 0;

  // 1–2. Entry and load balancers → arrivals per compute group and app.
  const arrivals = new Map<NodeId, Map<AppId, { rps: number; viaAlbRps: number }>>();
  const arrive = (id: NodeId, app: AppId, rps: number, viaAlb: boolean) => {
    const byApp = arrivals.get(id) ?? new Map();
    const a = byApp.get(app) ?? { rps: 0, viaAlbRps: 0 };
    byApp.set(app, { rps: a.rps + rps, viaAlbRps: a.viaAlbRps + (viaAlb ? rps : 0) });
    arrivals.set(id, byApp);
  };
  const routed = new Map<NodeId, number>();
  /** Route `rps` of one app to a group whose routable set includes `bad` failed instances. */
  const deliver = (targetId: NodeId, app: AppId, rps: number, bad: number, viaAlb: boolean) => {
    routed.set(targetId, (routed.get(targetId) ?? 0) + rps * cpu(app));
    const routable = running(targetId) + bad;
    const lost = routable > 0 ? (rps * bad) / routable : rps;
    if (lost > 0) {
      failRps({
        cause: routable > 0 ? 'unhealthy_target' : 'compute_unavailable',
        nodeIds: [targetId],
        connectionIds: [],
        failedRps: lost,
        pressure: routable > 0 ? bad / routable : 1,
        appIds: [app],
      });
    }
    if (rps - lost > 0) arrive(targetId, app, rps - lost, viaAlb);
  };

  for (const { appId: app } of apps) {
    const load = offered.get(app) ?? 0;
    // An entry route advertises the app when a server behind it (or the server itself) runs it.
    const advertising = model.entryRoutes.filter((route) => {
      const alb = model.albs.get(route.targetId);
      return alb ? alb.targets.some((t) => runs(t.targetId, app)) : runs(route.targetId, app);
    });
    if (advertising.length === 0) {
      if (load > 0)
        failRps({
          cause: 'no_app_target',
          nodeIds: [],
          connectionIds: [],
          failedRps: load,
          pressure: 1,
          appIds: [app],
        });
      continue;
    }
    const share = load / advertising.length;
    for (const route of advertising) {
      if (!route.allowed) {
        failRps({
          cause: 'sg_blocked',
          nodeIds: [route.targetId],
          connectionIds: [route.connectionId],
          failedRps: share,
          pressure: 1,
          appIds: [app],
        });
        continue;
      }
      const alb = model.albs.get(route.targetId);
      if (!alb) {
        // Direct Internet → server: no health checks, so failed instances keep receiving traffic.
        deliver(route.targetId, app, share, undetectedFailed(route.targetId, Infinity), false);
        continue;
      }
      nodes[alb.id] = { loadPerSec: (nodes[alb.id]?.loadPerSec ?? 0) + share };
      const weights = alb.targets
        .filter((t) => t.allowed && runs(t.targetId, app))
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
          appIds: [app],
        });
        continue;
      }
      for (const w of weights) deliver(w.t.targetId, app, (share * w.routable) / total, w.bad, true);
    }
  }

  // 3. Compute groups: apps on one server share its CPU units.
  const served = new Map<
    NodeId,
    { byApp: Map<AppId, { rps: number; albFraction: number }>; rho: number; waitSec: number }
  >();
  for (const g of state.groups.values()) {
    const id = g.model.id;
    const byApp = arrivals.get(id) ?? new Map<AppId, { rps: number; viaAlbRps: number }>();
    const capacity = count(g, 'running') * g.model.capacityPerInstance;
    const groupApps = [...new Set([...byApp.keys(), ...g.backlog.keys()])];
    const demandReq = new Map(
      groupApps.map((app) => [app, (byApp.get(app)?.rps ?? 0) * stepSec + (g.backlog.get(app) ?? 0)]),
    );
    const demandUnits = groupApps.reduce((s, app) => s + (demandReq.get(app) ?? 0) * cpu(app), 0);
    const servedUnits = Math.min(demandUnits, capacity * stepSec);
    const fraction = demandUnits > 0 ? servedUnits / demandUnits : 0;
    const excessUnits = demandUnits - servedUnits;
    const keep = excessUnits > 0 ? Math.min(1, (capacity * BALANCE.queueSeconds) / excessUnits) : 0;
    const arrivalUnits = groupApps.reduce((s, app) => s + (byApp.get(app)?.rps ?? 0) * cpu(app), 0);
    const rho = capacity > 0 ? arrivalUnits / capacity : arrivalUnits > 0 ? Infinity : 0;

    const servedByApp = new Map<AppId, { rps: number; albFraction: number }>();
    let backlogUnits = 0;
    let backlogReq = 0;
    let anyDropped = false;
    for (const app of groupApps) {
      const demand = demandReq.get(app) ?? 0;
      const excess = demand * (1 - fraction);
      const backlog = excess * keep;
      const dropped = excess - backlog;
      g.backlog.set(app, backlog);
      backlogUnits += backlog * cpu(app);
      backlogReq += backlog;
      if (dropped > 0) {
        anyDropped = true;
        failRps({
          cause: 'compute_saturated',
          nodeIds: [id],
          connectionIds: [],
          failedRps: dropped / stepSec,
          pressure: Number.isFinite(rho) ? rho : 1,
          appIds: [app],
        });
      }
      const a = byApp.get(app);
      servedByApp.set(app, {
        rps: (demand * fraction) / stepSec,
        albFraction: a && a.rps > 0 ? a.viaAlbRps / a.rps : 0,
      });
    }
    if (!anyDropped && rho >= BALANCE.highUtilization) {
      note({
        cause: 'compute_high_utilization',
        nodeIds: [id],
        connectionIds: [],
        failedRps: 0,
        pressure: rho,
        appIds: [],
      });
    }
    served.set(id, { byApp: servedByApp, rho, waitSec: capacity > 0 ? backlogUnits / capacity : 0 });
    nodes[id] = {
      loadPerSec: arrivalUnits,
      loadByApp: Object.fromEntries([...byApp].map(([app, a]) => [app, a.rps])),
      utilization: Number.isFinite(rho) ? rho : 1,
      instances: count(g, 'running'),
      pendingInstances: count(g, 'pending'),
      failedInstances: count(g, 'failed'),
      ...(g.model.autoScaling ? { desiredCapacity: g.desired } : {}),
      capacityPerSec: capacity,
      backlog: backlogReq,
    };
  }

  // 4. Databases.
  const qprOf = (app: AppId) => appOf.get(app)?.queriesPerRequest ?? 0;
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
        for (const [app, sv] of served.get(g.model.id)?.byApp ?? []) qps += sv.rps * qprOf(app);
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

  // Attribute DB failures per compute group and app, and compute latency.
  const success = new Map<AppId, number>();
  const latencyWeighted = new Map<AppId, number>();
  const dbIssues = new Map<string, StepIssue>();
  const addDbIssue = (issue: StepIssue) => {
    const key = `${issue.cause}|${issue.nodeIds.join()}|${issue.connectionIds.join()}|${issue.appIds.join()}`;
    const prev = dbIssues.get(key);
    dbIssues.set(key, prev ? { ...prev, failedRps: prev.failedRps + issue.failedRps } : issue);
  };
  for (const g of state.groups.values()) {
    const sv = served.get(g.model.id);
    if (!sv) continue;
    for (const [app, s] of sv.byApp) {
      if (s.rps === 0) continue;
      let remaining = s.rps;
      const qpr = qprOf(app);
      let latency =
        BALANCE.latency.albMs * s.albFraction +
        BALANCE.latency.computeMs * cpu(app) * queueFactor(sv.rho) +
        sv.waitSec * 1000;
      if (qpr > 0 && g.model.dbLinks.length === 0) {
        // The application needs its database; a server that is not connected to one cannot answer.
        addDbIssue({
          cause: 'no_database',
          nodeIds: [g.model.id],
          connectionIds: [],
          failedRps: remaining,
          pressure: 1,
          appIds: [app],
        });
        remaining = 0;
      }
      for (const link of qpr > 0 ? g.model.dbLinks : []) {
        if (remaining <= 0) break;
        if (!link.allowed) {
          addDbIssue({
            cause: 'sg_blocked',
            nodeIds: [link.dbId],
            connectionIds: [link.connectionId],
            failedRps: remaining,
            pressure: 1,
            appIds: [app],
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
            appIds: [app],
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
            appIds: [app],
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
            appIds: [app],
          });
        }
        remaining -= capFailed;
        latency += BALANCE.latency.dbPerQueryMs * qpr * queueFactor(st.rho);
      }
      success.set(app, (success.get(app) ?? 0) + remaining);
      latencyWeighted.set(
        app,
        (latencyWeighted.get(app) ?? 0) + remaining * Math.min(latency, BALANCE.latency.timeoutMs),
      );
    }
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
        appIds: [],
      });
    }
  }

  // Per-app and total metrics. Requests still in a backlog are neither successes nor failures yet.
  const appMetrics: Partial<Record<AppId, AppStepMetrics>> = {};
  let totalOffered = 0;
  let totalSuccess = 0;
  let totalError = 0;
  let totalLatencyWeighted = 0;
  for (const { appId: app } of apps) {
    const off = offered.get(app) ?? 0;
    const ok = success.get(app) ?? 0;
    const errorRps = Math.max(0, failed.get(app) ?? 0);
    const lw = latencyWeighted.get(app) ?? 0;
    appMetrics[app] = {
      offeredRps: off,
      successRps: ok,
      errorRps,
      errorRate: off > 0 ? Math.min(1, errorRps / off) : 0,
      latencyMs: ok > 0 ? lw / ok : BALANCE.latency.timeoutMs,
    };
    totalOffered += off;
    totalSuccess += ok;
    totalError += errorRps;
    totalLatencyWeighted += lw;
  }

  return {
    issues,
    routed,
    metrics: {
      minute,
      offeredRps: totalOffered,
      successRps: totalSuccess,
      errorRps: totalError,
      errorRate: totalOffered > 0 ? Math.min(1, totalError / totalOffered) : 0,
      latencyMs: totalSuccess > 0 ? totalLatencyWeighted / totalSuccess : BALANCE.latency.timeoutMs,
      nodes,
      apps: appMetrics,
    },
  };
};

type Series = readonly Pick<
  StepMetrics,
  'offeredRps' | 'errorRps' | 'successRps' | 'latencyMs' | 'errorRate'
>[];

const summarizeSeries = (steps: Series, stepSec: number): SimulationSummary => {
  const total = steps.reduce((s, m) => s + m.offeredRps * stepSec, 0);
  const failedReq = steps.reduce((s, m) => s + m.errorRps * stepSec, 0);
  const success = steps.reduce((s, m) => s + m.successRps, 0);
  const latencies = steps.map((m) => m.latencyMs).sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);
  return {
    totalRequests: total,
    failedRequests: failedReq,
    errorRate: total > 0 ? failedReq / total : 0,
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

const summarize = (
  steps: readonly StepMetrics[],
  apps: readonly AppId[],
  stepSec: number,
): SimulationSummaryWithApps => ({
  ...summarizeSeries(steps, stepSec),
  apps: Object.fromEntries(
    apps.map((app) => [
      app,
      summarizeSeries(
        steps.map(
          (s) => s.apps[app] ?? { offeredRps: 0, successRps: 0, errorRps: 0, errorRate: 0, latencyMs: 0 },
        ),
        stepSec,
      ),
    ]),
  ),
});

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
  const apps = scenarioApps(scenario);
  const findings = validateDiagram(input.diagram, { requiredApps: apps.map((a) => a.appId) });
  if (hasErrors(findings)) return err({ kind: 'invalid_diagram', findings });

  const model = compileDiagram(input.diagram);
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

    // One noise draw per app per step, in scenario order (a single-app scenario draws exactly as before).
    const offered = new Map<AppId, number>();
    for (const app of apps) {
      const noise = 1 + (app.workload.noisePct / 100) * (2 * noiseRand() - 1);
      offered.set(app.appId, workloadRpsAt(app.workload, minute) * noise);
    }
    const { metrics, issues, routed } = runStep(model, state, scenario, apps, minute, nowSec, offered);

    // Billing uses the instances that existed during the step, before scaling decisions.
    let costPerHour = 0;
    for (const id of model.billableNodeIds) {
      const node = input.diagram.resources[id];
      if (!node) continue;
      const g = state.groups.get(id);
      const rate = resourceCostPerHour(node, g ? count(g, 'running') + count(g, 'pending') : undefined);
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
    summary: summarize(
      steps,
      apps.map((a) => a.appId),
      scenario.stepSec,
    ),
    cost,
    bottlenecks: aggregateBottlenecks(issuesByStep, scenario.stepSec),
    timeline: state.timeline,
    findings,
  });
};

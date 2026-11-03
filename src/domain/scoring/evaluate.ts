import type { Dimension, Mission } from '../missions/mission';
import type { AppId } from '../catalog/apps';
import type { Bottleneck, BottleneckCause, SimulationResult, SimulationSummary } from '../simulation/types';
import type { Finding } from '../validation/findings';

/**
 * Mission evaluation (see docs/SCORING.md). Every rule is explicit; there are no hidden criteria.
 */

export type Metric =
  'availability' | 'errorRate' | 'p95LatencyMs' | 'projectedMonthly' | 'criticalSecurityFindings';

export interface Check {
  readonly metric: Metric;
  /** Set when the check judges one application (multi-app missions). */
  readonly appId?: AppId;
  readonly actual: number;
  readonly target: number;
  readonly comparator: '<=' | '>=';
  readonly passed: boolean;
}

export interface DimensionResult {
  readonly dimension: Dimension;
  readonly passed: boolean;
  /** 0–100 */
  readonly score: number;
  readonly checks: readonly Check[];
}

export type LearningTopic =
  | 'horizontal_scaling'
  | 'auto_scaling'
  | 'database_sizing'
  | 'connection_pooling'
  | 'health_checks'
  | 'multi_az'
  | 'security_groups'
  | 'cost_optimization'
  | 'dependencies'
  | 'workload_isolation';

/** A cause on specific resources, with every time window in which it failed requests. */
export interface KeyBottleneck {
  readonly cause: BottleneckCause;
  readonly nodeIds: readonly string[];
  readonly connectionIds: readonly string[];
  readonly appIds: readonly string[];
  readonly windows: readonly { readonly startMinute: number; readonly endMinute: number }[];
  readonly failedRequests: number;
  readonly peak: number;
}

/** Group failure windows by (cause, resources), most failed requests first. */
export const groupBottlenecks = (bottlenecks: readonly Bottleneck[], limit = 3): KeyBottleneck[] => {
  const groups = new Map<string, KeyBottleneck>();
  for (const b of bottlenecks) {
    if (b.failedRequests <= 0) continue;
    const key = `${b.cause}|${b.nodeIds.join()}|${b.connectionIds.join()}|${b.appIds.join()}`;
    const prev = groups.get(key);
    const window = { startMinute: b.startMinute, endMinute: b.endMinute };
    groups.set(
      key,
      prev
        ? {
            ...prev,
            windows: [...prev.windows, window].sort((x, y) => x.startMinute - y.startMinute),
            failedRequests: prev.failedRequests + b.failedRequests,
            peak: Math.max(prev.peak, b.peak),
          }
        : {
            cause: b.cause,
            nodeIds: b.nodeIds,
            connectionIds: b.connectionIds,
            appIds: b.appIds,
            windows: [window],
            failedRequests: b.failedRequests,
            peak: b.peak,
          },
    );
  }
  return [...groups.values()].sort((a, b) => b.failedRequests - a.failedRequests).slice(0, limit);
};

export interface EvaluationResult {
  readonly missionId: string;
  readonly inputHash: string;
  readonly passed: boolean;
  /** Weighted 0–100 */
  readonly overallScore: number;
  readonly dimensions: readonly DimensionResult[];
  /** Up to three causes of failed requests, grouped per resource, most impactful first. */
  readonly keyBottlenecks: readonly KeyBottleneck[];
  readonly securityFindings: readonly Finding[];
  readonly learningTopics: readonly LearningTopic[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const check = (metric: Metric, actual: number, comparator: '<=' | '>=', target: number): Check => ({
  metric,
  actual,
  target,
  comparator,
  passed: comparator === '<=' ? actual <= target + 1e-9 : actual >= target - 1e-9,
});

/** Full marks at the target; linearly to zero `span` beyond it. */
const graded = (c: Check, span: number): number => {
  if (c.passed) return 100;
  const miss = c.comparator === '<=' ? c.actual - c.target : c.target - c.actual;
  return 100 * clamp01(1 - miss / span);
};

export const SCORING = {
  availabilitySpan: 0.2,
  errorRateSpan: 0.1,
  /** Within budget: 60 points, plus up to 40 for headroom (full at 50% under budget). */
  costPassBase: 60,
  costHeadroomForFull: 0.5,
  /** Over budget: from 60 down to 0 at 50% over. */
  costOverSpan: 0.5,
  securityMajorPenalty: 25,
  securityMinorPenalty: 10,
} as const;

const TOPIC_BY_CAUSE: Record<BottleneckCause, LearningTopic> = {
  compute_saturated: 'horizontal_scaling',
  compute_high_utilization: 'auto_scaling',
  compute_unavailable: 'multi_az',
  db_capacity: 'database_sizing',
  db_high_utilization: 'database_sizing',
  db_connections: 'connection_pooling',
  db_unavailable: 'multi_az',
  unhealthy_target: 'health_checks',
  no_healthy_targets: 'multi_az',
  sg_blocked: 'security_groups',
  no_database: 'dependencies',
  no_app_target: 'dependencies',
};

export const evaluateMission = (mission: Mission, sim: SimulationResult): EvaluationResult => {
  const o = mission.objectives;
  const s = sim.summary;
  const S = SCORING;

  // Single-app missions judge the totals; multi-app missions judge each app against its own objectives.
  const targets: {
    appId?: AppId;
    summary: SimulationSummary;
    o: { maxErrorRate: number; maxP95LatencyMs: number; minAvailability: number };
  }[] = mission.appObjectives
    ? (
        Object.entries(mission.appObjectives) as [AppId, NonNullable<Mission['appObjectives']>[AppId]][]
      ).flatMap(([appId, ao]) => {
        const summary = s.apps[appId];
        return summary && ao ? [{ appId, summary, o: ao }] : [];
      })
    : [{ summary: s, o }];
  const withApp = (c: Check, appId?: AppId): Check => (appId ? { ...c, appId } : c);
  const availChecks = targets.map((t) =>
    withApp(check('availability', t.summary.availability, '>=', t.o.minAvailability), t.appId),
  );
  const perfChecks = targets.map((t) => ({
    err: withApp(check('errorRate', t.summary.errorRate, '<=', t.o.maxErrorRate), t.appId),
    lat: withApp(check('p95LatencyMs', t.summary.p95LatencyMs, '<=', t.o.maxP95LatencyMs), t.appId),
    maxLatency: t.o.maxP95LatencyMs,
  }));
  const costCheck = check('projectedMonthly', sim.cost.projectedMonthly, '<=', o.monthlyBudget);

  const securityFindings = sim.findings.filter((f) => f.category === 'security');
  const critical = securityFindings.filter((f) => f.riskLevel === 'critical').length;
  const major = securityFindings.filter((f) => f.riskLevel === 'major').length;
  const minor = securityFindings.filter((f) => f.riskLevel === 'minor').length;
  const secCheck = check('criticalSecurityFindings', critical, '<=', 0);

  const ratio = sim.cost.projectedMonthly / o.monthlyBudget;
  const costScore = costCheck.passed
    ? S.costPassBase + (100 - S.costPassBase) * clamp01((1 - ratio) / S.costHeadroomForFull)
    : S.costPassBase * clamp01(1 - (ratio - 1) / S.costOverSpan);

  const raw: DimensionResult[] = [
    {
      dimension: 'availability',
      passed: availChecks.every((c) => c.passed),
      score: Math.min(...availChecks.map((c) => graded(c, S.availabilitySpan))),
      checks: availChecks,
    },
    {
      dimension: 'performance',
      passed: perfChecks.every((p) => p.err.passed && p.lat.passed),
      score: Math.min(
        ...perfChecks.map((p) => Math.min(graded(p.err, S.errorRateSpan), graded(p.lat, p.maxLatency))),
      ),
      checks: perfChecks.flatMap((p) => [p.err, p.lat]),
    },
    { dimension: 'cost', passed: costCheck.passed, score: costScore, checks: [costCheck] },
    {
      dimension: 'security',
      passed: secCheck.passed,
      score:
        critical > 0 ? 0 : Math.max(0, 100 - S.securityMajorPenalty * major - S.securityMinorPenalty * minor),
      checks: [secCheck],
    },
  ];
  const dimensions = raw.map((d) => ({ ...d, score: Math.round(d.score) }));

  const w = mission.scoringWeights;
  const totalWeight = w.availability + w.performance + w.cost + w.security;
  const overallScore =
    totalWeight > 0
      ? Math.round(dimensions.reduce((sum, d) => sum + d.score * w[d.dimension], 0) / totalWeight)
      : 0;

  const keyBottlenecks = groupBottlenecks(sim.bottlenecks);
  const topics = new Set<LearningTopic>(keyBottlenecks.map((b) => TOPIC_BY_CAUSE[b.cause]));
  if (!costCheck.passed) topics.add('cost_optimization');
  // An app that missed its latency target while sharing servers with another app: a noisy neighbour.
  const sharedApps = new Set<string>();
  for (const step of sim.steps) {
    for (const n of Object.values(step.nodes)) {
      const apps = Object.keys(n.loadByApp ?? {});
      if (apps.length > 1) for (const a of apps) sharedApps.add(a);
    }
  }
  if (perfChecks.some((p) => !p.lat.passed && p.err.appId !== undefined && sharedApps.has(p.err.appId))) {
    topics.add('workload_isolation');
  }
  if (securityFindings.length > 0) topics.add('security_groups');

  return {
    missionId: mission.id,
    inputHash: sim.inputHash,
    passed: dimensions.every((d) => d.passed),
    overallScore,
    dimensions,
    keyBottlenecks,
    securityFindings,
    learningTopics: [...topics],
  };
};

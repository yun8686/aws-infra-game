import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../../src/data/missions';
import { evaluateMission } from '../../src/domain/scoring/evaluate';
import type { SimulationResult } from '../../src/domain/simulation';
import { finding } from '../../src/domain/validation/findings';

const mission = MISSIONS['tv-spike']; // errors ≤1%, p95 ≤400ms, availability ≥97%, budget 16000

const fakeSim = (over: {
  errorRate?: number;
  p95?: number;
  availability?: number;
  monthly?: number;
  findings?: SimulationResult['findings'];
}): SimulationResult => ({
  engineVersion: 0,
  balanceVersion: 0,
  inputHash: 'h',
  scenarioId: 'x',
  seed: 0,
  steps: [],
  timeline: [],
  bottlenecks: [],
  findings: over.findings ?? [],
  cost: { runCost: 0, baselineHourly: 0, projectedMonthly: over.monthly ?? 12000, runCostByNode: {} },
  summary: {
    totalRequests: 1,
    failedRequests: 0,
    errorRate: over.errorRate ?? 0,
    peakErrorRate: 0,
    meanLatencyMs: 100,
    p95LatencyMs: over.p95 ?? 200,
    availability: over.availability ?? 1,
  },
});

const dim = (r: ReturnType<typeof evaluateMission>, d: string) => r.dimensions.find((x) => x.dimension === d);

describe('evaluateMission', () => {
  it('passes when every objective is met', () => {
    const r = evaluateMission(mission, fakeSim({}));
    expect(r.passed).toBe(true);
    expect(r.dimensions.map((d) => d.passed)).toEqual([true, true, true, true]);
  });

  it('grades availability linearly below the target', () => {
    expect(dim(evaluateMission(mission, fakeSim({ availability: 0.87 })), 'availability')).toMatchObject({
      passed: false,
      score: 50,
    });
    expect(dim(evaluateMission(mission, fakeSim({ availability: 0.5 })), 'availability')?.score).toBe(0);
  });

  it('performance takes the worse of error rate and latency', () => {
    const r = evaluateMission(mission, fakeSim({ errorRate: 0.06, p95: 200 }));
    expect(dim(r, 'performance')).toMatchObject({ passed: false, score: 50 });
    const slow = evaluateMission(mission, fakeSim({ p95: 600 }));
    expect(dim(slow, 'performance')).toMatchObject({ passed: false, score: 50 });
  });

  it('rewards budget headroom and penalises overspend', () => {
    const at = (monthly: number) => dim(evaluateMission(mission, fakeSim({ monthly })), 'cost');
    expect(at(16000)).toMatchObject({ passed: true, score: 60 });
    expect(at(12000)?.score).toBe(80);
    expect(at(8000)?.score).toBe(100);
    expect(at(4000)?.score).toBe(100);
    expect(at(20000)).toMatchObject({ passed: false, score: 30 });
    expect(at(24000)?.score).toBe(0);
  });

  it('cheaper passing solutions score higher than expensive passing ones', () => {
    const cheap = evaluateMission(mission, fakeSim({ monthly: 10000 }));
    const pricey = evaluateMission(mission, fakeSim({ monthly: 15900 }));
    expect(cheap.overallScore).toBeGreaterThan(pricey.overallScore);
  });

  it('a critical security finding fails security; lesser findings reduce the score', () => {
    const crit = finding(
      'security.db_port_open_to_internet',
      'warning',
      'security',
      {},
      { riskLevel: 'critical' },
    );
    const major = finding(
      'security.admin_port_open_to_internet',
      'warning',
      'security',
      {},
      { riskLevel: 'major' },
    );
    const minor = finding(
      'security.compute_directly_exposed',
      'warning',
      'security',
      {},
      { riskLevel: 'minor' },
    );
    expect(dim(evaluateMission(mission, fakeSim({ findings: [crit] })), 'security')).toMatchObject({
      passed: false,
      score: 0,
    });
    const r = evaluateMission(mission, fakeSim({ findings: [major, minor] }));
    expect(dim(r, 'security')).toMatchObject({ passed: true, score: 65 });
    expect(r.learningTopics).toContain('security_groups');
  });

  it('weights dimensions as declared by the mission', () => {
    // availability 3, performance 3, cost 2, security 2; availability 0 → 100 * (3+2+2)/10 with cost 80
    const r = evaluateMission(mission, fakeSim({ availability: 0, monthly: 12000 }));
    expect(r.overallScore).toBe(Math.round((0 * 3 + 100 * 3 + 80 * 2 + 100 * 2) / 10));
  });
});

describe('groupBottlenecks', () => {
  it('merges windows of the same cause on the same resource', async () => {
    const { groupBottlenecks } = await import('../../src/domain/scoring/evaluate');
    const b = (cause: 'compute_saturated' | 'unhealthy_target', start: number, failed: number) => ({
      cause,
      nodeIds: ['ec2-1'],
      connectionIds: [],
      startMinute: start,
      endMinute: start + 5,
      peak: 1,
      failedRequests: failed,
    });
    const g = groupBottlenecks([
      b('compute_saturated', 30, 100),
      b('unhealthy_target', 55, 50),
      b('compute_saturated', 100, 20),
    ]);
    expect(g.map((x) => [x.cause, x.windows.map((w) => w.startMinute), x.failedRequests])).toEqual([
      ['compute_saturated', [30, 100], 120],
      ['unhealthy_target', [55], 50],
    ]);
  });
});

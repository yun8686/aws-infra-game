import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../src/data/scenarios';
import { TEMPLATES } from '../../src/data/templates';
import { updateNodeConfig } from '../../src/domain/graph/commands';
import type { InfrastructureGraph } from '../../src/domain/graph/types';
import {
  baseRpsAt,
  createPrng,
  simulate,
  stableStringify,
  type SimulationResult,
} from '../../src/domain/simulation';
import { aggregateBottlenecks } from '../../src/domain/simulation/bottlenecks';
import { buildWebStackFromBaseline, unwrap } from '../fixtures/builders';
import { setWebServers } from '../fixtures/solutions';

const template = () => TEMPLATES['ecommerce-starter']();
const run = (graph: InfrastructureGraph, scenario = SCENARIOS['tv-spike'], seed = 1): SimulationResult => {
  const r = simulate({ graph, scenario, seed });
  if (!r.ok) throw new Error(`simulation refused: ${JSON.stringify(r.error)}`);
  return r.value;
};
const withConfig = (g: InfrastructureGraph, nodeId: string, patch: Record<string, unknown>) =>
  unwrap(updateNodeConfig(g, nodeId, { ...(g.nodes[nodeId]?.config as object), ...patch })).graph;
const causes = (r: SimulationResult) => r.bottlenecks.filter((b) => b.failedRequests > 0).map((b) => b.cause);

describe('determinism', () => {
  it('same graph, scenario and seed give identical results', () => {
    const a = run(template());
    const b = run(structuredClone(template()));
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(a.inputHash).toBe(b.inputHash);
  });

  it('a different seed changes the noise and the input hash', () => {
    const a = run(template(), SCENARIOS['tv-spike'], 1);
    const b = run(template(), SCENARIOS['tv-spike'], 2);
    expect(a.inputHash).not.toBe(b.inputHash);
    expect(a.steps[0]?.offeredRps).not.toBe(b.steps[0]?.offeredRps);
  });

  it('the PRNG is reproducible and in [0,1)', () => {
    const r1 = createPrng(42);
    const r2 = createPrng(42);
    for (let i = 0; i < 100; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('workload', () => {
  it('interpolates between points and clamps at the ends', () => {
    const s = SCENARIOS['tv-spike'];
    expect(baseRpsAt(s, 0)).toBe(50);
    expect(baseRpsAt(s, 35)).toBe(275);
    expect(baseRpsAt(s, 60)).toBe(500);
    expect(baseRpsAt(s, 200)).toBe(50);
  });
});

describe('MVP simulation acceptance criteria', () => {
  it('the template handles steady traffic without errors', () => {
    const r = run(template(), SCENARIOS.steady);
    expect(r.summary.errorRate).toBe(0);
    expect(r.summary.availability).toBe(1);
    expect(r.summary.meanLatencyMs).toBeLessThan(150);
  });

  it('the template fails the spike because compute saturates', () => {
    const r = run(template());
    expect(r.summary.errorRate).toBeGreaterThan(0.3);
    expect(r.bottlenecks[0]?.cause).toBe('compute_saturated');
    expect(['ec2-1', 'ec2-2']).toContain(r.bottlenecks[0]?.nodeIds[0]);
    expect(r.bottlenecks[0]?.startMinute).toBeGreaterThanOrEqual(30);
  });

  it('increasing compute capacity improves a compute-bound outcome', () => {
    // Remove the DB as a limit to isolate compute.
    const base = withConfig(template(), 'rds-1', { instanceClass: 'db.xlarge' });
    const errorsByCount = [2, 4, 8, 12].map((n) => run(setWebServers(base, n)).summary.failedRequests);
    for (let i = 1; i < errorsByCount.length; i++) {
      expect(errorsByCount[i]).toBeLessThan(errorsByCount[i - 1] as number);
    }
    expect(errorsByCount[3]).toBe(0);
    // Size also counts.
    const bigger = run(setWebServers(base, 2, { size: 'large' }));
    expect(bigger.summary.failedRequests).toBeLessThan(errorsByCount[0] as number);
  });

  it('increasing compute alone does not solve a database-bound bottleneck', () => {
    const scaled = run(setWebServers(template(), 12));
    expect(scaled.summary.errorRate).toBeGreaterThan(0.3);
    expect(causes(scaled)).not.toContain('compute_saturated');
    expect(causes(scaled)).toEqual(expect.arrayContaining(['db_connections', 'db_capacity']));
  });

  it('scaling compute and the database together resolves the spike', () => {
    const g = withConfig(setWebServers(template(), 12), 'rds-1', {
      instanceClass: 'db.large',
    });
    const r = run(g);
    expect(r.summary.errorRate).toBe(0);
    expect(r.summary.p95LatencyMs).toBeLessThan(500);
  });

  it('connection pressure grows with instance count and pool size', () => {
    const g = withConfig(template(), 'rds-1', { instanceClass: 'db.xlarge' });
    const conns = (graph: InfrastructureGraph) =>
      run(graph, SCENARIOS.steady).steps[0]?.nodes['rds-1']?.connections;
    expect(conns(g)).toBe(20);
    expect(conns(setWebServers(g, 6))).toBe(60);
  });

  it('cost increases with resource count, size and duration', () => {
    const base = run(template(), SCENARIOS.steady).cost;
    const more = run(setWebServers(template(), 4), SCENARIOS.steady).cost;
    const larger = run(withConfig(template(), 'ec2-1', { instanceSize: 'large' }), SCENARIOS.steady).cost;
    const longer = run(template(), { ...SCENARIOS.steady, durationMin: 120 }).cost;
    expect(more.runCost).toBeGreaterThan(base.runCost);
    expect(larger.runCost).toBeGreaterThan(base.runCost);
    expect(longer.runCost).toBeCloseTo(base.runCost * 2, 6);
    expect(base.baselineHourly).toBe(7); // ALB 2 + 2 × small 1 + db.small 3
    expect(base.projectedMonthly).toBe(7 * 730);
  });

  it('disconnected compute provides no capacity but still costs money', () => {
    const s = buildWebStackFromBaseline();
    const before = run(s.b.graph);
    const idle = s.b.add('compute.ec2', { instanceSize: 'xlarge' });
    s.b.link(idle, s.privB, 'placed_in');
    s.b.link(idle, s.sgWeb, 'secured_by');
    const after = run(s.b.graph);
    expect(after.summary.failedRequests).toBeCloseTo(before.summary.failedRequests, 6);
    expect(after.cost.runCost).toBeGreaterThan(before.cost.runCost);
    expect(after.steps[40]?.nodes[idle]?.loadPerSec).toBe(0);
  });
});

describe('security groups in the request path', () => {
  it('a blocked database link fails every request that needs it', () => {
    const g = unwrap(
      updateNodeConfig(template(), 'sg-3', { inboundRules: [{ port: 3306, source: { kind: 'vpc' } }] }),
    ).graph;
    const r = run(g, SCENARIOS.steady);
    expect(r.summary.errorRate).toBeCloseTo(1, 6);
    expect(r.bottlenecks[0]).toMatchObject({ cause: 'sg_blocked', nodeIds: ['rds-1'] });
  });

  it('an ALB with only blocked targets has no healthy targets', () => {
    const g = unwrap(updateNodeConfig(template(), 'sg-2', { inboundRules: [] })).graph;
    const r = run(g, SCENARIOS.steady);
    expect(r.summary.errorRate).toBeCloseTo(1, 6);
    expect(r.bottlenecks[0]).toMatchObject({ cause: 'no_healthy_targets', nodeIds: ['alb-1'] });
  });
});

describe('refusal and outputs', () => {
  it('refuses a graph with validation errors', () => {
    const g = unwrap(
      updateNodeConfig(template(), 'alb-1', {
        scheme: 'internal',
        listener: 'http',
        healthCheck: { intervalSec: 30, unhealthyThreshold: 3 },
      }),
    ).graph;
    const r = simulate({ graph: g, scenario: SCENARIOS.steady, seed: 1 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('invalid_graph');
  });

  it('refuses an invalid scenario', () => {
    const r = simulate({ graph: template(), scenario: { ...SCENARIOS.steady, durationMin: 0 }, seed: 1 });
    expect(!r.ok && r.error.kind).toBe('invalid_scenario');
  });

  it('produces one step per minute and conserves requests', () => {
    const r = run(template());
    expect(r.steps).toHaveLength(120);
    // Every offered request either succeeds, fails, or is still queued at the end.
    const offered = r.steps.reduce((a, s) => a + s.offeredRps * 60, 0);
    const settled = r.steps.reduce((a, s) => a + (s.successRps + s.errorRps) * 60, 0);
    const queued =
      (r.steps.at(-1)?.nodes['ec2-1']?.backlog ?? 0) + (r.steps.at(-1)?.nodes['ec2-2']?.backlog ?? 0);
    expect(settled + queued).toBeCloseTo(offered, 3);
    for (const s of r.steps) {
      expect(s.errorRate).toBeGreaterThanOrEqual(0);
      expect(s.errorRate).toBeLessThanOrEqual(1);
    }
  });

  it('merges noisy bottleneck windows separated by short gaps', () => {
    const issue = {
      cause: 'db_high_utilization' as const,
      nodeIds: ['db'],
      connectionIds: [],
      failedRps: 0,
      pressure: 0.9,
    };
    const merged = aggregateBottlenecks([[issue], [], [issue], [], [], [], [issue]], 60);
    expect(merged.map((b) => [b.startMinute, b.endMinute])).toEqual([
      [0, 2],
      [6, 6],
    ]);
  });
});

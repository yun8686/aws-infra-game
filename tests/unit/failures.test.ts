import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../src/data/scenarios';
import { TEMPLATES } from '../../src/data/templates';
import { connect } from '../../src/domain/graph/commands';
import type { InfrastructureGraph } from '../../src/domain/graph/types';
import { simulate, stableStringify, type Scenario, type SimulationResult } from '../../src/domain/simulation';
import { GraphBuilder, unwrap } from '../fixtures/builders';
import { ASG_SMALL, replaceWebWithAutoScaling, setConfig } from '../fixtures/solutions';

const template = () => TEMPLATES['ecommerce-starter']();
const run = (graph: InfrastructureGraph, scenario: Scenario, seed = 1): SimulationResult => {
  const r = simulate({ graph, scenario, seed });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
const steady = (events: Scenario['events'], durationMin = 60, rps = 80): Scenario => ({
  ...SCENARIOS.steady,
  id: 'test',
  durationMin,
  workload: { points: [{ atMin: 0, rps }], noisePct: 0 },
  events,
});
const failedIn = (r: SimulationResult, from: number, to: number) =>
  r.steps.filter((s) => s.minute >= from && s.minute <= to).reduce((a, s) => a + s.errorRps * 60, 0);
const spreadAcrossAzs = (g: InfrastructureGraph) =>
  unwrap(
    connect(setConfig(g, 'ec2-1', { instanceCount: 4 }), {
      sourceNodeId: 'ec2-1',
      targetNodeId: 'subnet-4',
      connectionType: 'placed_in',
    }),
  ).graph;

describe('redundancy changes the impact of failures (MVP acceptance)', () => {
  it('an AZ outage takes down a single-AZ web tier but not a two-AZ one', () => {
    const scenario = SCENARIOS['az-a-outage'];
    const single = run(setConfig(template(), 'rds-1', { multiAz: true }), scenario);
    const multi = run(setConfig(spreadAcrossAzs(template()), 'rds-1', { multiAz: true }), scenario);
    expect(single.bottlenecks[0]).toMatchObject({ cause: 'no_healthy_targets', nodeIds: ['alb-1'] });
    expect(single.summary.errorRate).toBeGreaterThan(0.3);
    expect(multi.summary.errorRate).toBeLessThan(0.05);
  });

  it('Multi-AZ RDS fails over in minutes while single-AZ RDS stays down', () => {
    const scenario = steady([{ kind: 'db_failure', atMin: 10 }]);
    const single = run(template(), scenario);
    const multi = run(setConfig(template(), 'rds-1', { multiAz: true }), scenario);
    const singleDown = single.bottlenecks.find((b) => b.cause === 'db_unavailable');
    const multiDown = multi.bottlenecks.find((b) => b.cause === 'db_unavailable');
    expect(singleDown).toMatchObject({ startMinute: 10, endMinute: 24 });
    expect(multiDown).toMatchObject({ startMinute: 10, endMinute: 11 });
    expect(multi.timeline.map((e) => e.kind)).toEqual(['db_failure', 'db_failover', 'db_recovered']);
  });

  it('a single-AZ database is down for the outage plus recovery when its AZ fails', () => {
    const r = run(spreadAcrossAzs(template()), SCENARIOS['az-a-outage']);
    const down = r.bottlenecks.find((b) => b.cause === 'db_unavailable');
    expect(down).toMatchObject({ startMinute: 15, endMinute: 39 });
  });

  it('Auto Scaling replaces a failed instance; a fixed group stays degraded', () => {
    const scenario = steady([{ kind: 'instance_failure', atMin: 10, count: 1 }], 30, 60);
    const fixed = run(template(), scenario);
    const asg = run(
      replaceWebWithAutoScaling(template(), { ...ASG_SMALL, minCapacity: 2, maxCapacity: 2 }).graph,
      scenario,
    );
    expect(fixed.steps[25]?.nodes['ec2-1']).toMatchObject({ instances: 1, failedInstances: 1 });
    expect(fixed.summary.errorRate).toBeGreaterThan(0.1);
    expect(asg.steps[25]?.nodes['asg-1']).toMatchObject({ instances: 2, failedInstances: 0 });
    expect(asg.timeline.map((e) => e.kind)).toEqual([
      'instance_failure',
      'failure_detected',
      'instance_launched',
      'instance_ready',
    ]);
    expect(asg.summary.errorRate).toBeLessThan(fixed.summary.errorRate);
  });
});

describe('health checks', () => {
  it('faster health checks reduce requests lost to a failed instance', () => {
    const g = setConfig(template(), 'ec2-1', { instanceCount: 4 });
    const scenario = steady([{ kind: 'instance_failure', atMin: 5, count: 1 }], 20, 100);
    const slow = run(
      setConfig(g, 'alb-1', { healthCheck: { intervalSec: 60, unhealthyThreshold: 5 } }),
      scenario,
    );
    const fast = run(
      setConfig(g, 'alb-1', { healthCheck: { intervalSec: 10, unhealthyThreshold: 2 } }),
      scenario,
    );
    const lost = (r: SimulationResult) =>
      r.bottlenecks.filter((b) => b.cause === 'unhealthy_target').reduce((a, b) => a + b.failedRequests, 0);
    expect(lost(fast)).toBeGreaterThan(0);
    expect(lost(fast)).toBeLessThan(lost(slow));
  });

  it('without a load balancer, failed servers keep receiving traffic', () => {
    const b = new GraphBuilder();
    const vpc = b.add('network.vpc');
    const pub = b.add('network.subnet', { tier: 'public', az: 'az-a', cidr: '10.0.0.0/24' });
    b.link(pub, vpc, 'placed_in');
    const sg = b.add('network.security_group', {
      inboundRules: [{ port: 80, source: { kind: 'anywhere' } }],
    });
    b.link(sg, vpc, 'placed_in');
    const web = b.add('compute.ec2', { instanceSize: 'small', instanceCount: 2 });
    b.link(web, pub, 'placed_in');
    b.link(web, sg, 'secured_by');
    b.link('internet-1', web, 'routes_to');
    // A static site (no database queries) isolates the health-check behaviour.
    const s = { ...steady([{ kind: 'instance_failure', atMin: 5, count: 1 }], 30, 40), queriesPerRequest: 0 };
    const direct = run(b.graph, s);
    const viaAlb = run(template(), s);
    // ALB stops routing to the failed instance after its health checks; direct exposure never does.
    expect(failedIn(viaAlb, 20, 29)).toBe(0);
    expect(failedIn(direct, 20, 29)).toBeGreaterThan(0);
    expect(direct.bottlenecks[0]).toMatchObject({ cause: 'unhealthy_target', nodeIds: [web], endMinute: 29 });
  });
});

describe('Auto Scaling dynamics', () => {
  it('scales out with a launch delay and back in after the spike', () => {
    const g = setConfig(replaceWebWithAutoScaling(template(), ASG_SMALL).graph, 'rds-1', {
      instanceClass: 'db.large',
    });
    const r = run(g, SCENARIOS['tv-spike']);
    const desired = r.steps.map((s) => s.nodes['asg-1']?.desiredCapacity ?? 0);
    expect(desired[0]).toBe(2);
    expect(Math.max(...desired)).toBe(14);
    expect(desired.at(-1)).toBe(2);
    const firstOut = r.timeline.find((e) => e.kind === 'scale_out');
    const firstReady = r.timeline.find((e) => e.kind === 'instance_ready');
    expect((firstReady?.minute ?? 0) - (firstOut?.minute ?? 0)).toBe(2); // warmup 120 s
    // Elastic capacity costs less than holding peak capacity all the time.
    const fixedPeak = run(
      setConfig(setConfig(template(), 'ec2-1', { instanceCount: 14 }), 'rds-1', {
        instanceClass: 'db.large',
      }),
      SCENARIOS['tv-spike'],
    );
    expect(r.cost.runCost).toBeLessThan(fixedPeak.cost.runCost);
  });

  it('respects maxCapacity', () => {
    const g = setConfig(
      replaceWebWithAutoScaling(template(), { ...ASG_SMALL, maxCapacity: 4 }).graph,
      'rds-1',
      {
        instanceClass: 'db.large',
      },
    );
    const r = run(g, SCENARIOS['tv-spike']);
    expect(Math.max(...r.steps.map((s) => s.nodes['asg-1']?.instances ?? 0))).toBe(4);
    expect(r.bottlenecks[0]?.cause).toBe('compute_saturated');
  });
});

describe('determinism with events', () => {
  it('seeded failures are reproducible and do not shift workload noise', () => {
    const a = run(template(), SCENARIOS['tv-spike-incident'], 7);
    const b = run(template(), SCENARIOS['tv-spike-incident'], 7);
    expect(stableStringify(a)).toBe(stableStringify(b));
    const noEvents = run(template(), { ...SCENARIOS['tv-spike-incident'], events: [] }, 7);
    expect(noEvents.steps.map((s) => s.offeredRps)).toEqual(a.steps.map((s) => s.offeredRps));
  });
});

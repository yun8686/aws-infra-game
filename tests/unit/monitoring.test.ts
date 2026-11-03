import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../src/data/scenarios';
import { TEMPLATES } from '../../src/data/templates';
import { simulate, type Scenario } from '../../src/domain/simulation';
import {
  badgesAt,
  computeNodeIds,
  databaseNodeIds,
  ec2NodeIds,
  ec2Running,
  ec2Utilization,
} from '../../src/features/monitoring/series';
import { setWebServers } from '../fixtures/solutions';

const run = (
  graph = TEMPLATES['ecommerce-starter'](),
  scenario: Scenario = SCENARIOS['tv-spike-incident'],
) => {
  const r = simulate({ graph, scenario, seed: 7 });
  if (!r.ok) throw new Error('refused');
  return { sim: r.value, graph };
};

describe('monitoring badges', () => {
  it('labels load levels with text, not color alone', () => {
    const { sim, graph } = run();
    expect(badgesAt(sim, graph, 0)['ec2-1']).toMatchObject({
      level: 'ok',
      text: expect.stringMatching(/^CPU (4\d|5\d)%$/),
    });
    // At minute 60 one of the two instances has failed (minute 55) and the other is overloaded.
    const peak = ['ec2-1', 'ec2-2'].map((id) => badgesAt(sim, graph, 60)[id]?.text).sort();
    expect(peak).toEqual(['CPU 過負荷', '停止（故障）']);
    expect(badgesAt(sim, graph, 0)['alb-1']?.text).toMatch(/rps$/);
  });

  it('summarises all EC2 instances for the charts', () => {
    const { sim, graph } = run();
    const ids = ec2NodeIds(graph);
    expect(ids).toEqual(['ec2-1', 'ec2-2']);
    const step = sim.steps[0];
    if (!step) throw new Error('no step');
    expect(ec2Running(step, ids)).toBe(2);
    expect(ec2Utilization(step, ids)).toBeGreaterThan(0.4);
    expect(ec2Running(sim.steps[60] as typeof step, ids)).toBe(1);
  });

  it('shows connection overload and outages on databases', () => {
    const over = run(setWebServers(TEMPLATES['ecommerce-starter'](), 8), SCENARIOS.steady);
    expect(badgesAt(over.sim, over.graph, 0)['rds-1']).toEqual({ text: '接続 133%', level: 'bad' });
    const down = run(TEMPLATES['ecommerce-starter'](), {
      ...SCENARIOS.steady,
      events: [{ kind: 'db_failure', atMin: 5 }],
    });
    expect(badgesAt(down.sim, down.graph, 6)['rds-1']).toEqual({ text: '停止中', level: 'bad' });
  });

  it('lists compute and database nodes', () => {
    const g = TEMPLATES['ecommerce-starter']();
    expect(computeNodeIds(g)).toEqual(['ec2-1', 'ec2-2']);
    expect(databaseNodeIds(g)).toEqual(['rds-1']);
  });
});

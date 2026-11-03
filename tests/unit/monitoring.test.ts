import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../src/data/scenarios';
import { TEMPLATES } from '../../src/data/templates';
import { simulate, type Scenario } from '../../src/domain/simulation';
import { badgesAt, computeNodeIds, databaseNodeIds } from '../../src/features/monitoring/series';
import { setConfig } from '../fixtures/solutions';

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
      text: expect.stringMatching(/^(4\d|5\d)%・2台$/),
    });
    const peak = badgesAt(sim, graph, 60)['ec2-1'];
    expect(peak?.level).toBe('bad');
    expect(peak?.text).toBe('過負荷・1台'); // one instance failed at minute 55
    expect(badgesAt(sim, graph, 0)['alb-1']?.text).toMatch(/rps$/);
  });

  it('shows connection overload and outages on databases', () => {
    const over = run(
      setConfig(TEMPLATES['ecommerce-starter'](), 'ec2-1', { instanceCount: 8 }),
      SCENARIOS.steady,
    );
    expect(badgesAt(over.sim, over.graph, 0)['rds-1']).toEqual({ text: '接続 133%', level: 'bad' });
    const down = run(TEMPLATES['ecommerce-starter'](), {
      ...SCENARIOS.steady,
      events: [{ kind: 'db_failure', atMin: 5 }],
    });
    expect(badgesAt(down.sim, down.graph, 6)['rds-1']).toEqual({ text: '停止中', level: 'bad' });
  });

  it('lists compute and database nodes', () => {
    const g = TEMPLATES['ecommerce-starter']();
    expect(computeNodeIds(g)).toEqual(['ec2-1']);
    expect(databaseNodeIds(g)).toEqual(['rds-1']);
  });
});

import { describe, expect, it } from 'vitest';
import { SCENARIOS, TEMPLATES } from '../../src/content';
import type { Diagram } from '../../src/model';
import { scenarioApps, simulate, type Scenario, type SimulationResult } from '../../src/sim';
import { setConfig, setWebServers } from '../game/solutions';

const twoApps = () => TEMPLATES['ecommerce-two-apps']();
const run = (
  graph: Diagram,
  scenario: Scenario = SCENARIOS['tv-spike-two-apps'],
  seed = 11,
): SimulationResult => {
  const r = simulate({ diagram: graph, scenario, seed });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
/** Steady two-app load with no events: shop 40 rps, orders 10 rps (×3 CPU). */
const steady: Scenario = {
  ...SCENARIOS['tv-spike-two-apps'],
  id: 'steady-two-apps',
  durationMin: 30,
  events: [],
  apps: (SCENARIOS['tv-spike-two-apps'].apps ?? []).map((a) => ({
    ...a,
    workload: { points: [{ atMin: 0, rps: a.appId === 'shop' ? 40 : 10 }], noisePct: 0 },
  })),
};

describe('multiple applications (ADR 0016)', () => {
  it('a single-app scenario is the shop with the top-level workload', () => {
    expect(scenarioApps(SCENARIOS['tv-spike']).map((a) => [a.appId, a.cpuPerRequest])).toEqual([['shop', 1]]);
  });

  it('routes each app only to servers that run it', () => {
    const g = setConfig(setConfig(twoApps(), 'web-1', { apps: ['shop'] }), 'web-2', { apps: ['orders'] });
    const step = run(g, steady).steps[5];
    expect(step?.nodes['web-1']?.loadByApp).toEqual({ shop: 40 });
    expect(step?.nodes['web-2']?.loadByApp).toEqual({ orders: 10 });
    // Capacity is in CPU units: an orders request costs 3.
    expect(step?.nodes['web-2']?.loadPerSec).toBe(30);
  });

  it('an app that no server runs fails with a clear cause', () => {
    const g = setConfig(setConfig(twoApps(), 'web-1', { apps: ['shop'] }), 'web-2', { apps: ['shop'] });
    const r = run(g, steady);
    expect(r.summary.apps.orders?.errorRate).toBe(1);
    expect(r.summary.apps.shop?.errorRate).toBe(0);
    expect(r.bottlenecks[0]).toMatchObject({ cause: 'no_app_target', appIds: ['orders'] });
  });

  it('co-located apps share capacity: a shop surge slows order management', () => {
    const shared = run(setConfig(twoApps(), 'db-1', { instanceClass: 'db.large' }));
    const separated = run(
      setConfig(
        setConfig(setConfig(setWebServers(twoApps(), 2), 'web-1', { apps: ['shop'] }), 'web-2', {
          apps: ['orders'],
        }),
        'db-1',
        { instanceClass: 'db.large' },
      ),
    );
    // Both are under-provisioned for the shop spike, but only the co-located orders app suffers from it.
    expect(shared.summary.apps.orders?.errorRate).toBeGreaterThan(0.2);
    expect(separated.summary.apps.orders?.errorRate).toBeLessThan(0.05);
    expect(separated.summary.apps.shop?.errorRate).toBeGreaterThan(0.2);
  });

  it('totals equal the sum of the apps', () => {
    const r = run(twoApps());
    for (const s of r.steps) {
      const apps = Object.values(s.apps);
      expect(apps.reduce((a, x) => a + (x?.offeredRps ?? 0), 0)).toBeCloseTo(s.offeredRps, 6);
      expect(apps.reduce((a, x) => a + (x?.errorRps ?? 0), 0)).toBeCloseTo(s.errorRps, 6);
    }
    expect(Object.keys(r.summary.apps)).toEqual(['shop', 'orders']);
  });
});

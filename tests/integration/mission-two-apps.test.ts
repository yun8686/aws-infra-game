import { describe, expect, it } from 'vitest';
import { MISSIONS, missionAppIds, startMissionById } from '../../src/data/missions';
import { SCENARIOS } from '../../src/data/scenarios';
import type { InfrastructureGraph } from '../../src/domain/graph/types';
import { runMission, type MissionRun } from '../../src/domain/missions';
import { validateGraph } from '../../src/domain/validation';
import {
  setConfig,
  setWebServers,
  twoAppsColocated,
  twoAppsColocatedWithHeadroom,
  twoAppsSeparated,
} from '../fixtures/solutions';

const mission = MISSIONS['two-apps'];
const play = (graph: InfrastructureGraph): MissionRun => {
  const r = runMission(mission, SCENARIOS['tv-spike-two-apps'], graph);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
const failedChecks = (r: MissionRun) =>
  r.evaluation.dimensions.flatMap((d) =>
    d.checks.filter((c) => !c.passed).map((c) => `${c.appId ?? 'all'}:${c.metric}`),
  );

describe('mission 2: shop and order management (ADR 0016)', () => {
  const { graph: start, policy } = startMissionById('two-apps');

  it('needs both apps served', () => {
    expect(missionAppIds('two-apps')).toEqual(['shop', 'orders']);
    expect(missionAppIds('tv-spike')).toEqual(['shop']);
    const onlyShop = setConfig(setConfig(start, 'ec2-1', { apps: ['shop'] }), 'ec2-2', { apps: ['shop'] });
    const codes = validateGraph(onlyShop, { requiredApps: ['shop', 'orders'] }).findings.map((f) => f.code);
    expect(codes).toContain('dependency.app_not_served');
  });

  it('the template (both apps on two small servers) fails both apps', () => {
    const r = play(start);
    expect(r.evaluation.passed).toBe(false);
    expect(failedChecks(r)).toEqual(expect.arrayContaining(['shop:availability', 'orders:availability']));
  });

  it('separating order management from the elastic shop passes', () => {
    const r = play(twoAppsSeparated(start, policy));
    expect(r.evaluation.passed).toBe(true);
  });

  it('co-locating both apps on a normally tuned group fails order management latency (noisy neighbour)', () => {
    const r = play(twoAppsColocated(start, policy));
    expect(failedChecks(r)).toEqual(['orders:p95LatencyMs']);
    expect(r.evaluation.learningTopics).toContain('workload_isolation');
  });

  it('co-locating with generous headroom is a valid, tuned alternative', () => {
    const r = play(twoAppsColocatedWithHeadroom(start, policy));
    expect(r.evaluation.passed).toBe(true);
  });

  it('static over-provisioning of shared servers fails the budget', () => {
    const r = play(setConfig(setWebServers(start, 14), 'rds-1', { instanceClass: 'db.large' }));
    expect(failedChecks(r)).toContain('all:projectedMonthly');
  });
});

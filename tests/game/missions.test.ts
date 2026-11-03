import { describe, expect, it } from 'vitest';
import { MISSIONS, SCENARIOS, TEMPLATES, missionAppIds, startMissionById } from '../../src/content';
import { runMission, type MissionRun } from '../../src/game';
import { REGION_ID, USERS_ID, remove, validateDiagram, type Diagram } from '../../src/model';
import { DiagramBuilder } from '../model/builders';
import {
  ASG_SMALL,
  overProvisioned,
  replaceWebWithAutoScaling,
  setConfig,
  setWebServers,
  solutionA,
  solutionB,
  twoAppsColocated,
  twoAppsColocatedWithHeadroom,
  twoAppsSeparated,
  withoutDatabaseLinks,
} from './solutions';

const playWith =
  (id: 'tv-spike' | 'two-apps') =>
  (d: Diagram): MissionRun => {
    const m = MISSIONS[id];
    const r = runMission(m, SCENARIOS[m.scenarioId as keyof typeof SCENARIOS], d);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  };
const failed = (r: MissionRun) => r.evaluation.dimensions.filter((d) => !d.passed).map((d) => d.dimension);
const failedChecks = (r: MissionRun) =>
  r.evaluation.dimensions.flatMap((d) =>
    d.checks.filter((c) => !c.passed).map((c) => `${c.appId ?? 'all'}:${c.metric}`),
  );

describe('mission 1: TV traffic spike — reference solutions', () => {
  const play = playWith('tv-spike');
  const { diagram: start, policy } = startMissionById('tv-spike');

  it('starts from a valid two-AZ diagram with the database locked against removal', () => {
    expect(start).toEqual(TEMPLATES['ecommerce-starter']());
    expect(
      validateDiagram(start)
        .filter((f) => f.severity !== 'info')
        .map((f) => f.code),
    ).toEqual([]);
    expect(remove(start, 'db-1', policy)).toMatchObject({ ok: false, finding: { code: 'edit.locked' } });
  });

  it('the untouched template fails availability and performance', () => {
    const r = play(start);
    expect(failed(r)).toEqual(['availability', 'performance']);
    expect(r.evaluation.keyBottlenecks[0]?.cause).toBe('compute_saturated');
    expect(r.evaluation.learningTopics).toContain('horizontal_scaling');
  });

  it('reference solution A (Auto Scaling small + db.large) passes', () => {
    expect(play(solutionA(start, policy)).evaluation.passed).toBe(true);
  });

  it('reference solution B (Auto Scaling medium + db.large) passes with a different architecture', () => {
    expect(play(solutionB(start, policy)).evaluation.passed).toBe(true);
  });

  it('Auto Scaling with the default 180 s warm-up narrowly misses availability', () => {
    const g = setConfig(replaceWebWithAutoScaling(start, { ...ASG_SMALL, warmupSec: 180 }, policy), 'db-1', {
      instanceClass: 'db.large',
    });
    const r = play(g);
    expect(failed(r)).toEqual(['availability']);
    expect(r.evaluation.keyBottlenecks[0]?.cause).toBe('compute_saturated');
  });

  it('disconnecting the web tier from its database is not a shortcut', () => {
    const g = withoutDatabaseLinks(setWebServers(start, 12, { policy }));
    expect(validateDiagram(g).map((f) => f.code)).toContain('dependency.compute_without_database');
    const r = play(g);
    expect(r.evaluation.passed).toBe(false);
    expect(r.evaluation.keyBottlenecks[0]?.cause).toBe('no_database');
  });

  it('static over-provisioning meets the SLOs but fails the budget', () => {
    const r = play(overProvisioned(start));
    expect(failed(r)).toEqual(['cost']);
    expect(r.evaluation.learningTopics).toContain('cost_optimization');
  });

  it('scaling compute without the database is not enough', () => {
    const r = play(setWebServers(start, 12, { policy }));
    expect(r.evaluation.passed).toBe(false);
    expect(r.evaluation.keyBottlenecks.map((b) => b.cause)).toContain('db_connections');
  });

  it('opening the database to the Internet fails security even if everything else passes', () => {
    const g = setConfig(solutionA(start, policy), 'sg-3', {
      inbound: [{ port: 5432, source: { kind: 'anywhere' } }],
    });
    expect(failed(play(g))).toEqual(['security']);
  });

  it('is reproducible', () => {
    expect(play(solutionA(start, policy)).evaluation).toEqual(play(solutionA(start, policy)).evaluation);
  });
});

describe('free construction uses the same pipeline', () => {
  it('a sandbox starts empty and cannot run until a request path exists', () => {
    const { diagram } = startMissionById('sandbox');
    const r = runMission(MISSIONS.sandbox, SCENARIOS['tv-spike-incident'], diagram);
    expect(!r.ok && r.error.kind).toBe('invalid_diagram');
  });

  it('a diagram drawn from scratch evaluates like the same template', () => {
    const b = new DiagramBuilder();
    const vpc = b.frame('vpc', REGION_ID);
    const azA = b.frame('az', vpc);
    const azB = b.frame('az', vpc);
    b.frame('subnet', azA, { tier: 'public' });
    const privA = b.frame('subnet', azA, { tier: 'private' });
    b.frame('subnet', azB, { tier: 'public' });
    b.frame('subnet', azB, { tier: 'private' });
    const sgAlb = b.resource('sg', vpc, { inbound: [{ port: 80, source: { kind: 'anywhere' } }] });
    const sgWeb = b.resource('sg', vpc, { inbound: [{ port: 80, source: { kind: 'sg', sgId: sgAlb } }] });
    const sgDb = b.resource('sg', vpc, { inbound: [{ port: 5432, source: { kind: 'sg', sgId: sgWeb } }] });
    const alb = b.resource('alb', vpc, { securityGroupIds: [sgAlb] });
    const web1 = b.resource('ec2', privA, { securityGroupIds: [sgWeb] });
    const web2 = b.resource('ec2', privA, { securityGroupIds: [sgWeb] });
    const db = b.resource('rds', vpc, { securityGroupIds: [sgDb] });
    b.link('traffic', USERS_ID, alb);
    b.link('traffic', alb, web1);
    b.link('traffic', alb, web2);
    b.link('data', web1, db);
    b.link('data', web2, db);
    const play = playWith('tv-spike');
    expect(play(b.d).evaluation.dimensions).toEqual(
      play(TEMPLATES['ecommerce-starter']()).evaluation.dimensions,
    );
  });
});

describe('mission 2: shop and order management', () => {
  const play = playWith('two-apps');
  const { diagram: start, policy } = startMissionById('two-apps');

  it('needs both apps served', () => {
    expect(missionAppIds('two-apps')).toEqual(['shop', 'orders']);
    expect(missionAppIds('tv-spike')).toEqual(['shop']);
    const onlyShop = setConfig(setConfig(start, 'web-1', { apps: ['shop'] }), 'web-2', { apps: ['shop'] });
    expect(validateDiagram(onlyShop, { requiredApps: ['shop', 'orders'] }).map((f) => f.code)).toContain(
      'dependency.app_not_served',
    );
  });

  it('the template (both apps on two small servers) fails both apps', () => {
    expect(failedChecks(play(start))).toEqual(
      expect.arrayContaining(['shop:availability', 'orders:availability']),
    );
  });

  it('separating order management from the elastic shop passes', () => {
    expect(play(twoAppsSeparated(start, policy)).evaluation.passed).toBe(true);
  });

  it('co-locating both apps on a normally tuned group fails order latency (noisy neighbour)', () => {
    const r = play(twoAppsColocated(start, policy));
    expect(failedChecks(r)).toEqual(['orders:p95LatencyMs']);
    expect(r.evaluation.learningTopics).toContain('workload_isolation');
  });

  it('co-locating with generous headroom is a valid alternative', () => {
    expect(play(twoAppsColocatedWithHeadroom(start, policy)).evaluation.passed).toBe(true);
  });

  it('static over-provisioning of shared servers fails the budget', () => {
    const r = play(setConfig(setWebServers(start, 14), 'db-1', { instanceClass: 'db.large' }));
    expect(failedChecks(r)).toContain('all:projectedMonthly');
  });
});

import { describe, expect, it } from 'vitest';
import { MISSIONS, startMissionById } from '../../src/data/missions';
import { SCENARIOS } from '../../src/data/scenarios';
import { TEMPLATES } from '../../src/data/templates';
import { disconnect, removeNode } from '../../src/domain/graph/commands';
import type { InfrastructureGraph } from '../../src/domain/graph/types';
import { runMission, type MissionRun } from '../../src/domain/missions';
import { validateGraph } from '../../src/domain/validation';
import { buildWebStackFromBaseline, unwrap } from '../fixtures/builders';
import {
  ASG_SMALL,
  overProvisioned,
  replaceWebWithAutoScaling,
  setConfig,
  setWebServers,
  solutionA,
  solutionB,
} from '../fixtures/solutions';

const mission = MISSIONS['tv-spike'];
const play = (graph: InfrastructureGraph): MissionRun => {
  const r = runMission(mission, SCENARIOS['tv-spike-incident'], graph);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
const failed = (r: MissionRun) => r.evaluation.dimensions.filter((d) => !d.passed).map((d) => d.dimension);

describe('mission: TV traffic spike — reference solutions', () => {
  const { graph: start, policy } = startMissionById('tv-spike');

  it('starts from the e-commerce template with the database locked against deletion', () => {
    expect(start).toEqual(TEMPLATES['ecommerce-starter']());
    const del = removeNode(start, 'rds-1', policy);
    expect(!del.ok && del.error[0]?.code).toBe('edit.node_locked');
  });

  it('the untouched template fails availability and performance', () => {
    const r = play(start);
    expect(r.evaluation.passed).toBe(false);
    expect(failed(r)).toEqual(['availability', 'performance']);
    expect(r.evaluation.keyBottlenecks[0]?.cause).toBe('compute_saturated');
    expect(r.evaluation.learningTopics).toContain('horizontal_scaling');
  });

  it('reference solution A (Auto Scaling small + db.large) passes', () => {
    const r = play(solutionA(start, policy));
    expect(r.evaluation.passed).toBe(true);
  });

  it('reference solution B (Auto Scaling medium + db.large) passes with a different architecture', () => {
    const r = play(solutionB(start, policy));
    expect(r.evaluation.passed).toBe(true);
  });

  it('Auto Scaling with the default 180 s warm-up narrowly misses availability (iteration lesson)', () => {
    const g = setConfig(
      replaceWebWithAutoScaling(start, { ...ASG_SMALL, warmupSec: 180 }, policy).graph,
      'rds-1',
      { instanceClass: 'db.large' },
      policy,
    );
    const r = play(g);
    expect(failed(r)).toEqual(['availability']);
    expect(r.evaluation.keyBottlenecks[0]?.cause).toBe('compute_saturated');
  });

  it('regression (playtest): disconnecting the web tier from its database is not a shortcut', () => {
    // Twelve web servers, none of them connected to the database.
    let g = setWebServers(start, 12, { policy });
    for (const c of Object.values(g.connections).filter((x) => x.connectionType === 'data_access')) {
      g = unwrap(disconnect(g, c.id, policy)).graph;
    }
    expect(validateGraph(g).findings.map((f) => f.code)).toContain('dependency.compute_without_database');
    const r = play(g);
    expect(r.evaluation.passed).toBe(false);
    expect(r.evaluation.keyBottlenecks[0]?.cause).toBe('no_database');
    expect(r.evaluation.learningTopics).toContain('dependencies');
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
      inboundRules: [{ port: 5432, source: { kind: 'anywhere' } }],
    });
    const r = play(g);
    expect(failed(r)).toEqual(['security']);
  });

  it('is reproducible', () => {
    expect(play(solutionA(start, policy)).evaluation).toEqual(play(solutionA(start, policy)).evaluation);
  });
});

describe('free construction uses the same mission pipeline', () => {
  it('a sandbox starts from the baseline and cannot run until a request path exists', () => {
    const { graph } = startMissionById('sandbox');
    expect(validateGraph(graph).canSimulate).toBe(false);
    const r = runMission(MISSIONS.sandbox, SCENARIOS['tv-spike-incident'], graph);
    expect(!r.ok && r.error.kind).toBe('invalid_graph');
  });

  it('a graph built from scratch can be evaluated against the TV spike mission', () => {
    const built = buildWebStackFromBaseline().b.graph;
    const fromTemplate = play(TEMPLATES['ecommerce-starter']());
    expect(play(built).evaluation.dimensions).toEqual(fromTemplate.evaluation.dimensions);
  });

  it('rejects a scenario that does not belong to the mission', () => {
    const r = runMission(mission, SCENARIOS.steady, TEMPLATES['ecommerce-starter']());
    expect(!r.ok && r.error.kind).toBe('invalid_scenario');
  });
});

import type { InfrastructureGraph } from '../graph/types';
import { err, ok, type Result } from '../shared/result';
import { evaluateMission, type EvaluationResult } from '../scoring/evaluate';
import { simulate, type SimulationError } from '../simulation/engine';
import type { Scenario } from '../simulation/scenario';
import type { SimulationResult } from '../simulation/types';
import type { Mission } from './mission';

export interface MissionRun {
  readonly simulation: SimulationResult;
  readonly evaluation: EvaluationResult;
}

/** Validate → simulate → evaluate, with the mission's disclosed scenario and seed. */
export const runMission = (
  mission: Mission,
  scenario: Scenario,
  graph: InfrastructureGraph,
): Result<MissionRun, SimulationError> => {
  if (scenario.id !== mission.scenarioId) {
    return err({ kind: 'invalid_scenario', message: `mission expects scenario ${mission.scenarioId}` });
  }
  const sim = simulate({ graph, scenario, seed: mission.seed });
  if (!sim.ok) return sim;
  return ok({ simulation: sim.value, evaluation: evaluateMission(mission, sim.value) });
};

import type { Diagram } from '../model';
import {
  err,
  ok,
  simulate,
  type Result,
  type Scenario,
  type SimulationError,
  type SimulationResult,
} from '../sim';
import { evaluateMission, type EvaluationResult } from './evaluate';
import type { Mission } from './mission';

export interface MissionRun {
  readonly simulation: SimulationResult;
  readonly evaluation: EvaluationResult;
}

/** Validate → simulate → evaluate, with the mission's disclosed scenario and seed. */
export const runMission = (
  mission: Mission,
  scenario: Scenario,
  diagram: Diagram,
): Result<MissionRun, SimulationError> => {
  if (scenario.id !== mission.scenarioId) {
    return err({ kind: 'invalid_scenario', message: `mission expects scenario ${mission.scenarioId}` });
  }
  const sim = simulate({ diagram, scenario, seed: mission.seed });
  if (!sim.ok) return sim;
  return ok({ simulation: sim.value, evaluation: evaluateMission(mission, sim.value) });
};

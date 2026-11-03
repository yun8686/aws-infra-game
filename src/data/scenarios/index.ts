import type { Scenario } from '../../domain/simulation/scenario';

export const SCENARIOS = {
  steady: {
    id: 'steady',
    version: 1,
    durationMin: 60,
    stepSec: 60,
    queriesPerRequest: 2,
    workload: { points: [{ atMin: 0, rps: 50 }], noisePct: 3 },
  },
  'tv-spike': {
    id: 'tv-spike',
    version: 1,
    durationMin: 120,
    stepSec: 60,
    queriesPerRequest: 2,
    workload: {
      points: [
        { atMin: 0, rps: 50 },
        { atMin: 30, rps: 50 },
        { atMin: 40, rps: 500 },
        { atMin: 70, rps: 500 },
        { atMin: 90, rps: 50 },
      ],
      noisePct: 3,
    },
  },
} satisfies Record<string, Scenario>;
export type ScenarioId = keyof typeof SCENARIOS;

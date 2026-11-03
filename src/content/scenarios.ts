import type { Scenario } from '../sim';

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
  /** Mission 1: the TV spike, plus one server failing at the peak. */
  'tv-spike-incident': {
    id: 'tv-spike-incident',
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
    events: [{ kind: 'instance_failure', atMin: 55, count: 1 }],
  },
  /** Redundancy drill: AZ a goes down for 20 minutes under moderate load. */
  'az-a-outage': {
    id: 'az-a-outage',
    version: 1,
    durationMin: 60,
    stepSec: 60,
    queriesPerRequest: 2,
    workload: { points: [{ atMin: 0, rps: 80 }], noisePct: 3 },
    events: [{ kind: 'az_outage', atMin: 15, az: 'az-a', durationMin: 20 }],
  },
  /** Mission 2: the TV spike hits the shop; order management must keep working. */
  'tv-spike-two-apps': {
    id: 'tv-spike-two-apps',
    version: 1,
    durationMin: 120,
    stepSec: 60,
    // Top-level workload is unused when `apps` is present; kept for the schema.
    queriesPerRequest: 2,
    workload: { points: [{ atMin: 0, rps: 50 }], noisePct: 3 },
    apps: [
      {
        appId: 'shop',
        queriesPerRequest: 2,
        cpuPerRequest: 1,
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
      {
        appId: 'orders',
        queriesPerRequest: 3,
        cpuPerRequest: 3,
        workload: { points: [{ atMin: 0, rps: 10 }], noisePct: 3 },
      },
    ],
    events: [{ kind: 'instance_failure', atMin: 55, count: 1 }],
  },
} satisfies Record<string, Scenario>;
export type ScenarioId = keyof typeof SCENARIOS;

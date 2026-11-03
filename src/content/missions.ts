import { DEFAULT_APP, type AppId } from '../model';
import { missionSchema, startMission, type Mission, type MissionStart } from '../game';
import { scenarioApps } from '../sim';
import { SCENARIOS, type ScenarioId } from './scenarios';
import { TEMPLATES, baseline } from './templates';

// Thresholds are game-balance values (docs/SCORING.md), not AWS facts.
const tvSpike: Mission = {
  id: 'tv-spike',
  version: 2,
  initialDiagram: { kind: 'template', templateId: 'ecommerce-starter' },
  scenarioId: 'tv-spike-incident',
  seed: 7,
  // Customer data must be kept: the database can be resized but not removed.
  constraints: { lockedIds: ['db-1'] },
  objectives: { maxErrorRate: 0.01, maxP95LatencyMs: 400, minAvailability: 0.97, monthlyBudget: 16000 },
  scoringWeights: { availability: 3, performance: 3, cost: 2, security: 2 },
};

const twoApps: Mission = {
  id: 'two-apps',
  version: 2,
  initialDiagram: { kind: 'template', templateId: 'ecommerce-two-apps' },
  scenarioId: 'tv-spike-two-apps',
  seed: 11,
  constraints: { lockedIds: ['db-1'] },
  // Budget applies to the whole project; availability and performance are judged per app.
  objectives: { maxErrorRate: 0.01, maxP95LatencyMs: 400, minAvailability: 0.97, monthlyBudget: 16000 },
  appObjectives: {
    shop: { maxErrorRate: 0.01, maxP95LatencyMs: 400, minAvailability: 0.97 },
    orders: { maxErrorRate: 0.01, maxP95LatencyMs: 300, minAvailability: 0.98 },
  },
  scoringWeights: { availability: 3, performance: 3, cost: 2, security: 2 },
};

const sandbox: Mission = {
  id: 'sandbox',
  version: 2,
  initialDiagram: { kind: 'baseline' },
  scenarioId: 'tv-spike-incident',
  seed: 1,
  constraints: {},
  objectives: { maxErrorRate: 1, maxP95LatencyMs: 5000, minAvailability: 0, monthlyBudget: 1_000_000 },
  scoringWeights: { availability: 1, performance: 1, cost: 1, security: 1 },
};

export const MISSIONS = {
  'tv-spike': missionSchema.parse(tvSpike),
  'two-apps': missionSchema.parse(twoApps),
  sandbox: missionSchema.parse(sandbox),
} as const;
export type MissionId = keyof typeof MISSIONS;

export const startMissionById = (id: MissionId): MissionStart =>
  startMission(MISSIONS[id], {
    template: (t) => (t in TEMPLATES ? TEMPLATES[t as keyof typeof TEMPLATES]() : undefined),
    baseline,
  });

export const scenarioOf = (id: MissionId) => SCENARIOS[MISSIONS[id].scenarioId as ScenarioId];

/** Applications a mission's scenario needs served, in scenario order. */
export const missionAppIds = (id: string): AppId[] => {
  const mission = MISSIONS[id as MissionId];
  const scenario = mission ? SCENARIOS[mission.scenarioId as ScenarioId] : undefined;
  return scenario ? scenarioApps(scenario).map((a) => a.appId) : [DEFAULT_APP];
};

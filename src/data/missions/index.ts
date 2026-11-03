import { missionSchema, startMission, type Mission, type MissionStart } from '../../domain/missions/mission';
import { createBaselineGraph, TEMPLATES } from '../templates';

const tvSpike: Mission = {
  id: 'tv-spike',
  version: 1,
  initialGraph: { kind: 'template', templateId: 'ecommerce-starter' },
  scenarioId: 'tv-spike-incident',
  seed: 7,
  constraints: {
    // Customer data must be kept: the database can be resized but not replaced.
    lockedNodes: { 'rds-1': 'no-delete' },
  },
  // Game-balance thresholds (docs/SCORING.md), not AWS facts.
  objectives: { maxErrorRate: 0.01, maxP95LatencyMs: 400, minAvailability: 0.97, monthlyBudget: 16000 },
  scoringWeights: { availability: 3, performance: 3, cost: 2, security: 2 },
};

const sandbox: Mission = {
  id: 'sandbox',
  version: 1,
  initialGraph: { kind: 'baseline' },
  scenarioId: 'tv-spike-incident',
  seed: 1,
  constraints: {},
  objectives: { maxErrorRate: 1, maxP95LatencyMs: 5000, minAvailability: 0, monthlyBudget: 1_000_000 },
  scoringWeights: { availability: 1, performance: 1, cost: 1, security: 1 },
};

export const MISSIONS = {
  'tv-spike': missionSchema.parse(tvSpike),
  sandbox: missionSchema.parse(sandbox),
} as const;
export type MissionId = keyof typeof MISSIONS;

export const startMissionById = (id: MissionId): MissionStart =>
  startMission(MISSIONS[id], {
    template: (t) => (t in TEMPLATES ? TEMPLATES[t as keyof typeof TEMPLATES]() : undefined),
    baseline: createBaselineGraph,
  });

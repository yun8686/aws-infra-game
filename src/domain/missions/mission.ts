import { z } from 'zod';
import { SERVICE_TYPES } from '../catalog/ids';
import type { EditPolicy } from '../graph/commands';
import type { InfrastructureGraph } from '../graph/types';

export const DIMENSIONS = ['availability', 'performance', 'cost', 'security'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const missionSchema = z.object({
  id: z.string().min(1),
  version: z.int().min(1),
  /** Template expansion and free construction differ only here (ADR 0001). */
  initialGraph: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('template'), templateId: z.string().min(1) }),
    z.object({ kind: z.literal('baseline') }),
  ]),
  scenarioId: z.string().min(1),
  seed: z.int().min(0),
  constraints: z.object({
    allowedServiceTypes: z.array(z.enum(SERVICE_TYPES)).optional(),
    lockedNodes: z.record(z.string(), z.enum(['no-delete', 'read-only'])).optional(),
  }),
  objectives: z.object({
    maxErrorRate: z.number().min(0).max(1),
    maxP95LatencyMs: z.number().positive(),
    minAvailability: z.number().min(0).max(1),
    monthlyBudget: z.number().positive(),
  }),
  scoringWeights: z.object({
    availability: z.number().min(0),
    performance: z.number().min(0),
    cost: z.number().min(0),
    security: z.number().min(0),
  }),
});
export type Mission = z.infer<typeof missionSchema>;

export const missionEditPolicy = (mission: Mission): EditPolicy => ({
  ...(mission.constraints.allowedServiceTypes
    ? { allowedServiceTypes: mission.constraints.allowedServiceTypes }
    : {}),
  ...(mission.constraints.lockedNodes ? { lockedNodes: mission.constraints.lockedNodes } : {}),
});

export interface MissionStart {
  readonly graph: InfrastructureGraph;
  readonly policy: EditPolicy;
}

/** Initial state for a project. Content (templates, baseline) is injected to keep the domain data-free. */
export const startMission = (
  mission: Mission,
  content: {
    readonly template: (id: string) => InfrastructureGraph | undefined;
    readonly baseline: () => InfrastructureGraph;
  },
): MissionStart => {
  const graph =
    mission.initialGraph.kind === 'baseline'
      ? content.baseline()
      : content.template(mission.initialGraph.templateId);
  if (!graph) throw new Error(`Mission ${mission.id} references unknown template`);
  return { graph, policy: missionEditPolicy(mission) };
};

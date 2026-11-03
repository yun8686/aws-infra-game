import { z } from 'zod';
import { APP_IDS, RESOURCE_TYPES, type Diagram, type EditPolicy } from '../model';

export const DIMENSIONS = ['availability', 'performance', 'cost', 'security'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const missionSchema = z.object({
  id: z.string().min(1),
  version: z.int().min(1),
  /** Template expansion and free construction differ only here (ADR 0001). */
  initialDiagram: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('template'), templateId: z.string().min(1) }),
    z.object({ kind: z.literal('baseline') }),
  ]),
  scenarioId: z.string().min(1),
  seed: z.int().min(0),
  constraints: z.object({
    allowedTypes: z.array(z.enum(RESOURCE_TYPES)).optional(),
    /** Resources the customer requires to stay as they are. */
    lockedIds: z.array(z.string()).optional(),
  }),
  objectives: z.object({
    maxErrorRate: z.number().min(0).max(1),
    maxP95LatencyMs: z.number().positive(),
    minAvailability: z.number().min(0).max(1),
    monthlyBudget: z.number().positive(),
  }),
  /** Multi-app missions: availability and performance are judged per app (ADR 0016). */
  appObjectives: z
    .record(
      z.enum(APP_IDS),
      z.object({
        maxErrorRate: z.number().min(0).max(1),
        maxP95LatencyMs: z.number().positive(),
        minAvailability: z.number().min(0).max(1),
      }),
    )
    .optional(),
  scoringWeights: z.object({
    availability: z.number().min(0),
    performance: z.number().min(0),
    cost: z.number().min(0),
    security: z.number().min(0),
  }),
});
export type Mission = z.infer<typeof missionSchema>;

export const missionEditPolicy = (mission: Mission): EditPolicy => ({
  ...(mission.constraints.allowedTypes ? { allowedTypes: mission.constraints.allowedTypes } : {}),
  ...(mission.constraints.lockedIds ? { lockedIds: mission.constraints.lockedIds } : {}),
});

export interface MissionStart {
  readonly diagram: Diagram;
  readonly policy: EditPolicy;
}

/** Initial state for a project. Content (templates, baseline) is injected to keep this module data-free. */
export const startMission = (
  mission: Mission,
  content: { readonly template: (id: string) => Diagram | undefined; readonly baseline: () => Diagram },
): MissionStart => {
  const diagram =
    mission.initialDiagram.kind === 'baseline'
      ? content.baseline()
      : content.template(mission.initialDiagram.templateId);
  if (!diagram) throw new Error(`Mission ${mission.id} references unknown template`);
  return { diagram, policy: missionEditPolicy(mission) };
};

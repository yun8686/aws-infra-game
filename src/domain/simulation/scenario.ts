import { z } from 'zod';
import { APP_IDS, DEFAULT_APP } from '../catalog/apps';

const azSchema = z.enum(['az-a', 'az-b', 'az-c']);

export const scenarioEventSchema = z.discriminatedUnion('kind', [
  /** `count` running compute instances fail; chosen by the seeded PRNG unless `nodeId` is given. */
  z.object({
    kind: z.literal('instance_failure'),
    atMin: z.int().min(0),
    count: z.int().min(1).max(50),
    nodeId: z.string().optional(),
  }),
  /** Everything in the AZ is unavailable for the duration. */
  z.object({
    kind: z.literal('az_outage'),
    atMin: z.int().min(0),
    az: azSchema,
    durationMin: z.int().min(1),
  }),
  /** The primary instance of every RDS (or of `nodeId`) fails. */
  z.object({ kind: z.literal('db_failure'), atMin: z.int().min(0), nodeId: z.string().optional() }),
]);
export type ScenarioEvent = z.infer<typeof scenarioEventSchema>;

const workloadSchema = z.object({
  points: z
    .array(z.object({ atMin: z.number().min(0), rps: z.number().min(0) }))
    .min(1)
    .refine(
      (pts) => pts.every((p, i) => i === 0 || p.atMin > (pts[i - 1]?.atMin ?? -1)),
      'points_not_sorted',
    ),
  noisePct: z.number().min(0).max(50),
});
export type Workload = z.infer<typeof workloadSchema>;

/** One application's traffic in a multi-app scenario (ADR 0016). */
export const scenarioAppSchema = z.object({
  appId: z.enum(APP_IDS),
  workload: workloadSchema,
  queriesPerRequest: z.number().min(0).max(20),
  /** CPU per request relative to a shop page view (1). Server capacity is in shop-request units. */
  cpuPerRequest: z.number().positive().max(20),
});
export type ScenarioApp = z.infer<typeof scenarioAppSchema>;

export const scenarioSchema = z.object({
  id: z.string().min(1),
  version: z.int().min(1),
  durationMin: z
    .int()
    .min(1)
    .max(24 * 60),
  stepSec: z.literal(60),
  /** Single-app scenarios: traffic of the shop app. */
  queriesPerRequest: z.number().min(0).max(20),
  workload: workloadSchema,
  /** Multi-app scenarios: when present, replaces `workload`/`queriesPerRequest`. */
  apps: z.array(scenarioAppSchema).min(1).max(APP_IDS.length).optional(),
  /** Disclosed failure events. Omitted means none. */
  events: z.array(scenarioEventSchema).max(50).optional(),
});
export type Scenario = z.infer<typeof scenarioSchema>;

/** The scenario's applications; a single-app scenario is the shop with the top-level workload. */
export const scenarioApps = (scenario: Scenario): ScenarioApp[] =>
  scenario.apps ?? [
    {
      appId: DEFAULT_APP,
      workload: scenario.workload,
      queriesPerRequest: scenario.queriesPerRequest,
      cpuPerRequest: 1,
    },
  ];

/** Total traffic of all apps at a minute, before noise. */
export const baseRpsAt = (scenario: Scenario, minute: number): number =>
  scenarioApps(scenario).reduce((sum, a) => sum + workloadRpsAt(a.workload, minute), 0);

/** Piecewise-linear workload before noise. Clamped at the first/last point. */
export const workloadRpsAt = (workload: Workload, minute: number): number => {
  const pts = workload.points;
  const first = pts[0];
  if (!first || minute <= first.atMin) return first?.rps ?? 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a && b && minute <= b.atMin) {
      return a.rps + ((b.rps - a.rps) * (minute - a.atMin)) / (b.atMin - a.atMin);
    }
  }
  return pts[pts.length - 1]?.rps ?? 0;
};

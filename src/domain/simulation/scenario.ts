import { z } from 'zod';

export const scenarioSchema = z.object({
  id: z.string().min(1),
  version: z.int().min(1),
  durationMin: z
    .int()
    .min(1)
    .max(24 * 60),
  stepSec: z.literal(60),
  queriesPerRequest: z.number().min(0).max(20),
  workload: z.object({
    points: z
      .array(z.object({ atMin: z.number().min(0), rps: z.number().min(0) }))
      .min(1)
      .refine(
        (pts) => pts.every((p, i) => i === 0 || p.atMin > (pts[i - 1]?.atMin ?? -1)),
        'points_not_sorted',
      ),
    noisePct: z.number().min(0).max(50),
  }),
});
export type Scenario = z.infer<typeof scenarioSchema>;

/** Piecewise-linear workload before noise. Clamped at the first/last point. */
export const baseRpsAt = (scenario: Scenario, minute: number): number => {
  const pts = scenario.workload.points;
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

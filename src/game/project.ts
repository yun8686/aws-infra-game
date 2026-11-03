import { z } from 'zod';
import { diagramSchema, type Diagram } from '../model';
import { err, ok, type Result, type SimulationResult } from '../sim';
import type { EvaluationResult } from './evaluate';
import type { Dimension } from './mission';

/** 2: diagram model (ADR 0018). Version 1 saves are not migrated. */
export const PROJECT_SCHEMA_VERSION = 2 as const;

export type ProjectStatus = 'not_run' | 'failed' | 'passed';

/** Compact record of the latest run, enough for the project list and result headline. */
export interface RunSummary {
  readonly inputHash: string;
  readonly passed: boolean;
  readonly overallScore: number;
  readonly dimensions: Readonly<Record<Dimension, { readonly passed: boolean; readonly score: number }>>;
  readonly errorRate: number;
  readonly p95LatencyMs: number;
  readonly availability: number;
  readonly projectedMonthly: number;
}

export interface Project {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly id: string;
  readonly missionId: string;
  readonly missionVersion: number;
  readonly name: string;
  readonly diagram: Diagram;
  readonly lastRun?: RunSummary;
  readonly submitted?: RunSummary;
  /** Number of simulation runs, used to reveal hints progressively. */
  readonly attempts?: number;
  /** Epoch milliseconds supplied by the application layer (domain code never reads the clock). */
  readonly createdAt: number;
  readonly updatedAt: number;
}

const dimensionSummary = z.object({ passed: z.boolean(), score: z.number() });
const runSummarySchema = z.object({
  inputHash: z.string(),
  passed: z.boolean(),
  overallScore: z.number(),
  dimensions: z.object({
    availability: dimensionSummary,
    performance: dimensionSummary,
    cost: dimensionSummary,
    security: dimensionSummary,
  }),
  errorRate: z.number(),
  p95LatencyMs: z.number(),
  availability: z.number(),
  projectedMonthly: z.number(),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1),
  missionId: z.string().min(1),
  missionVersion: z.int().min(1),
  name: z.string(),
  diagram: diagramSchema,
  lastRun: runSummarySchema.optional(),
  submitted: runSummarySchema.optional(),
  attempts: z.int().min(0).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** Parse a stored project. Corrupt or incompatible saves are reported, never thrown. */
export const parseProject = (input: unknown): Result<Project, string> => {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(`${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid project'}`);
  }
  return ok(parsed.data as Project);
};

export const createProject = (input: {
  readonly id: string;
  readonly missionId: string;
  readonly missionVersion: number;
  readonly name: string;
  readonly diagram: Diagram;
  readonly now: number;
}): Project => ({
  schemaVersion: PROJECT_SCHEMA_VERSION,
  id: input.id,
  missionId: input.missionId,
  missionVersion: input.missionVersion,
  name: input.name,
  diagram: input.diagram,
  createdAt: input.now,
  updatedAt: input.now,
});

export const summarizeRun = (sim: SimulationResult, evaluation: EvaluationResult): RunSummary => {
  const dims = Object.fromEntries(
    evaluation.dimensions.map((d) => [d.dimension, { passed: d.passed, score: d.score }]),
  ) as RunSummary['dimensions'];
  return {
    inputHash: sim.inputHash,
    passed: evaluation.passed,
    overallScore: evaluation.overallScore,
    dimensions: dims,
    errorRate: sim.summary.errorRate,
    p95LatencyMs: sim.summary.p95LatencyMs,
    availability: sim.summary.availability,
    projectedMonthly: sim.cost.projectedMonthly,
  };
};

/** Status shown on the project list. A run is stale once the diagram changes after it. */
export const projectStatus = (p: Project): ProjectStatus =>
  p.lastRun ? (p.lastRun.passed ? 'passed' : 'failed') : 'not_run';

/** Hints shown after failed attempts: one more per failed run, never before the first run. */
export const revealedHintCount = (p: Project, totalHints: number): number =>
  p.lastRun && !p.lastRun.passed ? Math.min(totalHints, p.attempts ?? 1) : 0;

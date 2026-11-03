import { z } from 'zod';
import { err, ok, type Result } from '../shared/result';
import { GRAPH_SCHEMA_VERSION, type InfrastructureGraph } from './types';

const nodeSchema = z.object({
  id: z.string().min(1),
  serviceType: z.string().min(1),
  name: z.string(),
  config: z.unknown(),
});

const connectionSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  connectionType: z.string().min(1),
  config: z.unknown().optional(),
});

/** Structural shape only. Semantic checks are done by validateGraph. */
export const graphDocumentSchema = z.object({
  schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
  nodes: z.record(z.string(), nodeSchema),
  connections: z.record(z.string(), connectionSchema),
});

export interface GraphParseError {
  readonly path: string;
  readonly message: string;
}

/** Parse untrusted JSON (content files, saves) into a graph document. */
export const parseGraphDocument = (input: unknown): Result<InfrastructureGraph, GraphParseError[]> => {
  const parsed = graphDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return ok(parsed.data as InfrastructureGraph);
};

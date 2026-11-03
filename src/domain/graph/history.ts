import type { InfrastructureGraph } from './types';

/** Immutable undo/redo history. Graphs are immutable values, so snapshots are cheap. */
export interface GraphHistory {
  readonly past: readonly InfrastructureGraph[];
  readonly present: InfrastructureGraph;
  readonly future: readonly InfrastructureGraph[];
}

export const DEFAULT_HISTORY_LIMIT = 100;

export const createHistory = (present: InfrastructureGraph): GraphHistory => ({
  past: [],
  present,
  future: [],
});

export const pushHistory = (
  history: GraphHistory,
  next: InfrastructureGraph,
  limit: number = DEFAULT_HISTORY_LIMIT,
): GraphHistory => {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  return { past: past.slice(Math.max(0, past.length - limit)), present: next, future: [] };
};

export const canUndo = (h: GraphHistory): boolean => h.past.length > 0;
export const canRedo = (h: GraphHistory): boolean => h.future.length > 0;

export const undo = (h: GraphHistory): GraphHistory => {
  const previous = h.past[h.past.length - 1];
  if (!previous) return h;
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
};

export const redo = (h: GraphHistory): GraphHistory => {
  const [next, ...rest] = h.future;
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: rest };
};

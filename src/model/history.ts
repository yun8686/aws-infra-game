import type { Diagram } from './schema';

/** Immutable undo/redo history. Graphs are immutable values, so snapshots are cheap. */
export interface DiagramHistory {
  readonly past: readonly Diagram[];
  readonly present: Diagram;
  readonly future: readonly Diagram[];
}

export const DEFAULT_HISTORY_LIMIT = 100;

export const createHistory = (present: Diagram): DiagramHistory => ({
  past: [],
  present,
  future: [],
});

export const pushHistory = (
  history: DiagramHistory,
  next: Diagram,
  limit: number = DEFAULT_HISTORY_LIMIT,
): DiagramHistory => {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  return { past: past.slice(Math.max(0, past.length - limit)), present: next, future: [] };
};

export const canUndo = (h: DiagramHistory): boolean => h.past.length > 0;
export const canRedo = (h: DiagramHistory): boolean => h.future.length > 0;

export const undo = (h: DiagramHistory): DiagramHistory => {
  const previous = h.past[h.past.length - 1];
  if (!previous) return h;
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
};

export const redo = (h: DiagramHistory): DiagramHistory => {
  const [next, ...rest] = h.future;
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: rest };
};

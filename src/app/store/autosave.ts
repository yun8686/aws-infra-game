import type { StoreApi } from 'zustand/vanilla';
import type { ProjectRepository } from '../persistence/repository';
import type { AppState } from './projectStore';

export interface Autosave {
  /** Save every dirty project now (e.g. on page hide). */
  flush(): Promise<void>;
  dispose(): void;
}

/**
 * Debounced per-project autosave. Navigating between screens or projects never discards edits:
 * the store holds them and this writes them to the repository shortly after each change.
 */
export const startAutosave = (
  store: StoreApi<AppState>,
  repo: ProjectRepository,
  options: { readonly delayMs?: number; readonly retryMs?: number } = {},
): Autosave => {
  const delay = options.delayMs ?? 300;
  const retry = options.retryMs ?? 3000;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const save = async (id: string) => {
    timers.delete(id);
    const project = store.getState().projects[id];
    if (!project) return;
    store.getState().markSaving(id);
    try {
      await repo.save(project);
      store.getState().markSaved(id, project.updatedAt);
    } catch {
      store.getState().markSaveFailed(id);
      timers.set(
        id,
        setTimeout(() => void save(id), retry),
      );
    }
  };

  const schedule = (state: AppState) => {
    for (const [id, s] of Object.entries(state.saveState)) {
      if (s !== 'dirty' || timers.has(id)) continue;
      timers.set(
        id,
        setTimeout(() => void save(id), delay),
      );
    }
  };

  const unsubscribe = store.subscribe(schedule);
  schedule(store.getState());

  return {
    async flush() {
      const ids = [...timers.keys()];
      for (const id of ids) clearTimeout(timers.get(id));
      timers.clear();
      const dirty = Object.entries(store.getState().saveState)
        .filter(([, s]) => s === 'dirty' || s === 'error')
        .map(([id]) => id);
      await Promise.all([...new Set([...ids, ...dirty])].map((id) => save(id)));
    },
    dispose() {
      unsubscribe();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
};

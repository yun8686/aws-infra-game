import type { Project } from '../../game';

export interface LoadResult {
  readonly projects: readonly Project[];
  /** Saves that could not be parsed (e.g. an older format). The app deletes them at start-up and says how many. */
  readonly corrupt: readonly { readonly id: string; readonly reason: string }[];
}

/** Persistence port (ADR 0006: local-only). Implementations: IndexedDB (app), in-memory (tests). */
export interface ProjectRepository {
  loadAll(): Promise<LoadResult>;
  save(project: Project): Promise<void>;
  remove(id: string): Promise<void>;
}

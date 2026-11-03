import type { Project } from '../../game';

export interface LoadResult {
  readonly projects: readonly Project[];
  /** Saves that could not be parsed; kept in storage untouched so nothing is silently destroyed. */
  readonly corrupt: readonly { readonly id: string; readonly reason: string }[];
}

/** Persistence port (ADR 0006: local-only). Implementations: IndexedDB (app), in-memory (tests). */
export interface ProjectRepository {
  loadAll(): Promise<LoadResult>;
  save(project: Project): Promise<void>;
  remove(id: string): Promise<void>;
}

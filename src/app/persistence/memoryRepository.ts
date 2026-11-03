import { parseProject, type Project } from '../../game';
import type { LoadResult, ProjectRepository } from './repository';

/** In-memory repository that round-trips through JSON like a real store would. */
export class MemoryProjectRepository implements ProjectRepository {
  readonly records = new Map<string, unknown>();
  failNextSave = false;

  async loadAll(): Promise<LoadResult> {
    const projects: Project[] = [];
    const corrupt: { id: string; reason: string }[] = [];
    for (const [id, raw] of this.records) {
      const parsed = parseProject(raw);
      if (parsed.ok) projects.push(parsed.value);
      else corrupt.push({ id, reason: parsed.error });
    }
    return { projects, corrupt };
  }

  async save(project: Project): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('simulated save failure');
    }
    this.records.set(project.id, JSON.parse(JSON.stringify(project)));
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
  }
}

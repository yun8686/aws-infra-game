import { parseProject, type Project } from '../../game';
import type { LoadResult, ProjectRepository } from './repository';

/** New database for the diagram model (ADR 0018); saves of the previous prototype are left untouched. */
const DB_NAME = 'infra-diagram';
const DB_VERSION = 1;
const STORE = 'projects';

const promisify = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

const openDb = (factory: IDBFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'));
  });

/** Stores each project as one record keyed by id. Records are validated on load. */
export class IndexedDbProjectRepository implements ProjectRepository {
  private db: Promise<IDBDatabase> | undefined;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    this.db ??= openDb(this.factory);
    return this.db.then((db) => db.transaction(STORE, mode).objectStore(STORE));
  }

  async loadAll(): Promise<LoadResult> {
    const store = await this.store('readonly');
    const [keys, values] = await Promise.all([promisify(store.getAllKeys()), promisify(store.getAll())]);
    const projects: Project[] = [];
    const corrupt: { id: string; reason: string }[] = [];
    values.forEach((raw: unknown, i) => {
      const parsed = parseProject(raw);
      if (parsed.ok) projects.push(parsed.value);
      else corrupt.push({ id: String(keys[i]), reason: parsed.error });
    });
    return { projects, corrupt };
  }

  async save(project: Project): Promise<void> {
    const store = await this.store('readwrite');
    // structuredClone strips prototypes and catches non-cloneable values early.
    await promisify(store.put(structuredClone(project)));
  }

  async remove(id: string): Promise<void> {
    const store = await this.store('readwrite');
    await promisify(store.delete(id));
  }
}

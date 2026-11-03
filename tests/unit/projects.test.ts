import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbProjectRepository } from '../../src/app/persistence/indexedDbRepository';
import { MemoryProjectRepository } from '../../src/app/persistence/memoryRepository';
import { startAutosave } from '../../src/app/store/autosave';
import { canRedoProject, canUndoProject, createAppStore } from '../../src/app/store/projectStore';
import { parseRoute, routeHref } from '../../src/app/router';
import { TEMPLATES } from '../../src/data/templates';
import { createProject, parseProject, projectStatus } from '../../src/domain/projects/project';
import { estimateMonthlyCost } from '../../src/domain/simulation/cost';
import { setConfig, solutionA } from '../fixtures/solutions';

const sample = (id = 'p1') =>
  createProject({
    id,
    missionId: 'tv-spike',
    missionVersion: 1,
    name: 'Shop',
    graph: TEMPLATES['ecommerce-starter'](),
    now: 1000,
  });

const makeStore = (repo = new MemoryProjectRepository()) => {
  let clock = 1000;
  let n = 0;
  const store = createAppStore({ repo, now: () => ++clock, newId: () => `id-${++n}` });
  return { store, repo };
};

describe('project model', () => {
  it('round-trips through JSON and validates', () => {
    const p = sample();
    const parsed = parseProject(JSON.parse(JSON.stringify(p)));
    expect(parsed.ok && parsed.value).toEqual(p);
    expect(projectStatus(p)).toBe('not_run');
    const broken = parseProject({ ...p, graph: { schemaVersion: 99 } });
    expect(broken.ok).toBe(false);
  });

  it('estimates steady monthly cost without simulating', () => {
    expect(estimateMonthlyCost(TEMPLATES['ecommerce-starter']())).toBe(7 * 730);
  });
});

describe('router', () => {
  it('parses and builds hash routes', () => {
    expect(parseRoute('')).toEqual({ name: 'projects' });
    expect(parseRoute('#/p/abc/results')).toEqual({ name: 'project', id: 'abc', tab: 'results' });
    expect(parseRoute('#/p/abc/unknown')).toEqual({ name: 'project', id: 'abc', tab: 'brief' });
    expect(routeHref({ name: 'project', id: 'a b', tab: 'monitor' })).toBe('#/p/a%20b/monitor');
    expect(parseRoute(routeHref({ name: 'project', id: 'a b', tab: 'monitor' }))).toMatchObject({
      id: 'a b',
    });
  });
});

describe('app store', () => {
  it('starts a project from a mission and keeps several projects independent', async () => {
    const { store } = makeStore();
    await store.getState().init();
    const a = store.getState().startProject('tv-spike');
    const b = store.getState().startProject('sandbox');
    const s = store.getState();
    expect(Object.keys(s.projects)).toEqual([a, b]);
    expect(s.projects[a]?.graph).toEqual(TEMPLATES['ecommerce-starter']());
    expect(Object.keys(s.projects[b]?.graph.nodes ?? {})).toEqual(['internet-1']);
    store.getState().applyGraph(a, setConfig(s.projects[a]!.graph, 'ec2-1', { instanceCount: 3 }));
    expect(store.getState().projects[b]?.graph).toEqual(s.projects[b]?.graph);
  });

  it('applies edits with undo/redo and marks the project dirty', async () => {
    const { store } = makeStore();
    await store.getState().init();
    const id = store.getState().startProject('tv-spike');
    const g0 = store.getState().projects[id]!.graph;
    const g1 = setConfig(g0, 'ec2-1', { instanceCount: 4 });
    store.getState().applyGraph(id, g1);
    expect(store.getState().saveState[id]).toBe('dirty');
    expect(canUndoProject(store.getState(), id)).toBe(true);
    store.getState().undo(id);
    expect(store.getState().projects[id]?.graph).toBe(g0);
    expect(canRedoProject(store.getState(), id)).toBe(true);
    store.getState().redo(id);
    expect(store.getState().projects[id]?.graph).toBe(g1);
  });

  it('runs the mission and records a summary', async () => {
    const { store } = makeStore();
    await store.getState().init();
    const id = store.getState().startProject('tv-spike');
    const fail = store.getState().runSimulation(id);
    expect(fail.ok && fail.run.evaluation.passed).toBe(false);
    expect(projectStatus(store.getState().projects[id]!)).toBe('failed');
    store.getState().applyGraph(id, solutionA(store.getState().projects[id]!.graph));
    const pass = store.getState().runSimulation(id);
    expect(pass.ok && pass.run.evaluation.passed).toBe(true);
    expect(store.getState().projects[id]?.lastRun).toMatchObject({ passed: true });
  });

  it('reports blocking validation errors instead of running', async () => {
    const { store } = makeStore();
    await store.getState().init();
    const id = store.getState().startProject('sandbox');
    const r = store.getState().runSimulation(id);
    expect(!r.ok && r.error.kind).toBe('invalid_graph');
  });

  it('loads saved projects and reports corrupt ones without deleting them', async () => {
    const repo = new MemoryProjectRepository();
    await repo.save(sample('good'));
    repo.records.set('bad', { nope: true });
    const { store } = makeStore(repo);
    await store.getState().init();
    expect(Object.keys(store.getState().projects)).toEqual(['good']);
    expect(store.getState().loadErrors.map((e) => e.id)).toEqual(['bad']);
    expect(repo.records.has('bad')).toBe(true);
  });
});

describe('autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces saves and marks projects saved', async () => {
    const { store, repo } = makeStore();
    await store.getState().init();
    const autosave = startAutosave(store, repo, { delayMs: 500 });
    const id = store.getState().startProject('tv-spike');
    const g = store.getState().projects[id]!.graph;
    store.getState().applyGraph(id, setConfig(g, 'ec2-1', { instanceCount: 3 }));
    store.getState().applyGraph(id, setConfig(g, 'ec2-1', { instanceCount: 5 }));
    expect(repo.records.size).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(store.getState().saveState[id]).toBe('saved');
    const saved = parseProject(repo.records.get(id));
    expect(
      saved.ok && (saved.value.graph.nodes['ec2-1']?.config as { instanceCount: number }).instanceCount,
    ).toBe(5);
    autosave.dispose();
  });

  it('retries after a failure and flushes on demand', async () => {
    const { store, repo } = makeStore();
    await store.getState().init();
    const autosave = startAutosave(store, repo, { delayMs: 500, retryMs: 1000 });
    const id = store.getState().startProject('tv-spike');
    repo.failNextSave = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(store.getState().saveState[id]).toBe('error');
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().saveState[id]).toBe('saved');

    store.getState().renameProject(id, 'Renamed');
    await autosave.flush();
    const saved = parseProject(repo.records.get(id));
    expect(saved.ok && saved.value.name).toBe('Renamed');
    autosave.dispose();
  });
});

describe('IndexedDB repository', () => {
  it('saves, loads, validates and removes projects', async () => {
    const factory = new IDBFactory();
    const repo = new IndexedDbProjectRepository(factory);
    await repo.save(sample('a'));
    await repo.save(sample('b'));
    const reopened = new IndexedDbProjectRepository(factory);
    const loaded = await reopened.loadAll();
    expect(loaded.projects.map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect(loaded.projects.find((p) => p.id === 'a')).toEqual(sample('a'));
    await reopened.remove('a');
    expect((await reopened.loadAll()).projects.map((p) => p.id)).toEqual(['b']);
  });
});

describe('run staleness and focus routes', () => {
  it('marks a run stale after the graph changes and fresh after undo', async () => {
    const { isRunStale } = await import('../../src/app/store/projectStore');
    const { store } = makeStore();
    await store.getState().init();
    const id = store.getState().startProject('tv-spike');
    store.getState().runSimulation(id);
    expect(isRunStale(store.getState(), id)).toBe(false);
    store
      .getState()
      .applyGraph(id, setConfig(store.getState().projects[id]!.graph, 'ec2-1', { instanceCount: 3 }));
    expect(isRunStale(store.getState(), id)).toBe(true);
    store.getState().undo(id);
    expect(isRunStale(store.getState(), id)).toBe(false);
  });

  it('routes can focus a resource', () => {
    const r = { name: 'project', id: 'p', tab: 'architecture', focus: 'rds-1' } as const;
    expect(parseRoute(routeHref(r))).toEqual(r);
  });
});

describe('progressive hints', () => {
  it('reveals one more hint per failed attempt and none before running or after passing', async () => {
    const { revealedHintCount } = await import('../../src/domain/projects/project');
    const base = sample();
    const failedRun = { passed: false } as NonNullable<typeof base.lastRun>;
    expect(revealedHintCount(base, 3)).toBe(0);
    expect(revealedHintCount({ ...base, lastRun: failedRun, attempts: 1 }, 3)).toBe(1);
    expect(revealedHintCount({ ...base, lastRun: failedRun, attempts: 5 }, 3)).toBe(3);
    expect(revealedHintCount({ ...base, lastRun: { ...failedRun, passed: true }, attempts: 2 }, 3)).toBe(0);
  });
});

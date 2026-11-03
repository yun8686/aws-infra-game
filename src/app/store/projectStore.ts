import { createStore, type StoreApi } from 'zustand/vanilla';
import { MISSIONS, startMissionById, type MissionId } from '../../data/missions';
import { SCENARIOS, type ScenarioId } from '../../data/scenarios';
import { MISSION_TEXT_JA } from '../../data/i18n/ja/missions';
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  undo,
  type GraphHistory,
} from '../../domain/graph/history';
import type { InfrastructureGraph } from '../../domain/graph/types';
import { runMission, type MissionRun } from '../../domain/missions/runMission';
import { createProject, summarizeRun, type Project } from '../../domain/projects/project';
import type { SimulationError } from '../../domain/simulation/engine';
import type { ProjectRepository } from '../persistence/repository';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export interface AppDeps {
  readonly repo: ProjectRepository;
  readonly now: () => number;
  readonly newId: () => string;
}

export interface AppState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly projects: Readonly<Record<string, Project>>;
  /** Undo history per project; in memory only. */
  readonly histories: Readonly<Record<string, GraphHistory>>;
  readonly saveState: Readonly<Record<string, SaveState>>;
  /** Latest full run per project (not persisted; the summary is). */
  readonly runs: Readonly<Record<string, MissionRun>>;
  readonly loadErrors: readonly { readonly id: string; readonly reason: string }[];

  init(): Promise<void>;
  startProject(missionId: MissionId): string;
  applyGraph(projectId: string, next: InfrastructureGraph): void;
  undo(projectId: string): void;
  redo(projectId: string): void;
  runSimulation(projectId: string): { ok: true; run: MissionRun } | { ok: false; error: SimulationError };
  renameProject(projectId: string, name: string): void;
  deleteProject(projectId: string): Promise<void>;
  /** Called by autosave. */
  markSaving(projectId: string): void;
  markSaved(projectId: string, savedAt: number): void;
  markSaveFailed(projectId: string): void;
}

export const canUndoProject = (s: AppState, id: string) => !!s.histories[id] && canUndo(s.histories[id]);
export const canRedoProject = (s: AppState, id: string) => !!s.histories[id] && canRedo(s.histories[id]);

export const createAppStore = (deps: AppDeps): StoreApi<AppState> =>
  createStore<AppState>()((set, get) => {
    const updateProject = (id: string, patch: Partial<Project>) => {
      const current = get().projects[id];
      if (!current) return;
      set((s) => ({
        projects: { ...s.projects, [id]: { ...current, ...patch, updatedAt: deps.now() } },
        saveState: { ...s.saveState, [id]: 'dirty' },
      }));
    };

    const setGraphFromHistory = (id: string, history: GraphHistory) => {
      set((s) => ({ histories: { ...s.histories, [id]: history } }));
      updateProject(id, { graph: history.present });
    };

    return {
      status: 'loading',
      projects: {},
      histories: {},
      saveState: {},
      runs: {},
      loadErrors: [],

      async init() {
        try {
          const { projects, corrupt } = await deps.repo.loadAll();
          set({
            status: 'ready',
            projects: Object.fromEntries(projects.map((p) => [p.id, p])),
            histories: Object.fromEntries(projects.map((p) => [p.id, createHistory(p.graph)])),
            saveState: Object.fromEntries(projects.map((p) => [p.id, 'saved' as const])),
            loadErrors: corrupt,
          });
        } catch {
          set({ status: 'error' });
        }
      },

      startProject(missionId) {
        const mission = MISSIONS[missionId];
        const { graph } = startMissionById(missionId);
        const id = deps.newId();
        const project = createProject({
          id,
          missionId,
          missionVersion: mission.version,
          name: MISSION_TEXT_JA[missionId].projectName,
          graph,
          now: deps.now(),
        });
        set((s) => ({
          projects: { ...s.projects, [id]: project },
          histories: { ...s.histories, [id]: createHistory(graph) },
          saveState: { ...s.saveState, [id]: 'dirty' },
        }));
        return id;
      },

      applyGraph(id, next) {
        const history = get().histories[id];
        if (!history) return;
        setGraphFromHistory(id, pushHistory(history, next));
      },

      undo(id) {
        const history = get().histories[id];
        if (history && canUndo(history)) setGraphFromHistory(id, undo(history));
      },

      redo(id) {
        const history = get().histories[id];
        if (history && canRedo(history)) setGraphFromHistory(id, redo(history));
      },

      runSimulation(id) {
        const project = get().projects[id];
        if (!project) return { ok: false, error: { kind: 'invalid_scenario', message: 'project not found' } };
        const mission = MISSIONS[project.missionId as MissionId];
        const scenario = SCENARIOS[mission.scenarioId as ScenarioId];
        const result = runMission(mission, scenario, project.graph);
        if (!result.ok) return { ok: false, error: result.error };
        set((s) => ({ runs: { ...s.runs, [id]: result.value } }));
        updateProject(id, { lastRun: summarizeRun(result.value.simulation, result.value.evaluation) });
        return { ok: true, run: result.value };
      },

      renameProject(id, name) {
        updateProject(id, { name });
      },

      async deleteProject(id) {
        await deps.repo.remove(id);
        set((s) => {
          const omit = <T>(r: Readonly<Record<string, T>>) =>
            Object.fromEntries(Object.entries(r).filter(([k]) => k !== id));
          return {
            projects: omit(s.projects),
            histories: omit(s.histories),
            saveState: omit(s.saveState),
            runs: omit(s.runs),
          };
        });
      },

      markSaving(id) {
        set((s) => ({ saveState: { ...s.saveState, [id]: 'saving' } }));
      },
      markSaved(id, savedAt) {
        // A newer edit made while saving keeps the project dirty.
        const p = get().projects[id];
        if (!p) return;
        set((s) => ({ saveState: { ...s.saveState, [id]: p.updatedAt > savedAt ? 'dirty' : 'saved' } }));
      },
      markSaveFailed(id) {
        set((s) => ({ saveState: { ...s.saveState, [id]: 'error' } }));
      },
    };
  });

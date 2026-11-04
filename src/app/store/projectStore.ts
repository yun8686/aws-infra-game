import { createStore, type StoreApi } from 'zustand/vanilla';
import { MISSIONS, SCENARIOS, startMissionById, type MissionId, type ScenarioId } from '../../content';
import {
  createProject,
  missionEditPolicy,
  runMission,
  summarizeRun,
  type MissionRun,
  type Project,
} from '../../game';
import { MISSION_TEXT_JA } from '../../i18n';
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  undo,
  type Diagram,
  type DiagramHistory,
  type EditPolicy,
  type EditResult,
} from '../../model';
import { computeInputHash, type SimulationError } from '../../sim';
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
  readonly histories: Readonly<Record<string, DiagramHistory>>;
  readonly saveState: Readonly<Record<string, SaveState>>;
  /** Latest full run per project (not persisted; the summary is). */
  readonly runs: Readonly<Record<string, MissionRun>>;
  /** Unreadable saves removed at start-up (shown once on the project list). */
  readonly loadErrors: readonly { readonly id: string; readonly reason: string }[];
  /** Selected playback minute per project, shared by the monitor and results tabs. */
  readonly playhead: Readonly<Record<string, number>>;
  setPlayhead(projectId: string, minute: number): void;

  init(): Promise<void>;
  startProject(missionId: MissionId): string;
  applyDiagram(projectId: string, next: Diagram): void;
  /** Run an edit command with the mission's edit policy; the diagram changes only if it succeeds. */
  edit(
    projectId: string,
    command: (diagram: Diagram, policy: EditPolicy) => EditResult,
  ): EditResult | undefined;
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

    const setGraphFromHistory = (id: string, history: DiagramHistory) => {
      set((s) => ({ histories: { ...s.histories, [id]: history } }));
      updateProject(id, { diagram: history.present });
    };

    return {
      status: 'loading',
      projects: {},
      histories: {},
      saveState: {},
      runs: {},
      loadErrors: [],
      playhead: {},

      setPlayhead(id, minute) {
        set((s) => ({ playhead: { ...s.playhead, [id]: minute } }));
      },

      async init() {
        try {
          const { projects, corrupt } = await deps.repo.loadAll();
          // Saves that no longer parse (older formats) are deleted; the list screen says how many.
          await Promise.all(corrupt.map((c) => deps.repo.remove(c.id).catch(() => undefined)));
          set({
            status: 'ready',
            projects: Object.fromEntries(projects.map((p) => [p.id, p])),
            histories: Object.fromEntries(projects.map((p) => [p.id, createHistory(p.diagram)])),
            saveState: Object.fromEntries(projects.map((p) => [p.id, 'saved' as const])),
            loadErrors: corrupt,
          });
        } catch {
          set({ status: 'error' });
        }
      },

      startProject(missionId) {
        const mission = MISSIONS[missionId];
        const { diagram } = startMissionById(missionId);
        const id = deps.newId();
        const project = createProject({
          id,
          missionId,
          missionVersion: mission.version,
          name: MISSION_TEXT_JA[missionId].projectName,
          diagram,
          now: deps.now(),
        });
        set((s) => ({
          projects: { ...s.projects, [id]: project },
          histories: { ...s.histories, [id]: createHistory(diagram) },
          saveState: { ...s.saveState, [id]: 'dirty' },
        }));
        return id;
      },

      applyDiagram(id, next) {
        const history = get().histories[id];
        if (!history) return;
        setGraphFromHistory(id, pushHistory(history, next));
      },

      edit(id, command) {
        const project = get().projects[id];
        if (!project) return undefined;
        const mission = MISSIONS[project.missionId as MissionId];
        const result = command(project.diagram, mission ? missionEditPolicy(mission) : {});
        if (result.ok) get().applyDiagram(id, result.diagram);
        return result;
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
        const result = runMission(mission, scenario, project.diagram);
        if (!result.ok) return { ok: false, error: result.error };
        set((s) => ({ runs: { ...s.runs, [id]: result.value }, playhead: { ...s.playhead, [id]: 0 } }));
        updateProject(id, {
          lastRun: summarizeRun(result.value.simulation, result.value.evaluation),
          attempts: (project.attempts ?? 0) + 1,
        });
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

/** True when the latest run was made with a different diagram than the current one. */
export const isRunStale = (s: AppState, id: string): boolean => {
  const run = s.runs[id];
  const project = s.projects[id];
  if (!run || !project) return false;
  const mission = MISSIONS[project.missionId as MissionId];
  const scenario = SCENARIOS[mission.scenarioId as ScenarioId];
  return (
    computeInputHash({ diagram: project.diagram, scenario, seed: mission.seed }) !== run.simulation.inputHash
  );
};

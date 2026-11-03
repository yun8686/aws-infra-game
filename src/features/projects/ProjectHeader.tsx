import { useMemo } from 'react';
import { useAppStore } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { MISSIONS, type MissionId } from '../../content';
import { estimateMonthlyCost } from '../../sim';
import { credits } from '../../shared/ui/format';
import type { SaveState } from '../../app/store/projectStore';

const SAVE_LABEL: Record<SaveState, string> = {
  saved: '保存済み',
  dirty: '未保存',
  saving: '保存中…',
  error: '保存に失敗（再試行中）',
};

export function ProjectHeader({ projectId }: { readonly projectId: string }) {
  const project = useAppStore((s) => s.projects[projectId]);
  const saveState = useAppStore((s) => s.saveState[projectId] ?? 'saved');
  const estimate = useMemo(() => (project ? estimateMonthlyCost(project.diagram) : 0), [project]);
  if (!project) return null;
  const budget = MISSIONS[project.missionId as MissionId]?.objectives.monthlyBudget ?? 0;
  const ratio = budget > 0 ? estimate / budget : 0;
  const last = project.lastRun;

  return (
    <header className="project-header">
      <button
        type="button"
        className="icon-button"
        aria-label="案件一覧に戻る"
        onClick={() => navigate({ name: 'projects' })}
      >
        ‹
      </button>
      <div className="project-header-main">
        <h1>{project.name}</h1>
        <div className="project-header-meta">
          <span
            className={`chip-badge ${ratio > 1 ? 'is-bad' : ratio > 0.85 ? 'is-warn' : 'is-ok'}`}
            title="通常時の月額見込み（シミュレーション前の概算）"
          >
            月額 {credits(estimate)} / {credits(budget)}
          </span>
          <span className={`chip-badge ${last ? (last.passed ? 'is-ok' : 'is-bad') : 'is-muted'}`}>
            {last ? (last.passed ? '目標達成' : '目標未達') : '未実行'}
          </span>
          <span className={`save-state save-${saveState}`} role="status">
            {SAVE_LABEL[saveState]}
          </span>
        </div>
      </div>
    </header>
  );
}

import { useState } from 'react';
import { useAppStore } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { MISSION_TEXT_JA } from '../../i18n';
import { MISSIONS, type MissionId } from '../../content';
import { projectStatus, type Project } from '../../game';
import { estimateMonthlyCost } from '../../sim';
import { credits } from '../../shared/ui/format';

const STATUS_LABEL = { not_run: '未実行', failed: '目標未達', passed: '目標達成' } as const;
const STATUS_CLASS = { not_run: 'is-muted', failed: 'is-bad', passed: 'is-ok' } as const;

function ProjectCard({ project }: { readonly project: Project }) {
  const deleteProject = useAppStore((s) => s.deleteProject);
  // In-page confirmation: some hosts (Claude artifacts) suppress window.confirm.
  const [confirming, setConfirming] = useState(false);
  const missionId = project.missionId as MissionId;
  const text = MISSION_TEXT_JA[missionId];
  const budget = MISSIONS[missionId]?.objectives.monthlyBudget ?? 0;
  const estimate = estimateMonthlyCost(project.diagram);
  const status = projectStatus(project);

  return (
    <li className="card project-card">
      <button
        type="button"
        className="card-main"
        onClick={() => navigate({ name: 'project', id: project.id, tab: 'brief' })}
        aria-label={`${project.name} を開く`}
      >
        <div className="card-title-row">
          <strong>{project.name}</strong>
          <span className={`chip-badge ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
        </div>
        <div className="card-sub">
          {text?.businessType} ・ {text?.title}
        </div>
        <dl className="card-facts">
          <div>
            <dt>月額見込み</dt>
            <dd className={estimate > budget ? 'text-bad' : undefined}>
              {credits(estimate)} / {credits(budget)}
            </dd>
          </div>
          {text?.nextEvent && (
            <div>
              <dt>次のイベント</dt>
              <dd>{text.nextEvent}</dd>
            </div>
          )}
          {project.lastRun && (
            <div>
              <dt>前回スコア</dt>
              <dd>{project.lastRun.overallScore}</dd>
            </div>
          )}
          {(project.attempts ?? 0) > 0 && (
            <div>
              <dt>挑戦回数</dt>
              <dd>{project.attempts}回</dd>
            </div>
          )}
        </dl>
      </button>
      {confirming ? (
        <div className="confirm-row" role="group" aria-label="削除の確認">
          <span>「{project.name}」を削除しますか？ 元に戻せません。</span>
          <button type="button" className="text-button" onClick={() => setConfirming(false)}>
            キャンセル
          </button>
          <button type="button" className="text-button danger" onClick={() => void deleteProject(project.id)}>
            削除する
          </button>
        </div>
      ) : (
        <button type="button" className="text-button danger" onClick={() => setConfirming(true)}>
          削除
        </button>
      )}
    </li>
  );
}

export function ProjectsScreen() {
  const status = useAppStore((s) => s.status);
  const projects = useAppStore((s) => s.projects);
  const loadErrors = useAppStore((s) => s.loadErrors);
  const startProject = useAppStore((s) => s.startProject);
  const list = Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="screen">
      <header className="app-header">
        <h1>担当案件</h1>
        <p>学習用の簡略モデルです。実際の AWS の性能・料金を示すものではありません。</p>
      </header>
      <main className="screen-body">
        {status === 'loading' && <p className="muted">読み込み中…</p>}
        {status === 'error' && <p className="text-bad">保存データを読み込めませんでした。</p>}
        {loadErrors.length > 0 && (
          <p className="notice" role="alert">
            読み込めない保存データが {loadErrors.length} 件あります（データは削除していません）。
          </p>
        )}

        <section aria-labelledby="active-heading">
          <h2 id="active-heading">進行中の案件</h2>
          {list.length === 0 ? (
            <p className="muted">まだ案件がありません。下の一覧から案件を受注しましょう。</p>
          ) : (
            <ul className="card-list">
              {list.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="new-heading">
          <h2 id="new-heading">新しい案件</h2>
          <ul className="card-list">
            {(Object.keys(MISSIONS) as MissionId[]).map((id) => {
              const t = MISSION_TEXT_JA[id];
              return (
                <li key={id} className="card">
                  <div className="card-body">
                    <div className="card-title-row">
                      <strong>{t.title}</strong>
                      <span className="chip-badge is-muted">{t.businessType}</span>
                    </div>
                    <p className="card-sub">{t.summary}</p>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => {
                        const pid = startProject(id);
                        navigate({ name: 'project', id: pid, tab: 'brief' });
                      }}
                    >
                      この案件を受注する
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}

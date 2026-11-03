import { useAppStore } from '../../app/AppContext';
import { routeHref, type ProjectTab } from '../../app/router';
import { ArchitectureTab } from '../infrastructure-editor/ArchitectureTab';
import { BriefingTab } from '../missions/BriefingTab';
import { ResultsTab } from '../simulation-results/ResultsTab';
import { ProjectHeader } from './ProjectHeader';

const TABS: readonly { id: ProjectTab; label: string; icon: string }[] = [
  { id: 'brief', label: '概要', icon: '📋' },
  { id: 'architecture', label: '構成', icon: '🧩' },
  { id: 'monitor', label: '監視', icon: '📈' },
  { id: 'results', label: '結果', icon: '🏁' },
];

export function ProjectScreen({ projectId, tab }: { readonly projectId: string; readonly tab: ProjectTab }) {
  const exists = useAppStore((s) => !!s.projects[projectId]);
  const status = useAppStore((s) => s.status);
  if (!exists) {
    return (
      <div className="screen">
        <main className="screen-body">
          <p className="muted">{status === 'loading' ? '読み込み中…' : '案件が見つかりません。'}</p>
          <a href={routeHref({ name: 'projects' })}>案件一覧へ</a>
        </main>
      </div>
    );
  }

  return (
    <div className="screen with-tabbar">
      <ProjectHeader projectId={projectId} />
      <main className="screen-body">
        {tab === 'brief' && <BriefingTab projectId={projectId} />}
        {tab === 'architecture' && <ArchitectureTab projectId={projectId} />}
        {tab === 'monitor' && (
          <div className="tab-content">
            <p className="muted">
              シミュレーション実行後に、リクエスト数・CPU 使用率・DB 接続数などの推移を表示します（開発中）。
            </p>
          </div>
        )}
        {tab === 'results' && <ResultsTab projectId={projectId} />}
      </main>
      <nav className="tabbar" aria-label="案件内メニュー">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={routeHref({ name: 'project', id: projectId, tab: t.id })}
            className={tab === t.id ? 'is-active' : undefined}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

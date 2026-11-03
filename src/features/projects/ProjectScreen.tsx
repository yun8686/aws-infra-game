import { useAppStore } from '../../app/AppContext';
import { routeHref, type ProjectTab } from '../../app/router';
import { EditorTab } from '../editor/EditorTab';
import { BriefingTab } from '../missions/BriefingTab';
import { ResultsTab } from '../simulation-results/ResultsTab';
import { MonitorTab } from '../monitoring/MonitorTab';
import { ProjectHeader } from './ProjectHeader';

const TABS: readonly { id: ProjectTab; label: string; icon: string }[] = [
  { id: 'brief', label: '概要', icon: '📋' },
  { id: 'architecture', label: '構成', icon: '🧩' },
  { id: 'monitor', label: '監視', icon: '📈' },
  { id: 'results', label: '結果', icon: '🏁' },
];

export function ProjectScreen({
  projectId,
  tab,
  focus,
}: {
  readonly projectId: string;
  readonly tab: ProjectTab;
  readonly focus?: string | undefined;
}) {
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
        {tab === 'architecture' && <EditorTab key={focus ?? ''} projectId={projectId} focus={focus} />}
        {tab === 'monitor' && <MonitorTab projectId={projectId} />}
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

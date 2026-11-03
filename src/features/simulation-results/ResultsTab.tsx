import { useState } from 'react';
import { useAppStore } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { BOTTLENECK_TEXT_JA } from '../../data/i18n/ja/bottlenecks';
import { DIMENSION_TEXT_JA, LEARNING_TOPIC_TEXT_JA, METRIC_TEXT_JA } from '../../data/i18n/ja/evaluation';
import { FINDING_TEXT_JA, formatFindingText } from '../../data/i18n/ja/findings';
import type { Check } from '../../domain/scoring/evaluate';
import type { Finding } from '../../domain/validation/findings';
import { credits, ms, percent } from '../../shared/ui/format';
import { nodeLabel } from '../infrastructure-editor/components/EditorSheets';
import { StaleNotice } from '../monitoring/MonitorTab';

const formatCheck = (c: Check): string => {
  switch (c.metric) {
    case 'availability':
      return percent(c.actual);
    case 'errorRate':
      return percent(c.actual, 2);
    case 'p95LatencyMs':
      return ms(c.actual);
    case 'projectedMonthly':
      return credits(c.actual);
    case 'criticalSecurityFindings':
      return `${c.actual}件`;
  }
};
const formatTarget = (c: Check): string => {
  const v = { ...c, actual: c.target };
  return `${formatCheck(v)} ${c.comparator === '<=' ? '以下' : '以上'}`;
};

export function ResultsTab({ projectId }: { readonly projectId: string }) {
  const run = useAppStore((s) => s.runs[projectId]);
  const project = useAppStore((s) => s.projects[projectId]);
  const runSimulation = useAppStore((s) => s.runSimulation);
  const setPlayhead = useAppStore((s) => s.setPlayhead);
  const [blocking, setBlocking] = useState<readonly Finding[]>([]);
  if (!project) return null;

  const onRun = () => {
    const r = runSimulation(projectId);
    setBlocking(
      !r.ok && r.error.kind === 'invalid_graph' ? r.error.findings.filter((f) => f.severity === 'error') : [],
    );
  };
  const e = run?.evaluation;
  const s = run?.simulation;
  const graph = project.graph;

  return (
    <div className="tab-content">
      <button type="button" className="primary-button wide" onClick={onRun}>
        ▶ シミュレーションを実行
      </button>
      <StaleNotice projectId={projectId} />

      {blocking.length > 0 && (
        <section className="card card-body" role="alert">
          <h3>構成にエラーがあるため実行できません</h3>
          <ul className="bullet-list">
            {blocking.map((f, i) => (
              <li key={i}>{formatFindingText(FINDING_TEXT_JA[f.code].message, f.params)}</li>
            ))}
          </ul>
          <button
            type="button"
            className="text-button"
            onClick={() => navigate({ name: 'project', id: projectId, tab: 'architecture' })}
          >
            構成画面で直す
          </button>
        </section>
      )}

      {e && s && (
        <>
          <section
            className={`card card-body result-headline ${e.passed ? 'is-ok' : 'is-bad'}`}
            aria-live="polite"
          >
            <h2>{e.passed ? '目標達成' : '目標未達'}</h2>
            <p>
              総合スコア <strong className="hero-score">{e.overallScore}</strong>
            </p>
            <ul className="dimension-list">
              {e.dimensions.map((d) => (
                <li key={d.dimension} className={d.passed ? 'is-ok' : 'is-bad'}>
                  <span className="dimension-name">
                    {d.passed ? '✓' : '✗'} {DIMENSION_TEXT_JA[d.dimension]}
                  </span>
                  <span className="dimension-score">{d.score}点</span>
                  <span className="dimension-checks">
                    {d.checks.map((c) => (
                      <span key={c.metric}>
                        {METRIC_TEXT_JA[c.metric]}: <strong>{formatCheck(c)}</strong>（目標 {formatTarget(c)}
                        ）
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {e.keyBottlenecks.length > 0 && (
            <section className="card card-body">
              <h3>主な原因</h3>
              <ol className="bottleneck-list">
                {e.keyBottlenecks.map((b, i) => {
                  const t = BOTTLENECK_TEXT_JA[b.cause];
                  const first = b.windows[0];
                  return (
                    <li key={i}>
                      <strong>{t.message}</strong>
                      <div className="muted">
                        {b.nodeIds.map((id) => nodeLabel(graph, id)).join('、')} ・{' '}
                        {b.windows
                          .map((w) =>
                            w.startMinute === w.endMinute
                              ? `${w.startMinute}分`
                              : `${w.startMinute}〜${w.endMinute}分`,
                          )
                          .join('、')}{' '}
                        ・ 失敗 {Math.round(b.failedRequests).toLocaleString('ja-JP')}件
                      </div>
                      <p>{t.explanation}</p>
                      <p className="remediation">{t.remediation}</p>
                      <div className="bottleneck-actions">
                        {b.nodeIds[0] && graph.nodes[b.nodeIds[0]] && (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              navigate({
                                name: 'project',
                                id: projectId,
                                tab: 'architecture',
                                focus: b.nodeIds[0] as string,
                              })
                            }
                          >
                            構成図で見る
                          </button>
                        )}
                        {first && (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              setPlayhead(projectId, first.startMinute);
                              navigate({ name: 'project', id: projectId, tab: 'monitor' });
                            }}
                          >
                            {first.startMinute}分を見る
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {e.securityFindings.length > 0 && (
            <section className="card card-body">
              <h3>セキュリティの指摘</h3>
              <ul className="bullet-list">
                {e.securityFindings.map((f, i) => (
                  <li key={i}>
                    <strong>{formatFindingText(FINDING_TEXT_JA[f.code].message, f.params)}</strong>
                    {f.riskLevel === 'critical'
                      ? '（重大）'
                      : f.riskLevel === 'major'
                        ? '（中）'
                        : '（軽微）'}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {e.learningTopics.length > 0 && (
            <section className="card card-body">
              <h3>学習トピック</h3>
              <ul className="bullet-list">
                {e.learningTopics.map((t) => (
                  <li key={t}>
                    <strong>{LEARNING_TOPIC_TEXT_JA[t].title}</strong>: {LEARNING_TOPIC_TEXT_JA[t].summary}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button
            type="button"
            className="secondary-button wide-secondary"
            onClick={() => navigate({ name: 'project', id: projectId, tab: 'monitor' })}
          >
            📈 監視画面で時間ごとの推移を見る
          </button>
        </>
      )}

      {!run && project.lastRun && (
        <p className="muted">
          前回の結果: {project.lastRun.passed ? '目標達成' : '目標未達'}（スコア{' '}
          {project.lastRun.overallScore}）。詳細を見るには再実行してください。
        </p>
      )}
      <p className="fine-print">シミュレーション結果は学習用の簡略モデルによる推定値です。</p>
    </div>
  );
}

import { useState } from 'react';
import { useAppStore } from '../../app/AppContext';
import { BOTTLENECK_TEXT_JA } from '../../data/i18n/ja/bottlenecks';
import { DIMENSION_TEXT_JA, LEARNING_TOPIC_TEXT_JA } from '../../data/i18n/ja/evaluation';
import { FINDING_TEXT_JA, formatFindingText } from '../../data/i18n/ja/findings';
import type { Finding } from '../../domain/validation/findings';
import { credits, ms, percent } from '../../shared/ui/format';

/** Phase 4: run + headline evaluation. Charts and timeline playback arrive in Phase 6. */
export function ResultsTab({ projectId }: { readonly projectId: string }) {
  const run = useAppStore((s) => s.runs[projectId]);
  const project = useAppStore((s) => s.projects[projectId]);
  const runSimulation = useAppStore((s) => s.runSimulation);
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

  return (
    <div className="tab-content">
      <button type="button" className="primary-button wide" onClick={onRun}>
        ▶ シミュレーションを実行
      </button>

      {blocking.length > 0 && (
        <section className="card card-body" role="alert">
          <h3>構成にエラーがあるため実行できません</h3>
          <ul className="bullet-list">
            {blocking.map((f, i) => (
              <li key={i}>{formatFindingText(FINDING_TEXT_JA[f.code].message, f.params)}</li>
            ))}
          </ul>
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
              総合スコア <strong>{e.overallScore}</strong>
            </p>
            <ul className="dimension-list">
              {e.dimensions.map((d) => (
                <li key={d.dimension} className={d.passed ? 'is-ok' : 'is-bad'}>
                  <span>{DIMENSION_TEXT_JA[d.dimension]}</span>
                  <span>
                    {d.passed ? '✓' : '✗'} {d.score}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="objective-list">
              <div>
                <dt>エラー率</dt>
                <dd>{percent(s.summary.errorRate, 2)}</dd>
              </div>
              <div>
                <dt>応答時間（p95）</dt>
                <dd>{ms(s.summary.p95LatencyMs)}</dd>
              </div>
              <div>
                <dt>可用性</dt>
                <dd>{percent(s.summary.availability)}</dd>
              </div>
              <div>
                <dt>月額見積もり</dt>
                <dd>{credits(s.cost.projectedMonthly)}</dd>
              </div>
            </dl>
          </section>

          {e.keyBottlenecks.length > 0 && (
            <section className="card card-body">
              <h3>主な原因</h3>
              <ol className="bottleneck-list">
                {e.keyBottlenecks.map((b, i) => {
                  const t = BOTTLENECK_TEXT_JA[b.cause];
                  const names = b.nodeIds.map((id) => project.graph.nodes[id]?.name ?? id).join(', ');
                  return (
                    <li key={i}>
                      <strong>{t.message}</strong>
                      <span className="muted">
                        {' '}
                        （{names}・{b.startMinute}〜{b.endMinute}分）
                      </span>
                      <p>{t.explanation}</p>
                      <p className="remediation">{t.remediation}</p>
                    </li>
                  );
                })}
              </ol>
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

import { useAppStore } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { MISSION_TEXT_JA } from '../../data/i18n/ja/missions';
import { SERVICE_TEXT_JA } from '../../data/i18n/ja/services';
import { MISSIONS, type MissionId } from '../../data/missions';
import { SCENARIOS, type ScenarioId } from '../../data/scenarios';
import { credits, ms, percent } from '../../shared/ui/format';
import { WorkloadChart } from './WorkloadChart';
import { appName } from '../../data/i18n/ja/apps';
import { GuideCard } from '../../shared/ui/GuideCard';

export function BriefingTab({ projectId }: { readonly projectId: string }) {
  const project = useAppStore((s) => s.projects[projectId]);
  if (!project) return null;
  const missionId = project.missionId as MissionId;
  const mission = MISSIONS[missionId];
  const text = MISSION_TEXT_JA[missionId];
  const scenario = SCENARIOS[mission.scenarioId as ScenarioId];
  const o = mission.objectives;
  const locked = Object.entries(mission.constraints.lockedNodes ?? {});

  return (
    <div className="tab-content">
      <GuideCard id="guide-brief" title="進め方">
        <ol>
          <li>顧客の依頼と達成条件を読みます。</li>
          <li>「結果」タブで、今の構成のままシミュレーションしてみます。</li>
          <li>「構成」タブで構成を直し、もう一度実行します。</li>
          <li>「監視」タブで、いつ・どこで問題が起きたかを確認できます。</li>
        </ol>
      </GuideCard>
      <section className="card card-body">
        <h2>{text.title}</h2>
        <p className="muted">
          {text.customer} ・ {text.businessType}
        </p>
        <blockquote className="customer-request">{text.request}</blockquote>
      </section>

      <section className="card card-body">
        <h3>状況</h3>
        <ul className="bullet-list">
          {text.situation.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <WorkloadChart scenario={scenario} />
      </section>

      <section className="card card-body">
        <h3>達成条件</h3>
        {mission.appObjectives ? (
          <div className="table-scroll">
            <table className="objective-table">
              <thead>
                <tr>
                  <th scope="col">アプリ</th>
                  <th scope="col">エラー率</th>
                  <th scope="col">応答時間（p95）</th>
                  <th scope="col">可用性</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(mission.appObjectives).map(([app, ao]) => (
                  <tr key={app}>
                    <th scope="row">{appName(app)}</th>
                    <td>{percent(ao.maxErrorRate)} 以下</td>
                    <td>{ms(ao.maxP95LatencyMs)} 以下</td>
                    <td>{percent(ao.minAvailability, 0)} 以上</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <dl className="objective-list">
          {!mission.appObjectives && (
            <>
              <div>
                <dt>エラー率</dt>
                <dd>{percent(o.maxErrorRate)} 以下</dd>
              </div>
              <div>
                <dt>応答時間（p95）</dt>
                <dd>{ms(o.maxP95LatencyMs)} 以下</dd>
              </div>
              <div>
                <dt>可用性</dt>
                <dd>{percent(o.minAvailability, 0)} 以上</dd>
              </div>
            </>
          )}
          <div>
            <dt>月額予算</dt>
            <dd>{credits(o.monthlyBudget)} 以下</dd>
          </div>
          <div>
            <dt>セキュリティ</dt>
            <dd>重大な指摘なし</dd>
          </div>
        </dl>
        {locked.length > 0 && (
          <>
            <h3>制約</h3>
            <ul className="bullet-list">
              {locked.map(([id, lock]) => {
                const node = project.graph.nodes[id];
                const type = node?.serviceType as keyof typeof SERVICE_TEXT_JA | undefined;
                return (
                  <li key={id}>
                    {node?.name ?? id}（{type ? SERVICE_TEXT_JA[type]?.name : ''}）は
                    {lock === 'no-delete' ? '削除できません（設定変更は可能）' : '変更できません'}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="fine-print">
          数値はゲーム内の学習用モデルの値です。実際の AWS の性能・料金とは異なります。
        </p>
      </section>

      <section className="card card-body">
        <h3>はじめに</h3>
        <p>{text.firstStep}</p>
        <p className="fine-print">うまくいかないときは、結果画面に再挑戦のたびにヒントが表示されます。</p>
        <button
          type="button"
          className="primary-button"
          onClick={() => navigate({ name: 'project', id: projectId, tab: 'architecture' })}
        >
          現在の構成を見る
        </button>
      </section>
    </div>
  );
}

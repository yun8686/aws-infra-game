import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { isRunStale } from '../../app/store/projectStore';
import { MISSIONS, type MissionId } from '../../data/missions';
import { SCENARIO_EVENT_KINDS, TIMELINE_TEXT_JA } from '../../data/i18n/ja/timeline';
import { GraphCanvas } from '../infrastructure-editor/components/GraphCanvas';
import { nodeLabel } from '../infrastructure-editor/components/EditorSheets';
import { TimeSeriesChart, type Series } from '../../shared/ui/charts/TimeSeriesChart';
import { credits, ms, percent } from '../../shared/ui/format';
import { badgesAt, computeNodeIds, databaseNodeIds, pick } from './series';
import type { StepMetrics } from '../../domain/simulation/types';
import './monitor.css';

const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'] as const;
const MAX_SERIES = 3;

export function RunPrompt({ projectId }: { readonly projectId: string }) {
  const runSimulation = useAppStore((s) => s.runSimulation);
  return (
    <section className="card card-body">
      <p>シミュレーションを実行すると、ここに時間ごとのメトリクスが表示されます。</p>
      <button
        type="button"
        className="primary-button wide"
        onClick={() => {
          const r = runSimulation(projectId);
          if (!r.ok) navigate({ name: 'project', id: projectId, tab: 'results' });
        }}
      >
        ▶ シミュレーションを実行
      </button>
    </section>
  );
}

export function StaleNotice({ projectId }: { readonly projectId: string }) {
  const stale = useAppStore((s) => isRunStale(s, projectId));
  const runSimulation = useAppStore((s) => s.runSimulation);
  if (!stale) return null;
  return (
    <p className="notice stale-notice" role="status">
      構成が変更されています。表示中の結果は変更前のものです。
      <button type="button" className="text-button" onClick={() => runSimulation(projectId)}>
        再実行
      </button>
    </p>
  );
}

/** Monitoring is a gameplay surface (PRODUCT_SPEC §9): scrub or play back the run and see cause and effect. */
export function MonitorTab({ projectId }: { readonly projectId: string }) {
  const run = useAppStore((s) => s.runs[projectId]);
  const graph = useAppStore((s) => s.projects[projectId]?.graph);
  const missionId = useAppStore((s) => s.projects[projectId]?.missionId) as MissionId | undefined;
  const minute = useAppStore((s) => s.playhead[projectId] ?? 0);
  const setPlayhead = useAppStore((s) => s.setPlayhead);
  const [playing, setPlaying] = useState(false);

  const sim = run?.simulation;
  const last = (sim?.steps.length ?? 1) - 1;

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      setPlayhead(projectId, Math.min(last, minute + 1));
      if (minute + 1 >= last) setPlaying(false);
    }, 120);
    return () => window.clearInterval(t);
  }, [playing, minute, last, projectId, setPlayhead]);

  const data = useMemo(() => {
    if (!sim || !graph) return undefined;
    const computes = computeNodeIds(graph)
      .filter((id) => sim.steps[0]?.nodes[id])
      .slice(0, MAX_SERIES);
    const dbs = databaseNodeIds(graph)
      .filter((id) => sim.steps[0]?.nodes[id])
      .slice(0, MAX_SERIES);
    const name = (id: string) => graph.nodes[id]?.name ?? id;
    const perNode = (ids: string[], f: (id: string, s: StepMetrics) => number): Series[] =>
      ids.map((id, i) => ({
        id,
        label: name(id),
        color: COLORS[i] as string,
        values: pick(sim.steps, (s) => f(id, s)),
      }));
    return {
      requests: [
        { id: 'offered', label: '受信', color: COLORS[0], values: pick(sim.steps, (s) => s.offeredRps) },
        { id: 'success', label: '成功', color: COLORS[2], values: pick(sim.steps, (s) => s.successRps) },
      ] as Series[],
      errorRate: [
        { id: 'err', label: 'エラー率', color: COLORS[0], values: pick(sim.steps, (s) => s.errorRate) },
      ] as Series[],
      latency: [
        { id: 'lat', label: '応答時間', color: COLORS[0], values: pick(sim.steps, (s) => s.latencyMs) },
      ] as Series[],
      cpu: perNode(computes, (id, s) => Math.min(s.nodes[id]?.utilization ?? 0, 2)),
      instances: perNode(computes, (id, s) => s.nodes[id]?.instances ?? 0),
      dbConnections: perNode(dbs, (id, s) => s.nodes[id]?.connections ?? 0),
      dbMaxConnections:
        dbs.length === 1 ? (sim.steps[0]?.nodes[dbs[0] as string]?.maxConnections ?? 0) : undefined,
      dbLoad: perNode(dbs, (id, s) => s.nodes[id]?.utilization ?? 0),
      cost: [
        { id: 'cost', label: 'コスト', color: COLORS[0], values: pick(sim.steps, (s) => s.costPerHour) },
      ] as Series[],
      truncated: computeNodeIds(graph).length > MAX_SERIES || databaseNodeIds(graph).length > MAX_SERIES,
    };
  }, [sim, graph]);

  if (!graph) return null;
  if (!run || !sim || !data) {
    return (
      <div className="tab-content">
        <RunPrompt projectId={projectId} />
      </div>
    );
  }

  const objectives = missionId ? MISSIONS[missionId].objectives : undefined;
  const step = sim.steps[minute];
  const scrub = (m: number) => {
    setPlaying(false);
    setPlayhead(projectId, m);
  };
  const eventMinutes = sim.timeline.filter((e) => SCENARIO_EVENT_KINDS.has(e.kind)).map((e) => e.minute);
  const badges = badgesAt(sim, graph, minute);
  const nearby = sim.timeline.filter((e) => Math.abs(e.minute - minute) <= 5);

  return (
    <div className="tab-content monitor">
      <StaleNotice projectId={projectId} />
      <section className="playback" aria-label="再生コントロール">
        <div className="playback-row">
          <button
            type="button"
            className="tool-button"
            aria-label={playing ? '一時停止' : '再生'}
            onClick={() => {
              if (!playing && minute >= last) setPlayhead(projectId, 0);
              setPlaying(!playing);
            }}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={last}
            value={minute}
            aria-label="時刻"
            onChange={(e) => scrub(Number(e.target.value))}
          />
          <span className="playback-time">
            {minute}分 / {last}分
          </span>
        </div>
        {step && (
          <dl className="playback-stats">
            <div>
              <dt>受信</dt>
              <dd>{Math.round(step.offeredRps)} rps</dd>
            </div>
            <div>
              <dt>エラー率</dt>
              <dd className={step.errorRate > (objectives?.maxErrorRate ?? 1) ? 'text-bad' : undefined}>
                {percent(step.errorRate)}
              </dd>
            </div>
            <div>
              <dt>応答時間</dt>
              <dd>{ms(step.latencyMs)}</dd>
            </div>
            <div>
              <dt>コスト</dt>
              <dd>{step.costPerHour.toFixed(1)} cr/時</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="card monitor-graph">
        <GraphCanvas
          graph={graph}
          metrics={badges}
          onSelect={(id) =>
            id && navigate({ name: 'project', id: projectId, tab: 'architecture', focus: id })
          }
        />
        <p className="fine-print monitor-graph-caption">
          {minute}分時点の状態（サーバーは CPU 使用率・稼働台数。✓ 余裕あり / ⚠ 70%以上 / ⛔
          90%以上・過負荷・停止）。タップすると構成画面で開きます。
        </p>
      </section>

      <section className="card card-body">
        <h3>イベント（{minute}分 前後）</h3>
        {nearby.length === 0 ? (
          <p className="muted">この時間帯のイベントはありません。</p>
        ) : (
          <ul className="timeline-list">
            {nearby.map((e, i) => (
              <li key={i} className={SCENARIO_EVENT_KINDS.has(e.kind) ? 'is-scenario' : undefined}>
                <button type="button" onClick={() => scrub(e.minute)}>
                  <span className="timeline-minute">{e.minute}分</span>
                  <span>
                    {TIMELINE_TEXT_JA[e.kind]}
                    {e.nodeIds.length > 0 && (
                      <small>（{e.nodeIds.map((id) => nodeLabel(graph, id)).join('、')}）</small>
                    )}
                    {e.kind === 'scale_out' || e.kind === 'scale_in' ? (
                      <small>
                        {' '}
                        {String(e.params?.from)}→{String(e.params?.to)}台
                      </small>
                    ) : null}
                    {e.params?.az ? <small> {String(e.params.az)}</small> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <details>
          <summary>すべてのイベント（{sim.timeline.length}）</summary>
          <ul className="timeline-list">
            {sim.timeline.map((e, i) => (
              <li key={i}>
                <button type="button" onClick={() => scrub(e.minute)}>
                  <span className="timeline-minute">{e.minute}分</span>
                  <span>{TIMELINE_TEXT_JA[e.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <TimeSeriesChart
        title="リクエスト数（毎秒）"
        series={data.requests}
        format={(v) => `${Math.round(v)}`}
        minute={minute}
        onScrub={scrub}
        eventMinutes={eventMinutes}
      />
      <TimeSeriesChart
        title="エラー率"
        series={data.errorRate}
        format={(v) => percent(v)}
        minute={minute}
        onScrub={scrub}
        eventMinutes={eventMinutes}
        yMaxAtLeast={0.05}
        threshold={
          objectives
            ? { value: objectives.maxErrorRate, label: `目標 ${percent(objectives.maxErrorRate)}` }
            : undefined
        }
      />
      <TimeSeriesChart
        title="応答時間"
        series={data.latency}
        format={(v) => `${Math.round(v)}ms`}
        minute={minute}
        onScrub={scrub}
        eventMinutes={eventMinutes}
        threshold={
          objectives
            ? { value: objectives.maxP95LatencyMs, label: `目標(p95) ${objectives.maxP95LatencyMs}ms` }
            : undefined
        }
      />
      {data.cpu.length > 0 && (
        <TimeSeriesChart
          title="サーバーCPU使用率（処理能力に対する負荷）"
          series={data.cpu}
          format={(v) => (v >= 2 ? '200%以上' : `${Math.round(v * 100)}%`)}
          minute={minute}
          onScrub={scrub}
          eventMinutes={eventMinutes}
          yMaxAtLeast={1}
        />
      )}
      {data.instances.length > 0 && (
        <TimeSeriesChart
          title="稼働中のサーバー台数"
          series={data.instances}
          format={(v) => `${Math.round(v)}台`}
          minute={minute}
          onScrub={scrub}
          eventMinutes={eventMinutes}
          yMaxAtLeast={4}
        />
      )}
      {data.dbConnections.length > 0 && (
        <TimeSeriesChart
          title="データベース接続数"
          series={data.dbConnections}
          format={(v) => `${Math.round(v)}`}
          minute={minute}
          onScrub={scrub}
          eventMinutes={eventMinutes}
          threshold={
            data.dbMaxConnections
              ? { value: data.dbMaxConnections, label: `上限 ${data.dbMaxConnections}` }
              : undefined
          }
        />
      )}
      {data.dbLoad.length > 0 && (
        <TimeSeriesChart
          title="データベース負荷"
          series={data.dbLoad}
          format={(v) => `${Math.round(v * 100)}%`}
          minute={minute}
          onScrub={scrub}
          eventMinutes={eventMinutes}
          yMaxAtLeast={1}
        />
      )}
      <TimeSeriesChart
        title="コスト（毎時）"
        series={data.cost}
        format={(v) => `${v.toFixed(0)}cr`}
        minute={minute}
        onScrub={scrub}
        eventMinutes={eventMinutes}
      />
      {data.truncated && (
        <p className="fine-print">グラフには最初の{MAX_SERIES}つのリソースだけを表示しています。</p>
      )}
      <p className="fine-print">
        学習用の簡略モデルによる推定値です。月額見積もり: {credits(sim.cost.projectedMonthly)}
      </p>
    </div>
  );
}

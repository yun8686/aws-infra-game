import { baseRpsAt, scenarioApps, workloadRpsAt, type Scenario } from '../../sim';
import { APP_TEXT_JA } from '../../i18n';
import '../../shared/ui/charts/viz.css';

const APP_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'] as const;

const EVENT_LABEL: Record<NonNullable<Scenario['events']>[number]['kind'], string> = {
  instance_failure: 'サーバー障害',
  az_outage: 'AZ障害',
  db_failure: 'DB障害',
};

/** Disclosed scenario: expected traffic curve and scheduled failure events. */
export function WorkloadChart({ scenario }: { readonly scenario: Scenario }) {
  const W = 320;
  const H = 120;
  const pad = { l: 36, r: 8, t: 10, b: 22 };
  const minutes = Array.from({ length: scenario.durationMin + 1 }, (_, i) => i);
  const apps = scenarioApps(scenario);
  const multi = apps.length > 1;
  const peak = Math.max(
    ...minutes.map((m) =>
      multi ? Math.max(...apps.map((a) => workloadRpsAt(a.workload, m))) : baseRpsAt(scenario, m),
    ),
    1,
  );
  const x = (m: number) => pad.l + (m / scenario.durationMin) * (W - pad.l - pad.r);
  const y = (rps: number) => H - pad.b - (rps / peak) * (H - pad.t - pad.b);
  const pathOf = (rpsAt: (m: number) => number) =>
    minutes.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(m).toFixed(1)},${y(rpsAt(m)).toFixed(1)}`).join(' ');
  const events = scenario.events ?? [];

  return (
    <figure className="workload-chart viz-root">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`想定アクセス: 最大 ${Math.round(peak)} リクエスト毎秒`}
      >
        <line className="axis" x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} />
        <text className="axis-label" x={pad.l - 4} y={y(peak) + 4} textAnchor="end">
          {Math.round(peak)}
        </text>
        <text className="axis-label" x={pad.l - 4} y={H - pad.b} textAnchor="end">
          0
        </text>
        {[0, scenario.durationMin / 2, scenario.durationMin].map((m) => (
          <text
            key={m}
            className="axis-label"
            x={x(m)}
            y={H - 6}
            textAnchor={m === 0 ? 'start' : m === scenario.durationMin ? 'end' : 'middle'}
          >
            {m}分
          </text>
        ))}
        {multi ? (
          apps.map((a, i) => (
            <path
              key={a.appId}
              className="series"
              style={{ stroke: APP_COLORS[i] }}
              d={pathOf((m) => workloadRpsAt(a.workload, m))}
            />
          ))
        ) : (
          <path className="series" d={pathOf((m) => baseRpsAt(scenario, m))} />
        )}
        {events.map((e, i) => (
          <g key={i} className="event-marker">
            <line x1={x(e.atMin)} y1={pad.t} x2={x(e.atMin)} y2={H - pad.b} />
            <text x={x(e.atMin) + 3} y={pad.t + 9}>
              {EVENT_LABEL[e.kind]}
            </text>
          </g>
        ))}
      </svg>
      {multi && (
        <div className="chart-legend">
          {apps.map((a, i) => (
            <span key={a.appId}>
              <span className="line-key" style={{ background: APP_COLORS[i] }} />
              {APP_TEXT_JA[a.appId].name}（1件あたりの処理{' '}
              {a.cpuPerRequest === 1 ? '標準' : `約${a.cpuPerRequest}倍`}）
            </span>
          ))}
        </div>
      )}
      <figcaption>
        想定アクセス（リクエスト/秒）。
        {events.length > 0 && (
          <> 予告された障害: {events.map((e) => `${e.atMin}分 ${EVENT_LABEL[e.kind]}`).join('、')}</>
        )}
      </figcaption>
    </figure>
  );
}

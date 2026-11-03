import { useRef } from 'react';
import './viz.css';

export interface Series {
  readonly id: string;
  readonly label: string;
  readonly values: readonly number[];
  /** CSS color reference, e.g. var(--series-1). */
  readonly color: string;
}

export interface TimeSeriesChartProps {
  readonly title: string;
  readonly series: readonly Series[];
  readonly format: (v: number) => string;
  /** Selected minute index (the crosshair). */
  readonly minute: number;
  readonly onScrub: (minute: number) => void;
  readonly threshold?: { readonly value: number; readonly label: string } | undefined;
  /** Minutes of disclosed scenario events, drawn as muted ticks. */
  readonly eventMinutes?: readonly number[];
  readonly yMin?: number;
  /** Lower bound for the y-axis maximum (so near-zero series don't look dramatic). */
  readonly yMaxAtLeast?: number;
}

const W = 340;
const H = 132;
const PAD = { l: 40, r: 10, t: 8, b: 20 };

const niceMax = (v: number): number => {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
};

/**
 * Single-axis time-series chart with a shared crosshair (one per minute).
 * Drag horizontally or use arrow keys to scrub; values are read out above the plot.
 */
export function TimeSeriesChart({
  title,
  series,
  format,
  minute,
  onScrub,
  threshold,
  eventMinutes = [],
  yMin = 0,
  yMaxAtLeast = 0,
}: TimeSeriesChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const n = Math.max(1, ...series.map((s) => s.values.length));
  const dataMax = Math.max(yMaxAtLeast, threshold?.value ?? 0, ...series.flatMap((s) => s.values));
  const yMax = niceMax(dataMax * 1.05);
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => H - PAD.b - ((Math.min(v, yMax) - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const ticks = [0, yMax / 2, yMax];
  const clampMinute = (m: number) => Math.max(0, Math.min(n - 1, Math.round(m)));

  const scrubFromEvent = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * W;
    onScrub(clampMinute(((sx - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1)));
  };

  const path = (values: readonly number[]) =>
    values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  const at = clampMinute(minute);

  return (
    <figure className="chart-card viz-root">
      <h3>{title}</h3>
      <div className="chart-readout" aria-live="off">
        <span>{at}分</span>
        {series.map((s) => (
          <span key={s.id}>
            <strong>{format(s.values[at] ?? 0)}</strong>
            {series.length > 1 && (
              <>
                <span className="line-key" style={{ background: s.color }} />
                {s.label}
              </>
            )}
          </span>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        tabIndex={0}
        aria-label={`${title}（時刻を選択）`}
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={at}
        aria-valuetext={`${at}分: ${series.map((s) => `${s.label} ${format(s.values[at] ?? 0)}`).join('、')}`}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          scrubFromEvent(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0 || e.pointerType === 'mouse') scrubFromEvent(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onScrub(clampMinute(at + 1));
          else if (e.key === 'ArrowLeft') onScrub(clampMinute(at - 1));
          else if (e.key === 'Home') onScrub(0);
          else if (e.key === 'End') onScrub(n - 1);
          else return;
          e.preventDefault();
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'baseline' : 'grid'} x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="tick" x={PAD.l - 4} y={y(t) + 3} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {[0, Math.floor((n - 1) / 2), n - 1].map((m) => (
          <text key={m} className="tick" x={x(m)} y={H - 6} textAnchor="middle">
            {m}分
          </text>
        ))}
        {eventMinutes.map((m) => (
          <line key={m} className="event-tick" x1={x(m)} x2={x(m)} y1={PAD.t} y2={PAD.t + 8} />
        ))}
        {threshold && (
          <g>
            <line
              className="threshold"
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(threshold.value)}
              y2={y(threshold.value)}
            />
            <text className="threshold-label" x={W - PAD.r} y={y(threshold.value) - 3} textAnchor="end">
              {threshold.label}
            </text>
          </g>
        )}
        {series.map((s) => (
          <path key={s.id} className="series" d={path(s.values)} style={{ stroke: s.color }} />
        ))}
        <line className="crosshair" x1={x(at)} x2={x(at)} y1={PAD.t} y2={H - PAD.b} />
        {series.map((s) => (
          <circle
            key={s.id}
            className="dot"
            cx={x(at)}
            cy={y(s.values[at] ?? 0)}
            r={4}
            style={{ fill: s.color }}
          />
        ))}
      </svg>
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map((s) => (
            <span key={s.id}>
              <span className="line-key" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <details className="chart-table">
        <summary>数値の表（5分ごと）</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">時刻</th>
              {series.map((s) => (
                <th key={s.id} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.ceil(n / 5) }, (_, k) => k * 5).map((m) => (
              <tr key={m}>
                <td>{m}分</td>
                {series.map((s) => (
                  <td key={s.id}>{format(s.values[m] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

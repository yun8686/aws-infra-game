# Monitoring and Results UX (MVP)

Status: Phase 6; diagram overlay updated for the rebuild (ADR 0018). Code: `src/features/monitoring/`, `src/features/simulation-results/`, `src/shared/ui/charts/`.

## Monitor tab

- **Playback bar** (sticky): play/pause, time slider, and the headline values at the selected minute (offered rps, error rate, latency, cost/hour). Computation is instant; playback only moves the playhead (ADR 0008).
- **Diagram overlay**: the same AWS diagram as the editor, with its own drill-down, at the selected minute. EC2 shows CPU or 停止, Auto Scaling CPU and running instances, databases load, connection overload or "停止中", load balancers rps. Status is text + color (ok / ≥ 70% / ≥ 90%, overload or down) — never color alone. Tapping a resource opens it in the editor.
- **Timeline**: events within ±5 minutes of the playhead (scenario events in bold), plus the full list; tapping an event jumps to it.
- **Charts** (one y-axis each, small multiples): requests (offered vs successful), error rate (with objective), latency (with p95 objective), compute CPU and running instances (per compute node), database connections (with limit) and load, cost per hour. Up to three resources per chart.
- Every chart shares the playhead: drag horizontally or use arrow keys on a focused chart; the readout above the plot shows the values. Each chart has a 5-minute table view.
- When the diagram changes after a run, a stale notice offers to re-run.

## Results tab

- Pass/fail, overall score, and per dimension the score with actual vs target values.
- Key causes grouped per (cause, resource) with all failure windows and failed-request counts, explanation and remediation, plus **構成図で見る** (opens the resource in the editor) and **N分を見る** (jumps the monitor to that minute).
- Security findings and learning topics.

## Chart styling

Follows the data-viz method: categorical slots 1–3 of the reference palette validated for light and dark (all-pairs CVD ΔE ≥ 9.2); the light-mode aqua is below 3:1 contrast, so values are always read out as text and a table view exists. Lines 2 px, hairline solid gridlines, crosshair with surface-ringed dots, legend for ≥ 2 series, text in text tokens.

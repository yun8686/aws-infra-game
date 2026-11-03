import type { TimelineEventKind } from '../../../domain/simulation/types';

export const TIMELINE_TEXT_JA: { readonly [K in TimelineEventKind]: string } = {
  instance_failure: 'サーバー障害が発生',
  az_outage_start: 'AZ障害が発生',
  az_outage_end: 'AZ障害から復旧',
  db_failure: 'データベース障害が発生',
  failure_detected: 'Auto Scaling が故障を検知し入れ替え',
  instance_launched: 'サーバーを起動開始',
  instance_ready: 'サーバーが稼働開始',
  scale_out: 'スケールアウト',
  scale_in: 'スケールイン',
  db_unavailable: 'データベースが停止',
  db_failover: 'データベースがフェイルオーバー',
  db_recovered: 'データベースが復旧',
};

/** Events caused by the scenario (disclosed) vs reactions of the system. */
export const SCENARIO_EVENT_KINDS: ReadonlySet<TimelineEventKind> = new Set([
  'instance_failure',
  'az_outage_start',
  'az_outage_end',
  'db_failure',
]);

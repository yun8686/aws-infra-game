import type { AvailabilityZone } from '../catalog/services';
import type { NodeId } from '../graph/types';
import { BALANCE } from './balance';
import type { ScenarioEvent } from './scenario';
import {
  count,
  DB_TIMINGS,
  failInstance,
  isAzDown,
  reconcile,
  type DbState,
  type GroupState,
  type Instance,
  type SimState,
} from './state';
import type { TimelineEvent } from './types';

const log = (
  s: SimState,
  nowSec: number,
  kind: TimelineEvent['kind'],
  nodeIds: NodeId[],
  params?: Record<string, string | number>,
) => s.timeline.push({ minute: nowSec / 60, kind, nodeIds, ...(params ? { params } : {}) });

const dbFail = (s: SimState, d: DbState, nowSec: number, downSec: number, failover: boolean) => {
  d.unavailableUntilSec = Math.max(d.unavailableUntilSec, nowSec + downSec);
  log(s, nowSec, failover ? 'db_failover' : 'db_unavailable', [d.model.id], {
    untilMinute: d.unavailableUntilSec / 60,
  });
};

/** Promote the standby (Multi-AZ) or go down (single-AZ) when the primary is lost. */
const loseDbPrimary = (s: SimState, d: DbState, nowSec: number, cause: 'instance' | AvailabilityZone) => {
  if (d.model.multiAz) {
    const standby = d.model.azs.find((az) => az !== d.primaryAz && !isAzDown(s, az, nowSec));
    if (standby) {
      d.primaryAz = standby;
      dbFail(s, d, nowSec, DB_TIMINGS.multiAzFailoverSec, true);
      return;
    }
  }
  if (cause === 'instance') dbFail(s, d, nowSec, DB_TIMINGS.singleAzRecoverySec, false);
  else {
    const outageEnd = s.outages.get(cause) ?? nowSec;
    dbFail(s, d, nowSec, outageEnd - nowSec + DB_TIMINGS.singleAzAfterOutageSec, false);
  }
};

/** Apply disclosed scenario events scheduled for this step. */
export const applyEvents = (
  s: SimState,
  events: readonly ScenarioEvent[],
  minute: number,
  nowSec: number,
  rand: () => number,
): void => {
  for (const ev of events) {
    if (ev.atMin !== minute) continue;
    switch (ev.kind) {
      case 'instance_failure': {
        for (let k = 0; k < ev.count; k++) {
          const pool: { g: GroupState; inst: Instance }[] = [];
          for (const g of s.groups.values()) {
            if (ev.nodeId && g.model.id !== ev.nodeId) continue;
            for (const inst of g.instances) if (inst.state === 'running') pool.push({ g, inst });
          }
          if (pool.length === 0) break;
          const pick = pool[Math.floor(rand() * pool.length)] as { g: GroupState; inst: Instance };
          failInstance(pick.inst, nowSec, false);
          log(s, nowSec, 'instance_failure', [pick.g.model.id], { az: pick.inst.az });
        }
        break;
      }
      case 'az_outage': {
        s.outages.set(ev.az, nowSec + ev.durationMin * 60);
        log(s, nowSec, 'az_outage_start', [], { az: ev.az, durationMin: ev.durationMin });
        for (const g of s.groups.values()) {
          for (const inst of g.instances) {
            if (inst.az !== ev.az || inst.state === 'failed') continue;
            if (inst.state === 'pending') g.instances = g.instances.filter((i) => i !== inst);
            else failInstance(inst, nowSec, true);
          }
        }
        for (const d of s.dbs.values()) if (d.primaryAz === ev.az) loseDbPrimary(s, d, nowSec, ev.az);
        break;
      }
      case 'db_failure': {
        for (const d of s.dbs.values()) {
          if (ev.nodeId && d.model.id !== ev.nodeId) continue;
          log(s, nowSec, 'db_failure', [d.model.id]);
          loseDbPrimary(s, d, nowSec, 'instance');
        }
        break;
      }
    }
  }
};

/** Outage ends, instances becoming ready, DB recovery and Auto Scaling replacement — before traffic. */
export const advanceLifecycle = (s: SimState, nowSec: number): void => {
  for (const [az, end] of [...s.outages]) {
    if (end > nowSec) continue;
    s.outages.delete(az);
    log(s, nowSec, 'az_outage_end', [], { az });
    for (const g of s.groups.values()) {
      if (g.model.autoScaling) continue;
      for (const inst of g.instances) {
        if (inst.state === 'failed' && inst.failedByOutage && inst.az === az) {
          inst.state = 'pending';
          inst.readyAtSec = nowSec + BALANCE.instanceBootSec;
          inst.failedByOutage = false;
        }
      }
    }
  }

  for (const d of s.dbs.values()) {
    if (d.unavailableUntilSec > 0 && d.unavailableUntilSec <= nowSec && d.unavailableUntilSec > nowSec - 60) {
      log(s, nowSec, 'db_recovered', [d.model.id]);
    }
  }

  for (const g of s.groups.values()) {
    let ready = 0;
    for (const inst of g.instances) {
      if (inst.state === 'pending' && inst.readyAtSec <= nowSec) {
        inst.state = 'running';
        ready++;
      }
    }
    if (ready > 0) log(s, nowSec, 'instance_ready', [g.model.id], { count: ready });

    if (g.model.autoScaling) {
      const replaced = g.instances.filter(
        (i) => i.state === 'failed' && nowSec - i.failedAtSec >= BALANCE.asgReplaceAfterSec,
      );
      if (replaced.length > 0) {
        g.instances = g.instances.filter((i) => !replaced.includes(i));
        log(s, nowSec, 'failure_detected', [g.model.id], { count: replaced.length });
      }
      const { launched } = reconcile(s, g, nowSec);
      if (launched > 0) log(s, nowSec, 'instance_launched', [g.model.id], { count: launched });
    }
  }
};

/** Target-tracking scaling decision after the step's load is known. */
export const autoScale = (s: SimState, g: GroupState, arrivalsRps: number, nowSec: number): void => {
  const policy = g.model.autoScaling;
  if (!policy) return;
  const proposed = Math.min(
    policy.max,
    Math.max(policy.min, Math.ceil(arrivalsRps / (g.model.capacityPerInstance * policy.targetUtilization))),
  );
  if (proposed > g.desired && nowSec - g.lastScaleOutSec >= BALANCE.scaleOutCooldownSec) {
    log(s, nowSec, 'scale_out', [g.model.id], { from: g.desired, to: proposed });
    g.desired = proposed;
    g.lastScaleOutSec = nowSec;
    g.lastScaleSec = nowSec;
  } else if (proposed < g.desired && nowSec - g.lastScaleSec >= BALANCE.scaleInCooldownSec) {
    log(s, nowSec, 'scale_in', [g.model.id], { from: g.desired, to: proposed });
    g.desired = proposed;
    g.lastScaleSec = nowSec;
  } else {
    return;
  }
  const { launched } = reconcile(s, g, nowSec);
  if (launched > 0) log(s, nowSec, 'instance_launched', [g.model.id], { count: launched });
};

export { count };

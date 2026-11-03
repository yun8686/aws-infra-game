import type { AppId } from '../catalog/apps';
import type { AvailabilityZone } from '../catalog/services';
import type { NodeId } from '../graph/types';
import { BALANCE } from './balance';
import type { ComputeModel, DbModel, ExecutionModel } from './compile';
import type { TimelineEvent } from './types';

export interface Instance {
  readonly id: number;
  readonly az: AvailabilityZone;
  state: 'pending' | 'running' | 'failed';
  readyAtSec: number;
  failedAtSec: number;
  /** Failed because its AZ is down (fixed instances restart when the AZ returns). */
  failedByOutage: boolean;
}

export interface GroupState {
  readonly model: ComputeModel;
  instances: Instance[];
  nextInstanceId: number;
  desired: number;
  lastScaleOutSec: number;
  lastScaleSec: number;
  /** Waiting requests per application. */
  backlog: Map<AppId, number>;
}

export interface DbState {
  readonly model: DbModel;
  primaryAz: AvailabilityZone | undefined;
  unavailableUntilSec: number;
}

export interface SimState {
  readonly groups: Map<NodeId, GroupState>;
  readonly dbs: Map<NodeId, DbState>;
  /** AZ → end of outage (seconds). */
  readonly outages: Map<AvailabilityZone, number>;
  readonly timeline: TimelineEvent[];
}

export const createState = (model: ExecutionModel): SimState => {
  const groups = new Map<NodeId, GroupState>();
  for (const m of model.computes.values()) {
    const instances: Instance[] = [];
    for (let i = 0; i < m.initialInstances && m.azs.length > 0; i++) {
      instances.push({
        id: i + 1,
        az: m.azs[i % m.azs.length] as AvailabilityZone,
        state: 'running',
        readyAtSec: 0,
        failedAtSec: -1,
        failedByOutage: false,
      });
    }
    groups.set(m.id, {
      model: m,
      instances,
      nextInstanceId: instances.length + 1,
      desired: m.autoScaling?.desired ?? m.initialInstances,
      lastScaleOutSec: -Infinity,
      lastScaleSec: -Infinity,
      backlog: new Map(),
    });
  }
  const dbs = new Map<NodeId, DbState>();
  for (const m of model.dbs.values())
    dbs.set(m.id, { model: m, primaryAz: m.azs[0], unavailableUntilSec: -1 });
  return { groups, dbs, outages: new Map(), timeline: [] };
};

export const count = (g: GroupState, state: Instance['state']): number =>
  g.instances.filter((i) => i.state === state).length;

export const isAzDown = (s: SimState, az: AvailabilityZone, nowSec: number): boolean =>
  (s.outages.get(az) ?? -1) > nowSec;

/** Auto Scaling: launch into the healthy AZ with the fewest active instances. */
export const launchInstance = (s: SimState, g: GroupState, nowSec: number): boolean => {
  const policy = g.model.autoScaling;
  if (!policy) return false;
  const candidates = g.model.azs.filter((az) => !isAzDown(s, az, nowSec));
  if (candidates.length === 0) return false;
  const active = (az: AvailabilityZone) =>
    g.instances.filter((i) => i.az === az && i.state !== 'failed').length;
  const az = [...candidates].sort((a, b) => active(a) - active(b))[0] as AvailabilityZone;
  g.instances.push({
    id: g.nextInstanceId++,
    az,
    state: 'pending',
    readyAtSec: nowSec + policy.launchSec,
    failedAtSec: -1,
    failedByOutage: false,
  });
  return true;
};

/**
 * Bring the group's instance count to `desired`. Failed instances count until Auto Scaling has
 * detected and removed them (see advanceLifecycle), so replacement only starts after detection.
 */
export const reconcile = (
  s: SimState,
  g: GroupState,
  nowSec: number,
): { launched: number; terminated: number } => {
  if (!g.model.autoScaling) return { launched: 0, terminated: 0 };
  let launched = 0;
  let terminated = 0;
  const active = () => g.instances.length;
  while (active() < g.desired && launchInstance(s, g, nowSec)) launched++;
  while (active() > g.desired) {
    // Terminate unhealthy instances first, then the newest pending, then the newest running.
    const victim =
      g.instances.find((i) => i.state === 'failed') ??
      [...g.instances].reverse().find((i) => i.state === 'pending') ??
      [...g.instances].reverse().find((i) => i.state === 'running');
    if (!victim) break;
    g.instances = g.instances.filter((i) => i !== victim);
    terminated++;
  }
  return { launched, terminated };
};

export const failInstance = (inst: Instance, nowSec: number, byOutage: boolean): void => {
  inst.state = 'failed';
  inst.failedAtSec = nowSec;
  inst.failedByOutage = byOutage;
};

export const dbIsAvailable = (d: DbState, nowSec: number): boolean => d.unavailableUntilSec <= nowSec;

export const DB_TIMINGS = BALANCE.dbFailover;

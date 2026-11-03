import {
  getResource,
  isTrafficAllowed,
  linksFrom,
  listResources,
  resourcesOfType,
  usersOf,
  zonesOf,
  subnetIdsOf,
  zoneOfSubnet,
  type AppId,
  type Diagram,
  type Zone as AvailabilityZone,
} from '../model';
import { BALANCE } from './balance';
import type { ConnectionId, NodeId } from './ids';

export interface DbLink {
  readonly connectionId: ConnectionId;
  readonly dbId: NodeId;
  readonly poolSize: number;
  readonly allowed: boolean;
}

export interface AutoScalingPolicy {
  readonly min: number;
  readonly max: number;
  readonly desired: number;
  readonly targetUtilization: number;
  readonly launchSec: number;
}

export interface ComputeModel {
  readonly id: NodeId;
  readonly kind: 'fixed' | 'autoscaling';
  readonly azs: readonly AvailabilityZone[];
  readonly initialInstances: number;
  readonly capacityPerInstance: number;
  readonly costPerInstanceHour: number;
  readonly autoScaling?: AutoScalingPolicy;
  readonly dbLinks: readonly DbLink[];
  /** Applications running on this compute resource (ADR 0016). */
  readonly apps: readonly AppId[];
}

export interface DbModel {
  readonly id: NodeId;
  readonly capacityQps: number;
  readonly maxConnections: number;
  readonly multiAz: boolean;
  /** Zone of the primary first, then the standby's (Multi-AZ). */
  readonly azs: readonly AvailabilityZone[];
}

export interface Route {
  readonly connectionId: ConnectionId;
  readonly targetId: NodeId;
  readonly allowed: boolean;
}

export interface AlbModel {
  readonly id: NodeId;
  /** Time for health checks to stop routing to a failed instance. */
  readonly detectionSec: number;
  readonly targets: readonly Route[];
}

/** Diagram compiled into the static structures the step loop needs. All collections are id-sorted. */
export interface ExecutionModel {
  readonly entryRoutes: readonly Route[];
  readonly albs: ReadonlyMap<NodeId, AlbModel>;
  readonly computes: ReadonlyMap<NodeId, ComputeModel>;
  readonly dbs: ReadonlyMap<NodeId, DbModel>;
  readonly billableNodeIds: readonly NodeId[];
}

const routesFrom = (d: Diagram, id: NodeId): Route[] =>
  linksFrom(d, id, 'traffic').map((l) => ({
    connectionId: l.id,
    targetId: l.to,
    allowed: isTrafficAllowed(d, l.from, l.to),
  }));

export const compileDiagram = (d: Diagram): ExecutionModel => {
  const users = usersOf(d);
  const entryRoutes = users ? routesFrom(d, users.id) : [];

  const albs = new Map<NodeId, AlbModel>();
  for (const alb of resourcesOfType(d, 'alb')) {
    const hc = alb.config.healthCheck;
    albs.set(alb.id, {
      id: alb.id,
      detectionSec: hc.intervalSec * hc.unhealthyThreshold,
      targets: routesFrom(d, alb.id),
    });
  }

  const computes = new Map<NodeId, ComputeModel>();
  for (const r of resourcesOfType(d, 'ec2', 'asg')) {
    const dbLinks = linksFrom(d, r.id, 'data')
      .filter((l) => getResource(d, l.to, 'rds'))
      .map((l) => ({
        connectionId: l.id,
        dbId: l.to,
        poolSize: l.kind === 'data' ? l.config.poolSize : 10,
        allowed: isTrafficAllowed(d, r.id, l.to),
      }));
    const inst = BALANCE.instance[r.config.size];
    const base = {
      id: r.id,
      azs: zonesOf(d, r),
      capacityPerInstance: inst.capacityRps,
      costPerInstanceHour: inst.costPerHour,
      dbLinks,
      apps: r.config.apps,
    };
    if (r.type === 'ec2') {
      computes.set(r.id, { ...base, kind: 'fixed', initialInstances: 1 });
    } else {
      const c = r.config;
      computes.set(r.id, {
        ...base,
        kind: 'autoscaling',
        initialInstances: c.desired,
        autoScaling: {
          min: c.min,
          max: c.max,
          desired: c.desired,
          targetUtilization: c.targetCpuPct / 100,
          launchSec: Math.max(BALANCE.minLaunchSec, c.warmupSec),
        },
      });
    }
  }

  const dbs = new Map<NodeId, DbModel>();
  for (const db of resourcesOfType(d, 'rds')) {
    const cls = BALANCE.database[db.config.instanceClass];
    const mult = db.config.storageTier === 'provisioned' ? BALANCE.provisionedStorage.capacityMultiplier : 1;
    dbs.set(db.id, {
      id: db.id,
      capacityQps: cls.capacityQps * mult,
      maxConnections: cls.maxConnections,
      multiAz: db.config.multiAz,
      // Primary first (its own subnet), then the Multi-AZ standby.
      azs: [...new Set(subnetIdsOf(d, db).map((s) => zoneOfSubnet(d, s)))].filter(
        (z): z is AvailabilityZone => z !== undefined,
      ),
    });
  }

  return { entryRoutes, albs, computes, dbs, billableNodeIds: listResources(d).map((r) => r.id) };
};

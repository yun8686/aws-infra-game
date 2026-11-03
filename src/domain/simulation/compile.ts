import { readConfig } from '../catalog/catalog';
import type { AvailabilityZone } from '../catalog/services';
import { listNodes, nodesOfType, outgoing } from '../graph/graph';
import { azsOf, isTrafficAllowed } from '../graph/network';
import type { ConnectionId, InfrastructureGraph, NodeId } from '../graph/types';
import { BALANCE } from './balance';

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
}

export interface DbModel {
  readonly id: NodeId;
  readonly capacityQps: number;
  readonly maxConnections: number;
  readonly multiAz: boolean;
  /** Sorted AZs of its subnets; the first is the initial primary. */
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

/** Graph compiled into the minimal static structures the step loop needs. All collections are id-sorted. */
export interface ExecutionModel {
  readonly entryRoutes: readonly Route[];
  readonly albs: ReadonlyMap<NodeId, AlbModel>;
  readonly computes: ReadonlyMap<NodeId, ComputeModel>;
  readonly dbs: ReadonlyMap<NodeId, DbModel>;
  readonly billableNodeIds: readonly NodeId[];
}

const routesFrom = (graph: InfrastructureGraph, id: NodeId): Route[] =>
  outgoing(graph, id, 'routes_to').map((c) => ({
    connectionId: c.id,
    targetId: c.targetNodeId,
    allowed: isTrafficAllowed(graph, c.sourceNodeId, c.targetNodeId),
  }));

export const compileGraph = (graph: InfrastructureGraph): ExecutionModel => {
  const internet = nodesOfType(graph, 'external.internet')[0];
  const entryRoutes = internet ? routesFrom(graph, internet.id) : [];

  const albs = new Map<NodeId, AlbModel>();
  for (const alb of nodesOfType(graph, 'lb.alb')) {
    const cfg = readConfig(alb, 'lb.alb');
    albs.set(alb.id, {
      id: alb.id,
      detectionSec: cfg ? cfg.healthCheck.intervalSec * cfg.healthCheck.unhealthyThreshold : 90,
      targets: routesFrom(graph, alb.id),
    });
  }

  const computes = new Map<NodeId, ComputeModel>();
  for (const node of nodesOfType(graph, 'compute.ec2', 'compute.autoscaling')) {
    const fixed = readConfig(node, 'compute.ec2');
    const asg = readConfig(node, 'compute.autoscaling');
    const size = fixed?.instanceSize ?? asg?.instanceSize;
    if (!size) continue;
    const dbLinks = outgoing(graph, node.id, 'data_access')
      .filter((c) => graph.nodes[c.targetNodeId]?.serviceType === 'database.rds')
      .map((c) => ({
        connectionId: c.id,
        dbId: c.targetNodeId,
        poolSize: (c.config as { poolSize?: number } | undefined)?.poolSize ?? 10,
        allowed: isTrafficAllowed(graph, node.id, c.targetNodeId),
      }));
    computes.set(node.id, {
      id: node.id,
      kind: fixed ? 'fixed' : 'autoscaling',
      azs: azsOf(graph, node.id),
      initialInstances: fixed?.instanceCount ?? asg?.desiredCapacity ?? 0,
      capacityPerInstance: BALANCE.instance[size].capacityRps,
      costPerInstanceHour: BALANCE.instance[size].costPerHour,
      ...(asg
        ? {
            autoScaling: {
              min: asg.minCapacity,
              max: asg.maxCapacity,
              desired: asg.desiredCapacity,
              targetUtilization: asg.targetCpuPct / 100,
              launchSec: Math.max(BALANCE.minLaunchSec, asg.warmupSec),
            },
          }
        : {}),
      dbLinks,
    });
  }

  const dbs = new Map<NodeId, DbModel>();
  for (const node of nodesOfType(graph, 'database.rds')) {
    const cfg = readConfig(node, 'database.rds');
    if (!cfg) continue;
    const cls = BALANCE.database[cfg.instanceClass];
    const mult = cfg.storageTier === 'provisioned' ? BALANCE.provisionedStorage.capacityMultiplier : 1;
    dbs.set(node.id, {
      id: node.id,
      capacityQps: cls.capacityQps * mult,
      maxConnections: cls.maxConnections,
      multiAz: cfg.multiAz,
      azs: azsOf(graph, node.id),
    });
  }

  return { entryRoutes, albs, computes, dbs, billableNodeIds: listNodes(graph).map((n) => n.id) };
};

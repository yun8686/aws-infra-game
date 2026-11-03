import { readConfig } from '../catalog/catalog';
import type { InfraNode } from '../graph/types';
import { BALANCE } from './balance';

/** Cost per hour of a node given its current running instance count (for compute groups). */
export const nodeCostPerHour = (node: InfraNode, runningInstances?: number): number => {
  switch (node.serviceType) {
    case 'lb.alb':
      return BALANCE.alb.costPerHour;
    case 'compute.ec2': {
      const cfg = readConfig(node, 'compute.ec2');
      if (!cfg) return 0;
      return BALANCE.instance[cfg.instanceSize].costPerHour * (runningInstances ?? cfg.instanceCount);
    }
    case 'compute.autoscaling': {
      const cfg = readConfig(node, 'compute.autoscaling');
      if (!cfg) return 0;
      return BALANCE.instance[cfg.instanceSize].costPerHour * (runningInstances ?? cfg.desiredCapacity);
    }
    case 'database.rds': {
      const cfg = readConfig(node, 'database.rds');
      if (!cfg) return 0;
      let cost: number = BALANCE.database[cfg.instanceClass].costPerHour;
      if (cfg.storageTier === 'provisioned') cost *= BALANCE.provisionedStorage.costMultiplier;
      if (cfg.multiAz) cost *= BALANCE.multiAzCostMultiplier;
      return cost;
    }
    case 'monitoring.cloudwatch': {
      const cfg = readConfig(node, 'monitoring.cloudwatch');
      return BALANCE.cloudWatch.costPerHour + BALANCE.cloudWatch.costPerAlarmHour * (cfg?.alarms.length ?? 0);
    }
    default:
      return 0;
  }
};

/**
 * Steady-state monthly cost estimate of a graph without running a simulation
 * (fixed groups at their count, Auto Scaling at desired capacity).
 */
export const estimateMonthlyCost = (graph: { readonly nodes: Readonly<Record<string, InfraNode>> }): number =>
  Object.values(graph.nodes).reduce((sum, n) => sum + nodeCostPerHour(n), 0) * BALANCE.hoursPerMonth;

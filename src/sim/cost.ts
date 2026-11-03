import { listResources, type Diagram, type Resource } from '../model';
import { BALANCE } from './balance';

/** Cost per hour of a resource given its current instance count (compute groups). */
export const resourceCostPerHour = (r: Resource, instances?: number): number => {
  switch (r.type) {
    case 'alb':
      return BALANCE.alb.costPerHour;
    case 'ec2':
      return BALANCE.instance[r.config.size].costPerHour * (instances ?? 1);
    case 'asg':
      return BALANCE.instance[r.config.size].costPerHour * (instances ?? r.config.desired);
    case 'rds': {
      let cost: number = BALANCE.database[r.config.instanceClass].costPerHour;
      if (r.config.storageTier === 'provisioned') cost *= BALANCE.provisionedStorage.costMultiplier;
      if (r.config.multiAz) cost *= BALANCE.multiAzCostMultiplier;
      return cost;
    }
    case 'cloudwatch':
      return BALANCE.cloudWatch.costPerHour + BALANCE.cloudWatch.costPerAlarmHour * r.config.alarms.length;
    default:
      return 0;
  }
};

/** Steady-state monthly estimate without running a simulation (Auto Scaling at desired capacity). */
export const estimateMonthlyCost = (d: Diagram): number =>
  listResources(d).reduce((sum, r) => sum + resourceCostPerHour(r), 0) * BALANCE.hoursPerMonth;

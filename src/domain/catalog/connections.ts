import { z } from 'zod';
import type { ConnectionTypeId } from './ids';
import type { ConnectionTypeDefinition } from './types';

export const dataAccessConfigSchema = z.object({ poolSize: z.int().min(1).max(100) });
export type DataAccessConfig = z.infer<typeof dataAccessConfigSchema>;

const noConfig = z.object({});

export const CONNECTION_DEFINITIONS: { readonly [K in ConnectionTypeId]: ConnectionTypeDefinition } = {
  placed_in: {
    type: 'placed_in',
    semantic: 'structural',
    configSchema: noConfig,
    defaultConfig: {},
    allowed: [
      { from: ['network.subnet', 'network.security_group'], to: ['network.vpc'] },
      { from: ['lb.alb', 'compute.ec2', 'compute.autoscaling', 'database.rds'], to: ['network.subnet'] },
    ],
  },
  routes_to: {
    type: 'routes_to',
    semantic: 'traffic',
    configSchema: noConfig,
    defaultConfig: {},
    allowed: [
      { from: ['external.internet'], to: ['lb.alb', 'compute.ec2'] },
      { from: ['lb.alb'], to: ['compute.ec2', 'compute.autoscaling'] },
    ],
  },
  data_access: {
    type: 'data_access',
    semantic: 'data',
    configSchema: dataAccessConfigSchema,
    defaultConfig: { poolSize: 10 },
    allowed: [{ from: ['compute.ec2', 'compute.autoscaling'], to: ['database.rds'] }],
  },
  secured_by: {
    type: 'secured_by',
    semantic: 'security',
    configSchema: noConfig,
    defaultConfig: {},
    allowed: [
      {
        from: ['lb.alb', 'compute.ec2', 'compute.autoscaling', 'database.rds'],
        to: ['network.security_group'],
      },
    ],
    maxOutgoingPerSource: 5,
  },
  monitors: {
    type: 'monitors',
    semantic: 'observability',
    configSchema: noConfig,
    defaultConfig: {},
    allowed: [
      {
        from: ['monitoring.cloudwatch'],
        to: ['lb.alb', 'compute.ec2', 'compute.autoscaling', 'database.rds'],
      },
    ],
  },
};

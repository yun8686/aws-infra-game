import { z } from 'zod';
import { APP_IDS, DEFAULT_APP } from './apps';
import { PORTS, type ServiceTypeId } from './ids';
import type { ServiceDefinition } from './types';

const appsSchema = z
  .array(z.enum(APP_IDS))
  .min(1)
  .max(APP_IDS.length)
  .refine((a) => new Set(a).size === a.length, 'duplicate_app')
  .default([DEFAULT_APP]);

const cidr = z.string().regex(/^(\d{1,3})(\.\d{1,3}){3}\/(\d|[12]\d|3[0-2])$/, 'invalid_cidr');

export const AZS = ['az-a', 'az-b', 'az-c'] as const;
export type AvailabilityZone = (typeof AZS)[number];
export const INSTANCE_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export const DB_INSTANCE_CLASSES = ['db.small', 'db.medium', 'db.large', 'db.xlarge'] as const;

// ---- Config schemas ---------------------------------------------------------

export const internetConfigSchema = z.object({});
export const vpcConfigSchema = z.object({ cidr });
export const subnetConfigSchema = z.object({
  tier: z.enum(['public', 'private']),
  az: z.enum(AZS),
  cidr,
});

export const sgSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('anywhere') }),
  z.object({ kind: z.literal('vpc') }),
  z.object({ kind: z.literal('security_group'), nodeId: z.string().min(1) }),
]);
export const sgRuleSchema = z.object({
  port: z.union([z.int().min(1).max(65535), z.literal('all')]),
  source: sgSourceSchema,
});
export const securityGroupConfigSchema = z.object({ inboundRules: z.array(sgRuleSchema).max(20) });

export const albConfigSchema = z.object({
  scheme: z.enum(['internet-facing', 'internal']),
  listener: z.enum(['http', 'https']),
  healthCheck: z.object({
    intervalSec: z.int().min(5).max(300),
    unhealthyThreshold: z.int().min(2).max(10),
  }),
});

/** One EC2 instance (ADR 0015): a size, one subnet. More servers = more EC2 nodes or Auto Scaling. */
export const ec2ConfigSchema = z.object({
  instanceSize: z.enum(INSTANCE_SIZES),
  /** Applications running on this server (ADR 0016). Older configs default to the shop. */
  apps: appsSchema,
});

export const autoScalingConfigSchema = z
  .object({
    instanceSize: z.enum(INSTANCE_SIZES),
    minCapacity: z.int().min(1).max(50),
    desiredCapacity: z.int().min(1).max(50),
    maxCapacity: z.int().min(1).max(50),
    targetCpuPct: z.int().min(10).max(90),
    warmupSec: z.int().min(0).max(900),
    apps: appsSchema,
  })
  .refine((c) => c.minCapacity <= c.desiredCapacity && c.desiredCapacity <= c.maxCapacity, {
    message: 'capacity_order',
    path: ['desiredCapacity'],
  });

export const rdsConfigSchema = z.object({
  instanceClass: z.enum(DB_INSTANCE_CLASSES),
  storageTier: z.enum(['standard', 'provisioned']),
  multiAz: z.boolean(),
});

export const cloudWatchConfigSchema = z.object({
  alarms: z
    .array(
      z.object({
        metric: z.enum(['cpu', 'errorRate', 'latency', 'dbConnections']),
        threshold: z.number().min(0),
      }),
    )
    .max(20),
});

export type SubnetConfig = z.infer<typeof subnetConfigSchema>;
export type SecurityGroupConfig = z.infer<typeof securityGroupConfigSchema>;
export type SecurityGroupRule = z.infer<typeof sgRuleSchema>;
export type AlbConfig = z.infer<typeof albConfigSchema>;
export type Ec2Config = z.infer<typeof ec2ConfigSchema>;
export type AutoScalingConfig = z.infer<typeof autoScalingConfigSchema>;
export type RdsConfig = z.infer<typeof rdsConfigSchema>;
export type CloudWatchConfig = z.infer<typeof cloudWatchConfigSchema>;

export interface ServiceConfigMap {
  'external.internet': z.infer<typeof internetConfigSchema>;
  'network.vpc': z.infer<typeof vpcConfigSchema>;
  'network.subnet': SubnetConfig;
  'network.security_group': SecurityGroupConfig;
  'lb.alb': AlbConfig;
  'compute.ec2': Ec2Config;
  'compute.autoscaling': AutoScalingConfig;
  'database.rds': RdsConfig;
  'monitoring.cloudwatch': CloudWatchConfig;
}

// ---- Definitions ------------------------------------------------------------

type ServiceDefinitions = { readonly [K in ServiceTypeId]: ServiceDefinition<ServiceConfigMap[K]> };

export const SERVICE_DEFINITIONS: ServiceDefinitions = {
  'external.internet': {
    type: 'external.internet',
    category: 'external',
    idPrefix: 'internet',
    iconKey: 'internet',
    configSchema: internetConfigSchema,
    defaultConfig: {},
    systemManaged: true,
    maxPerGraph: 1,
    simModel: 'entry',
    costModel: 'free',
  },
  'network.vpc': {
    type: 'network.vpc',
    category: 'networking',
    idPrefix: 'vpc',
    iconKey: 'vpc',
    configSchema: vpcConfigSchema,
    defaultConfig: { cidr: '10.0.0.0/16' },
    simModel: 'none',
    costModel: 'free',
  },
  'network.subnet': {
    type: 'network.subnet',
    category: 'networking',
    idPrefix: 'subnet',
    iconKey: 'subnet',
    configSchema: subnetConfigSchema,
    defaultConfig: { tier: 'private', az: 'az-a', cidr: '10.0.1.0/24' },
    placement: { targets: ['network.vpc'], min: 1, max: 1 },
    simModel: 'none',
    costModel: 'free',
  },
  'network.security_group': {
    type: 'network.security_group',
    category: 'networking',
    idPrefix: 'sg',
    iconKey: 'security_group',
    configSchema: securityGroupConfigSchema,
    defaultConfig: { inboundRules: [] },
    placement: { targets: ['network.vpc'], min: 1, max: 1 },
    simModel: 'none',
    costModel: 'free',
  },
  'lb.alb': {
    type: 'lb.alb',
    category: 'load_balancing',
    idPrefix: 'alb',
    iconKey: 'load_balancer',
    configSchema: albConfigSchema,
    defaultConfig: {
      scheme: 'internet-facing',
      listener: 'http',
      healthCheck: { intervalSec: 30, unhealthyThreshold: 3 },
    },
    placement: { targets: ['network.subnet'], min: 1, max: 3 },
    simModel: 'loadBalancer',
    costModel: 'perHour',
    inboundPort: (c) => (c.listener === 'https' ? PORTS.https : PORTS.http),
  },
  'compute.ec2': {
    type: 'compute.ec2',
    category: 'compute',
    idPrefix: 'ec2',
    iconKey: 'server',
    configSchema: ec2ConfigSchema,
    defaultConfig: { instanceSize: 'small', apps: ['shop'] },
    // A single instance lives in exactly one subnet.
    placement: { targets: ['network.subnet'], min: 1, max: 1 },
    simModel: 'computeFixed',
    costModel: 'perInstanceHour',
    inboundPort: () => PORTS.app,
  },
  'compute.autoscaling': {
    type: 'compute.autoscaling',
    category: 'compute',
    idPrefix: 'asg',
    iconKey: 'autoscaling',
    configSchema: autoScalingConfigSchema,
    defaultConfig: {
      instanceSize: 'small',
      minCapacity: 2,
      desiredCapacity: 2,
      maxCapacity: 6,
      targetCpuPct: 60,
      warmupSec: 180,
      apps: ['shop'],
    },
    placement: { targets: ['network.subnet'], min: 1, max: 3 },
    simModel: 'computeAutoScaling',
    costModel: 'perInstanceHour',
    inboundPort: () => PORTS.app,
  },
  'database.rds': {
    type: 'database.rds',
    category: 'database',
    idPrefix: 'rds',
    iconKey: 'database',
    configSchema: rdsConfigSchema,
    defaultConfig: { instanceClass: 'db.small', storageTier: 'standard', multiAz: false },
    placement: { targets: ['network.subnet'], min: 1, max: 3 },
    simModel: 'database',
    costModel: 'perHour',
    inboundPort: () => PORTS.database,
  },
  'monitoring.cloudwatch': {
    type: 'monitoring.cloudwatch',
    category: 'monitoring',
    idPrefix: 'cw',
    iconKey: 'monitoring',
    configSchema: cloudWatchConfigSchema,
    defaultConfig: { alarms: [] },
    maxPerGraph: 1,
    simModel: 'none',
    costModel: 'perHour',
  },
};

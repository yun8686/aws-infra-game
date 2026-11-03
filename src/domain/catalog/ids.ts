export const SERVICE_TYPES = [
  'external.internet',
  'network.vpc',
  'network.subnet',
  'network.security_group',
  'lb.alb',
  'compute.ec2',
  'compute.autoscaling',
  'database.rds',
  'monitoring.cloudwatch',
] as const;
export type ServiceTypeId = (typeof SERVICE_TYPES)[number];

export const CONNECTION_TYPES = ['placed_in', 'routes_to', 'data_access', 'secured_by', 'monitors'] as const;
export type ConnectionTypeId = (typeof CONNECTION_TYPES)[number];

export const isServiceTypeId = (value: string): value is ServiceTypeId =>
  (SERVICE_TYPES as readonly string[]).includes(value);

export const isConnectionTypeId = (value: string): value is ConnectionTypeId =>
  (CONNECTION_TYPES as readonly string[]).includes(value);

export const COMPUTE_TYPES = [
  'compute.ec2',
  'compute.autoscaling',
] as const satisfies readonly ServiceTypeId[];
export const SECURABLE_TYPES = [
  'lb.alb',
  'compute.ec2',
  'compute.autoscaling',
  'database.rds',
] as const satisfies readonly ServiceTypeId[];

/** Abstract well-known ports used by the game model. */
export const PORTS = {
  http: 80,
  https: 443,
  app: 80,
  database: 5432,
  admin: [22, 3389],
} as const;

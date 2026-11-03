import {
  PORTS,
  type FrameConfigMap,
  type FrameKind,
  type ResourceConfigMap,
  type ResourceType,
} from './schema';

/** Where each frame kind can be created. */
export const FRAME_PARENT: { readonly [K in FrameKind]: FrameKind | null } = {
  region: null,
  vpc: 'region',
  az: 'vpc',
  subnet: 'az',
};

export interface FrameDefinition<K extends FrameKind> {
  readonly kind: K;
  readonly idPrefix: string;
  readonly systemManaged: boolean;
  readonly defaultConfig: FrameConfigMap[K];
}

export const FRAME_DEFINITIONS: { readonly [K in FrameKind]: FrameDefinition<K> } = {
  region: { kind: 'region', idPrefix: 'region', systemManaged: true, defaultConfig: {} },
  vpc: { kind: 'vpc', idPrefix: 'vpc', systemManaged: false, defaultConfig: { cidr: '10.0.0.0/16' } },
  az: { kind: 'az', idPrefix: 'az', systemManaged: false, defaultConfig: { zone: 'az-a' } },
  subnet: {
    kind: 'subnet',
    idPrefix: 'subnet',
    systemManaged: false,
    defaultConfig: { tier: 'private', cidr: '10.0.1.0/24' },
  },
};

export type ResourceRole = 'entry' | 'loadBalancer' | 'compute' | 'database' | 'security' | 'monitoring';

export interface ResourceDefinition<T extends ResourceType> {
  readonly type: T;
  readonly role: ResourceRole;
  readonly idPrefix: string;
  /** The frame kind the resource is placed in; null = outside the cloud. */
  readonly frameKind: FrameKind | null;
  readonly systemManaged: boolean;
  readonly maxPerDiagram?: number;
  /** Lives in the VPC and lists the subnets it uses (`config.subnetIds`). */
  readonly spansSubnets: boolean;
  /** Accepts security groups (`config.securityGroupIds`). */
  readonly securable: boolean;
  readonly defaultConfig: ResourceConfigMap[T];
  readonly inboundPort?: (config: ResourceConfigMap[T]) => number;
}

export const RESOURCE_DEFINITIONS: { readonly [T in ResourceType]: ResourceDefinition<T> } = {
  users: {
    type: 'users',
    role: 'entry',
    idPrefix: 'users',
    frameKind: null,
    systemManaged: true,
    maxPerDiagram: 1,
    spansSubnets: false,
    securable: false,
    defaultConfig: {},
  },
  alb: {
    type: 'alb',
    role: 'loadBalancer',
    idPrefix: 'alb',
    frameKind: 'vpc',
    systemManaged: false,
    spansSubnets: true,
    securable: true,
    defaultConfig: {
      scheme: 'internet-facing',
      listener: 'http',
      healthCheck: { intervalSec: 30, unhealthyThreshold: 3 },
      subnetIds: [],
      securityGroupIds: [],
    },
    inboundPort: (c) => (c.listener === 'https' ? PORTS.https : PORTS.http),
  },
  ec2: {
    type: 'ec2',
    role: 'compute',
    idPrefix: 'web',
    frameKind: 'subnet',
    systemManaged: false,
    spansSubnets: false,
    securable: true,
    defaultConfig: { size: 'small', apps: ['shop'], securityGroupIds: [] },
    inboundPort: () => PORTS.app,
  },
  asg: {
    type: 'asg',
    role: 'compute',
    idPrefix: 'asg',
    frameKind: 'vpc',
    systemManaged: false,
    spansSubnets: true,
    securable: true,
    defaultConfig: {
      size: 'small',
      min: 2,
      desired: 2,
      max: 6,
      targetCpuPct: 60,
      warmupSec: 180,
      apps: ['shop'],
      subnetIds: [],
      securityGroupIds: [],
    },
    inboundPort: () => PORTS.app,
  },
  rds: {
    type: 'rds',
    role: 'database',
    idPrefix: 'db',
    frameKind: 'vpc',
    systemManaged: false,
    spansSubnets: true,
    securable: true,
    defaultConfig: {
      instanceClass: 'db.small',
      storageTier: 'standard',
      multiAz: false,
      subnetIds: [],
      securityGroupIds: [],
    },
    inboundPort: () => PORTS.database,
  },
  sg: {
    type: 'sg',
    role: 'security',
    idPrefix: 'sg',
    frameKind: 'vpc',
    systemManaged: false,
    spansSubnets: false,
    securable: false,
    defaultConfig: { inbound: [] },
  },
  cloudwatch: {
    type: 'cloudwatch',
    role: 'monitoring',
    idPrefix: 'cw',
    frameKind: 'region',
    systemManaged: false,
    maxPerDiagram: 1,
    spansSubnets: false,
    securable: false,
    defaultConfig: { alarms: [] },
  },
};

export const resourceDef = <T extends ResourceType>(type: T): ResourceDefinition<T> =>
  RESOURCE_DEFINITIONS[type] as ResourceDefinition<T>;

export const COMPUTE_TYPES = ['ec2', 'asg'] as const satisfies readonly ResourceType[];
export type ComputeType = (typeof COMPUTE_TYPES)[number];
export const isComputeType = (t: ResourceType): t is ComputeType => t === 'ec2' || t === 'asg';

/** Resource types that can be added inside a frame of the given kind (null = outside). */
export const addableResourceTypes = (frameKind: FrameKind): ResourceType[] =>
  (Object.values(RESOURCE_DEFINITIONS) as ResourceDefinition<ResourceType>[])
    .filter((d) => !d.systemManaged && d.frameKind === frameKind)
    .map((d) => d.type);

/** Frame kinds that can be added inside a frame of the given kind. */
export const addableFrameKinds = (frameKind: FrameKind): FrameKind[] =>
  (Object.keys(FRAME_PARENT) as FrameKind[]).filter(
    (k) => FRAME_PARENT[k] === frameKind && !FRAME_DEFINITIONS[k].systemManaged,
  );

/** Allowed links: kind → source type → target types. */
export const LINK_RULES: {
  readonly [K in 'traffic' | 'data']: Partial<Record<ResourceType, readonly ResourceType[]>>;
} = {
  traffic: { users: ['alb', 'ec2'], alb: ['ec2', 'asg'] },
  data: { ec2: ['rds'], asg: ['rds'] },
};

export const DEFAULT_POOL_SIZE = 10;

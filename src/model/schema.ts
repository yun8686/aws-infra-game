import { z } from 'zod';

/**
 * Diagram data model (ADR 0018, docs/REBUILD.md). Frames nest Region › VPC › AZ › Subnet.
 * Resources sit in exactly one frame; links carry traffic and database access only.
 * Every stored diagram is schema-valid: edit commands reject invalid configs.
 */

export const APP_IDS = ['shop', 'orders'] as const;
export type AppId = (typeof APP_IDS)[number];
export const DEFAULT_APP: AppId = 'shop';

export const ZONES = ['az-a', 'az-b', 'az-c'] as const;
export type Zone = (typeof ZONES)[number];

export const INSTANCE_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export type InstanceSize = (typeof INSTANCE_SIZES)[number];
export const DB_CLASSES = ['db.small', 'db.medium', 'db.large', 'db.xlarge'] as const;
export type DbClass = (typeof DB_CLASSES)[number];

export const FRAME_KINDS = ['region', 'vpc', 'az', 'subnet'] as const;
export type FrameKind = (typeof FRAME_KINDS)[number];

export const RESOURCE_TYPES = ['users', 'igw', 'alb', 'ec2', 'asg', 'rds', 'sg', 'cloudwatch'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const LINK_KINDS = ['traffic', 'data'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** Abstract well-known ports used by the game model. */
export const PORTS = { http: 80, https: 443, app: 80, database: 5432, admin: [22, 3389] } as const;

const id = z.string().min(1).max(64);
const cidr = z.string().regex(/^(\d{1,3})(\.\d{1,3}){3}\/(\d|[12]\d|3[0-2])$/, 'invalid_cidr');
const name = z.string().trim().min(1).max(40);
const uniqueIds = <T extends z.ZodType<string>>(item: T) =>
  z.array(item).refine((a) => new Set(a).size === a.length, 'duplicate');

const apps = z
  .array(z.enum(APP_IDS))
  .min(1)
  .refine((a) => new Set(a).size === a.length, 'duplicate');

// ---- Frame configs ------------------------------------------------------------

export const frameConfigSchemas = {
  region: z.object({}),
  vpc: z.object({ cidr }),
  az: z.object({ zone: z.enum(ZONES) }),
  subnet: z.object({ tier: z.enum(['public', 'private']), cidr }),
} as const;

export type FrameConfigMap = { [K in FrameKind]: z.infer<(typeof frameConfigSchemas)[K]> };

// ---- Resource configs ---------------------------------------------------------

export const sgRuleSchema = z.object({
  port: z.union([z.int().min(1).max(65535), z.literal('all')]),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('anywhere') }),
    z.object({ kind: z.literal('vpc') }),
    z.object({ kind: z.literal('sg'), sgId: id }),
  ]),
});
export type SgRule = z.infer<typeof sgRuleSchema>;

const securityGroupIds = uniqueIds(id).max(5);
const subnetIds = uniqueIds(id).max(3);

export const resourceConfigSchemas = {
  users: z.object({}),
  alb: z.object({
    scheme: z.enum(['internet-facing', 'internal']),
    listener: z.enum(['http', 'https']),
    healthCheck: z.object({
      intervalSec: z.int().min(5).max(300),
      unhealthyThreshold: z.int().min(2).max(10),
    }),
    subnetIds,
    securityGroupIds,
  }),
  ec2: z.object({ size: z.enum(INSTANCE_SIZES), apps, securityGroupIds }),
  asg: z
    .object({
      size: z.enum(INSTANCE_SIZES),
      min: z.int().min(1).max(50),
      desired: z.int().min(1).max(50),
      max: z.int().min(1).max(50),
      targetCpuPct: z.int().min(10).max(90),
      warmupSec: z.int().min(0).max(900),
      apps,
      subnetIds,
      securityGroupIds,
    })
    .refine((c) => c.min <= c.desired && c.desired <= c.max, {
      message: 'capacity_order',
      path: ['desired'],
    }),
  igw: z.object({}),
  /** Placed in one subnet (the primary). Multi-AZ adds a standby in a subnet of another AZ. */
  rds: z.object({
    instanceClass: z.enum(DB_CLASSES),
    storageTier: z.enum(['standard', 'provisioned']),
    multiAz: z.boolean(),
    standbySubnetId: id.nullable(),
    securityGroupIds,
  }),
  sg: z.object({ inbound: z.array(sgRuleSchema).max(20) }),
  cloudwatch: z.object({
    alarms: z
      .array(
        z.object({
          metric: z.enum(['cpu', 'errorRate', 'latency', 'dbConnections']),
          threshold: z.number().min(0),
        }),
      )
      .max(20),
  }),
} as const;

export type ResourceConfigMap = { [K in ResourceType]: z.infer<(typeof resourceConfigSchemas)[K]> };

export const linkConfigSchemas = {
  traffic: z.object({}),
  data: z.object({ poolSize: z.int().min(1).max(100) }),
} as const;
export type LinkConfigMap = { [K in LinkKind]: z.infer<(typeof linkConfigSchemas)[K]> };

// ---- Entities -------------------------------------------------------------------

type FrameBase<K extends FrameKind> = {
  readonly id: string;
  readonly kind: K;
  /** Region: null (the AWS Cloud frame is implicit). */
  readonly parentId: string | null;
  readonly name: string;
  readonly config: FrameConfigMap[K];
};
export type Frame = { [K in FrameKind]: FrameBase<K> }[FrameKind];
export type FrameOf<K extends FrameKind> = Extract<Frame, { kind: K }>;

type ResourceBase<T extends ResourceType> = {
  readonly id: string;
  readonly type: T;
  /** Users: null (outside the cloud). */
  readonly frameId: string | null;
  readonly name: string;
  readonly config: ResourceConfigMap[T];
};
export type Resource = { [T in ResourceType]: ResourceBase<T> }[ResourceType];
export type ResourceOf<T extends ResourceType> = Extract<Resource, { type: T }>;

type LinkBase<K extends LinkKind> = {
  readonly id: string;
  readonly kind: K;
  readonly from: string;
  readonly to: string;
  readonly config: LinkConfigMap[K];
};
export type Link = { [K in LinkKind]: LinkBase<K> }[LinkKind];
export type LinkOf<K extends LinkKind> = Extract<Link, { kind: K }>;

export const DIAGRAM_SCHEMA_VERSION = 1;

export interface Diagram {
  readonly schemaVersion: typeof DIAGRAM_SCHEMA_VERSION;
  readonly frames: Readonly<Record<string, Frame>>;
  readonly resources: Readonly<Record<string, Resource>>;
  readonly links: Readonly<Record<string, Link>>;
}

// ---- Whole-diagram schema (persistence / content) ---------------------------------

const frameSchema = z.union(
  FRAME_KINDS.map((kind) =>
    z.object({
      id,
      kind: z.literal(kind),
      parentId: id.nullable(),
      name,
      config: frameConfigSchemas[kind],
    }),
  ) as unknown as [z.ZodType<Frame>, z.ZodType<Frame>, ...z.ZodType<Frame>[]],
);

const resourceSchema = z.union(
  RESOURCE_TYPES.map((type) =>
    z.object({
      id,
      type: z.literal(type),
      frameId: id.nullable(),
      name,
      config: resourceConfigSchemas[type],
    }),
  ) as unknown as [z.ZodType<Resource>, z.ZodType<Resource>, ...z.ZodType<Resource>[]],
);

const linkSchema = z.union(
  LINK_KINDS.map((kind) =>
    z.object({ id, kind: z.literal(kind), from: id, to: id, config: linkConfigSchemas[kind] }),
  ) as unknown as [z.ZodType<Link>, z.ZodType<Link>],
);

export const diagramSchema = z.object({
  schemaVersion: z.literal(DIAGRAM_SCHEMA_VERSION),
  frames: z.record(z.string(), frameSchema),
  resources: z.record(z.string(), resourceSchema),
  links: z.record(z.string(), linkSchema),
});

/** Parses unknown data (saves, content) into a schema-valid diagram, or returns null. */
export const parseDiagram = (data: unknown): Diagram | null => {
  const parsed = diagramSchema.safeParse(data);
  return parsed.success ? (parsed.data as Diagram) : null;
};

export const isZone = (v: string): v is Zone => (ZONES as readonly string[]).includes(v);

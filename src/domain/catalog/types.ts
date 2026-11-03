import type { z } from 'zod';
import type { ConnectionTypeId, ServiceTypeId } from './ids';

export type ServiceCategory =
  'external' | 'networking' | 'load_balancing' | 'compute' | 'database' | 'monitoring';

/** Identifies the simulation adapter (implemented in Phase 2). */
export type SimModelId =
  'entry' | 'none' | 'loadBalancer' | 'computeFixed' | 'computeAutoScaling' | 'database';

/** Identifies the cost model (parameters are defined in Phase 2). */
export type CostModelId = 'free' | 'perHour' | 'perInstanceHour';

export interface PlacementRule {
  /** Container service types this node may be `placed_in`. */
  readonly targets: readonly ServiceTypeId[];
  readonly min: number;
  readonly max: number;
}

export interface ServiceDefinition<C = unknown> {
  readonly type: ServiceTypeId;
  readonly category: ServiceCategory;
  /** Prefix for deterministic node ids, e.g. `ec2` → `ec2-1`. */
  readonly idPrefix: string;
  readonly iconKey: string;
  readonly configSchema: z.ZodType<C>;
  readonly defaultConfig: C;
  readonly placement?: PlacementRule;
  /** System nodes cannot be added or removed by the player. */
  readonly systemManaged?: boolean;
  readonly maxPerGraph?: number;
  readonly simModel: SimModelId;
  readonly costModel: CostModelId;
  /** Port this node accepts inbound traffic on, for security-group evaluation. */
  readonly inboundPort?: (config: C) => number;
}

export type ConnectionSemantic = 'structural' | 'traffic' | 'data' | 'security' | 'observability';

export interface ConnectionTypeDefinition<C = unknown> {
  readonly type: ConnectionTypeId;
  readonly semantic: ConnectionSemantic;
  readonly configSchema: z.ZodType<C>;
  readonly defaultConfig: C;
  readonly allowed: readonly {
    readonly from: readonly ServiceTypeId[];
    readonly to: readonly ServiceTypeId[];
  }[];
  /** Max outgoing connections of this type per source node (placement uses PlacementRule instead). */
  readonly maxOutgoingPerSource?: number;
}

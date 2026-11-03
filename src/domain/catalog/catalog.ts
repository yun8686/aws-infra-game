import type { InfraNode } from '../graph/types';
import { CONNECTION_DEFINITIONS } from './connections';
import { isConnectionTypeId, isServiceTypeId, type ConnectionTypeId, type ServiceTypeId } from './ids';
import { SERVICE_DEFINITIONS, type ServiceConfigMap } from './services';
import type { ConnectionTypeDefinition, ServiceDefinition } from './types';

export const getServiceDefinition = (type: string): ServiceDefinition | undefined =>
  isServiceTypeId(type) ? (SERVICE_DEFINITIONS[type] as ServiceDefinition) : undefined;

export const getConnectionDefinition = (type: string): ConnectionTypeDefinition | undefined =>
  isConnectionTypeId(type) ? CONNECTION_DEFINITIONS[type] : undefined;

export const isConnectionAllowed = (type: ConnectionTypeId, from: string, to: string): boolean =>
  CONNECTION_DEFINITIONS[type].allowed.some(
    (rule) => (rule.from as readonly string[]).includes(from) && (rule.to as readonly string[]).includes(to),
  );

/** Connection types that may link `from` → `to` (used by the editor to offer choices). */
export const allowedConnectionTypes = (from: string, to: string): ConnectionTypeId[] =>
  (Object.keys(CONNECTION_DEFINITIONS) as ConnectionTypeId[]).filter((t) => isConnectionAllowed(t, from, to));

/**
 * Typed, validated read of a node's config. Returns undefined if the node is not of
 * the requested type or its config does not satisfy the schema.
 */
export const readConfig = <T extends ServiceTypeId>(
  node: InfraNode | undefined,
  type: T,
): ServiceConfigMap[T] | undefined => {
  if (!node || node.serviceType !== type) return undefined;
  const parsed = SERVICE_DEFINITIONS[type].configSchema.safeParse(node.config);
  return parsed.success ? (parsed.data as ServiceConfigMap[T]) : undefined;
};

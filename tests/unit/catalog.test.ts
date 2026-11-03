import { describe, expect, it } from 'vitest';
import {
  allowedConnectionTypes,
  CONNECTION_DEFINITIONS,
  CONNECTION_TYPES,
  SERVICE_DEFINITIONS,
  SERVICE_TYPES,
} from '../../src/domain/catalog';

describe('service catalog', () => {
  it.each(SERVICE_TYPES)('%s has a default config that satisfies its schema', (type) => {
    const def = SERVICE_DEFINITIONS[type];
    expect(def.type).toBe(type);
    expect(def.configSchema.safeParse(def.defaultConfig).success).toBe(true);
  });

  it('uses unique id prefixes', () => {
    const prefixes = SERVICE_TYPES.map((t) => SERVICE_DEFINITIONS[t].idPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it.each(CONNECTION_TYPES)('%s only references known service types and has a valid default', (type) => {
    const def = CONNECTION_DEFINITIONS[type];
    expect(def.configSchema.safeParse(def.defaultConfig).success).toBe(true);
    for (const rule of def.allowed) {
      for (const t of [...rule.from, ...rule.to]) expect(SERVICE_TYPES).toContain(t);
    }
  });

  it('placement targets are allowed by the placed_in connection rules', () => {
    for (const type of SERVICE_TYPES) {
      const placement = SERVICE_DEFINITIONS[type].placement;
      for (const target of placement?.targets ?? []) {
        expect(allowedConnectionTypes(type, target)).toContain('placed_in');
      }
    }
  });

  it('rejects an Auto Scaling config whose capacities are out of order', () => {
    const schema = SERVICE_DEFINITIONS['compute.autoscaling'].configSchema;
    const base = SERVICE_DEFINITIONS['compute.autoscaling'].defaultConfig;
    expect(schema.safeParse({ ...base, minCapacity: 4, desiredCapacity: 2 }).success).toBe(false);
    expect(schema.safeParse({ ...base, desiredCapacity: 8, maxCapacity: 6 }).success).toBe(false);
  });

  it('offers connection types for a pair of services', () => {
    expect(allowedConnectionTypes('lb.alb', 'compute.autoscaling')).toEqual(['routes_to']);
    expect(allowedConnectionTypes('compute.ec2', 'database.rds')).toEqual(['data_access']);
    expect(allowedConnectionTypes('database.rds', 'compute.ec2')).toEqual([]);
  });
});

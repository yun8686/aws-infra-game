/**
 * Template for the first mission (TV traffic spike): a small e-commerce site.
 * Intentional weaknesses for the player to discover:
 * - the web tier is two small EC2 instances, both in the same AZ,
 * - the database is a small single-AZ instance.
 * Stored as plain data and parsed through the same schema as saves.
 */
export const ecommerceStarterTemplate: unknown = {
  schemaVersion: 1,
  nodes: {
    'internet-1': { id: 'internet-1', serviceType: 'external.internet', name: 'Internet', config: {} },
    'vpc-1': { id: 'vpc-1', serviceType: 'network.vpc', name: 'shop-vpc', config: { cidr: '10.0.0.0/16' } },
    'subnet-1': {
      id: 'subnet-1',
      serviceType: 'network.subnet',
      name: 'public-a',
      config: { tier: 'public', az: 'az-a', cidr: '10.0.0.0/24' },
    },
    'subnet-2': {
      id: 'subnet-2',
      serviceType: 'network.subnet',
      name: 'public-b',
      config: { tier: 'public', az: 'az-b', cidr: '10.0.1.0/24' },
    },
    'subnet-3': {
      id: 'subnet-3',
      serviceType: 'network.subnet',
      name: 'private-a',
      config: { tier: 'private', az: 'az-a', cidr: '10.0.10.0/24' },
    },
    'subnet-4': {
      id: 'subnet-4',
      serviceType: 'network.subnet',
      name: 'private-b',
      config: { tier: 'private', az: 'az-b', cidr: '10.0.11.0/24' },
    },
    'sg-1': {
      id: 'sg-1',
      serviceType: 'network.security_group',
      name: 'alb-sg',
      config: { inboundRules: [{ port: 80, source: { kind: 'anywhere' } }] },
    },
    'sg-2': {
      id: 'sg-2',
      serviceType: 'network.security_group',
      name: 'web-sg',
      config: { inboundRules: [{ port: 80, source: { kind: 'security_group', nodeId: 'sg-1' } }] },
    },
    'sg-3': {
      id: 'sg-3',
      serviceType: 'network.security_group',
      name: 'db-sg',
      config: { inboundRules: [{ port: 5432, source: { kind: 'security_group', nodeId: 'sg-2' } }] },
    },
    'alb-1': {
      id: 'alb-1',
      serviceType: 'lb.alb',
      name: 'shop-alb',
      config: {
        scheme: 'internet-facing',
        listener: 'http',
        healthCheck: { intervalSec: 30, unhealthyThreshold: 3 },
      },
    },
    'ec2-1': {
      id: 'ec2-1',
      serviceType: 'compute.ec2',
      name: 'web-1',
      config: { instanceSize: 'small', apps: ['shop'] },
    },
    'ec2-2': {
      id: 'ec2-2',
      serviceType: 'compute.ec2',
      name: 'web-2',
      config: { instanceSize: 'small', apps: ['shop'] },
    },
    'rds-1': {
      id: 'rds-1',
      serviceType: 'database.rds',
      name: 'shop-db',
      config: { instanceClass: 'db.small', storageTier: 'standard', multiAz: false },
    },
  },
  connections: Object.fromEntries(
    (
      [
        ['subnet-1', 'vpc-1', 'placed_in'],
        ['subnet-2', 'vpc-1', 'placed_in'],
        ['subnet-3', 'vpc-1', 'placed_in'],
        ['subnet-4', 'vpc-1', 'placed_in'],
        ['sg-1', 'vpc-1', 'placed_in'],
        ['sg-2', 'vpc-1', 'placed_in'],
        ['sg-3', 'vpc-1', 'placed_in'],
        ['alb-1', 'subnet-1', 'placed_in'],
        ['alb-1', 'subnet-2', 'placed_in'],
        ['ec2-1', 'subnet-3', 'placed_in'],
        ['ec2-2', 'subnet-3', 'placed_in'],
        ['rds-1', 'subnet-3', 'placed_in'],
        ['rds-1', 'subnet-4', 'placed_in'],
        ['alb-1', 'sg-1', 'secured_by'],
        ['ec2-1', 'sg-2', 'secured_by'],
        ['ec2-2', 'sg-2', 'secured_by'],
        ['rds-1', 'sg-3', 'secured_by'],
        ['internet-1', 'alb-1', 'routes_to'],
        ['alb-1', 'ec2-1', 'routes_to'],
        ['alb-1', 'ec2-2', 'routes_to'],
        ['ec2-1', 'rds-1', 'data_access', { poolSize: 10 }],
        ['ec2-2', 'rds-1', 'data_access', { poolSize: 10 }],
      ] as const
    ).map(([sourceNodeId, targetNodeId, connectionType, config], i) => {
      const id = `conn-${i + 1}`;
      return [id, { id, sourceNodeId, targetNodeId, connectionType, config: config ?? {} }];
    }),
  ),
};

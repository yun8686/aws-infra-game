import {
  REGION_ID,
  USERS_ID,
  addFrame,
  addResource,
  connect,
  createBaseDiagram,
  type Diagram,
  type EditResult,
} from '../model';

const must = (r: EditResult, step: string): Diagram => {
  if (!r.ok) throw new Error(`Template step "${step}" failed: ${r.finding.code}`);
  return r.diagram;
};

/**
 * Mission 1 starter: a small e-commerce site drawn as a standard two-AZ VPC.
 * Intentional weaknesses for the player to discover:
 * - both web servers are small EC2 instances in the same subnet (AZ a),
 * - the database is a small single-AZ instance in private-a (Multi-AZ off).
 * Built with the same edit commands the player uses, so it is always valid.
 */
export const ecommerceStarter = (apps: readonly ('shop' | 'orders')[] = ['shop']): Diagram => {
  let d = createBaseDiagram();
  const step = (r: EditResult, name: string) => (d = must(r, name));
  step(
    addFrame(d, 'vpc', REGION_ID, { id: 'vpc-1', name: 'shop-vpc', config: { cidr: '10.0.0.0/16' } }),
    'vpc',
  );
  step(addFrame(d, 'az', 'vpc-1', { id: 'az-1', config: { zone: 'az-a' } }), 'az a');
  step(addFrame(d, 'az', 'vpc-1', { id: 'az-2', config: { zone: 'az-b' } }), 'az b');
  step(
    addFrame(d, 'subnet', 'az-1', { id: 'subnet-1', config: { tier: 'public', cidr: '10.0.0.0/24' } }),
    'public a',
  );
  step(
    addFrame(d, 'subnet', 'az-1', { id: 'subnet-3', config: { tier: 'private', cidr: '10.0.10.0/24' } }),
    'private a',
  );
  step(
    addFrame(d, 'subnet', 'az-2', { id: 'subnet-2', config: { tier: 'public', cidr: '10.0.1.0/24' } }),
    'public b',
  );
  step(
    addFrame(d, 'subnet', 'az-2', { id: 'subnet-4', config: { tier: 'private', cidr: '10.0.11.0/24' } }),
    'private b',
  );

  step(
    addResource(d, 'sg', 'vpc-1', {
      id: 'sg-1',
      name: 'alb-sg',
      config: { inbound: [{ port: 80, source: { kind: 'anywhere' } }] },
    }),
    'alb-sg',
  );
  step(
    addResource(d, 'sg', 'vpc-1', {
      id: 'sg-2',
      name: 'web-sg',
      config: { inbound: [{ port: 80, source: { kind: 'sg', sgId: 'sg-1' } }] },
    }),
    'web-sg',
  );
  step(
    addResource(d, 'sg', 'vpc-1', {
      id: 'sg-3',
      name: 'db-sg',
      config: { inbound: [{ port: 5432, source: { kind: 'sg', sgId: 'sg-2' } }] },
    }),
    'db-sg',
  );
  step(
    addResource(d, 'alb', 'vpc-1', {
      id: 'alb-1',
      name: 'shop-alb',
      config: { subnetIds: ['subnet-1', 'subnet-2'], securityGroupIds: ['sg-1'] },
    }),
    'alb',
  );
  for (const id of ['web-1', 'web-2']) {
    step(
      addResource(d, 'ec2', 'subnet-3', {
        id,
        config: { size: 'small', apps: [...apps], securityGroupIds: ['sg-2'] },
      }),
      id,
    );
  }
  step(
    addResource(d, 'rds', 'subnet-3', {
      id: 'db-1',
      name: 'shop-db',
      config: { securityGroupIds: ['sg-3'] },
    }),
    'db',
  );
  step(addResource(d, 'igw', 'vpc-1', { id: 'igw-1', name: 'shop-igw' }), 'igw');
  step(connect(d, 'traffic', USERS_ID, 'alb-1'), 'users → alb');
  step(connect(d, 'traffic', 'alb-1', 'web-1'), 'alb → web-1');
  step(connect(d, 'traffic', 'alb-1', 'web-2'), 'alb → web-2');
  step(connect(d, 'data', 'web-1', 'db-1'), 'web-1 → db');
  step(connect(d, 'data', 'web-2', 'db-1'), 'web-2 → db');
  return d;
};

/** Free build / sandbox: only the Region and the users. */
export const baseline = (): Diagram => createBaseDiagram();

export const TEMPLATES = {
  'ecommerce-starter': () => ecommerceStarter(['shop']),
  /** Mission 2: same starter, but both servers run the shop and order management together. */
  'ecommerce-two-apps': () => ecommerceStarter(['shop', 'orders']),
} as const;
export type TemplateId = keyof typeof TEMPLATES;

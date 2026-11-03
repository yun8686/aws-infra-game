import { describe, expect, it } from 'vitest';
import {
  REGION_ID,
  USERS_ID,
  createBaseDiagram,
  getResource,
  isTrafficAllowed,
  moveResource,
  remove,
  validateDiagram,
  type Diagram,
  type FindingCode,
} from '../../src/model';
import { must, standardStack } from './builders';

const codes = (d: Diagram, ctx = {}) => validateDiagram(d, ctx).map((f) => f.code);
const errors = (d: Diagram) =>
  validateDiagram(d)
    .filter((f) => f.severity === 'error')
    .map((f) => f.code);

describe('validateDiagram', () => {
  it('accepts the standard stack with no warnings', () => {
    const { b } = standardStack();
    expect(codes(b.d, { requiredApps: ['shop'] })).toEqual([]);
  });

  it('needs a request path in an empty diagram', () => {
    expect(errors(createBaseDiagram())).toEqual(['dependency.no_request_path']);
  });

  it('checks load balancer placement', () => {
    const { b, alb, pubA, privA } = standardStack();
    b.set(alb, { subnetIds: [pubA] });
    expect(errors(b.d)).toContain('placement.alb_requires_two_azs');
    b.set(alb, { subnetIds: [pubA, 'subnet-4'] });
    expect(errors(b.d)).toContain('placement.internet_facing_requires_public_subnet');
    b.set(alb, { subnetIds: [] });
    expect(errors(b.d)).toContain('placement.subnets_required');
    expect(privA).toBeTruthy();
  });

  it('checks Multi-AZ needs two AZs', () => {
    const { b, db, privA } = standardStack();
    b.set(db, { multiAz: true });
    expect(errors(b.d)).toEqual(['placement.rds_standby_required']);
    b.set(db, { standbySubnetId: privA });
    expect(errors(b.d)).toEqual(['placement.rds_multi_az_requires_two_azs']);
    b.set(db, { standbySubnetId: 'subnet-4' });
    expect(errors(b.d)).toEqual([]);
  });

  it('needs an Internet Gateway for traffic from users into the VPC', () => {
    const { b, vpc } = standardStack();
    const without = must(remove(b.d, 'igw-1')).diagram;
    expect(
      validateDiagram(without)
        .filter((f) => f.severity === 'error')
        .map((f) => [f.code, f.targetIds[0]]),
    ).toEqual([['placement.igw_required', vpc]]);
  });

  it('flags a private server exposed directly to users', () => {
    const { b, webA } = standardStack();
    b.link('traffic', USERS_ID, webA);
    const all = codes(b.d);
    expect(all).toContain('placement.internet_target_requires_public_subnet');
    expect(all).toContain('security.compute_directly_exposed');
  });

  it('evaluates security groups along links', () => {
    const { b, alb, webA, db, sgWeb } = standardStack();
    expect(isTrafficAllowed(b.d, USERS_ID, alb)).toBe(true);
    expect(isTrafficAllowed(b.d, alb, webA)).toBe(true);
    expect(isTrafficAllowed(b.d, webA, db)).toBe(true);
    expect(isTrafficAllowed(b.d, USERS_ID, webA)).toBe(false);
    b.set(sgWeb, { inbound: [] });
    expect(codes(b.d)).toContain('dependency.traffic_blocked_by_security_group');
  });

  it('reports dependency warnings', () => {
    const { b, webA, db, privA } = standardStack();
    const lonely = b.resource('ec2', privA);
    const asgDb = b.resource('rds', privA, { securityGroupIds: [] });
    const all = codes(b.d, { requiredApps: ['shop', 'orders'] }) as FindingCode[];
    expect(all).toEqual(
      expect.arrayContaining([
        'dependency.unreachable_compute',
        'dependency.no_security_group',
        'dependency.unused_database',
        'dependency.app_not_served',
      ]),
    );
    expect(webA && db && lonely && asgDb).toBeTruthy();
  });

  it('advises when every serving server is in one AZ', () => {
    const { b, webB, privA } = standardStack();
    const d = {
      ...b.d,
      resources: { ...b.d.resources, [webB]: { ...b.d.resources[webB]!, frameId: privA } },
    } as Diagram;
    expect(codes(d).filter((c) => c === 'placement.single_az_compute')).toHaveLength(2);
  });

  it('reports security risks', () => {
    const { b, sgDb, db, pubA } = standardStack();
    b.set(sgDb, {
      inbound: [
        { port: 5432, source: { kind: 'anywhere' } },
        { port: 22, source: { kind: 'anywhere' } },
      ],
    });
    b.d = must(moveResource(b.d, db, pubA)).diagram;
    const sec = validateDiagram(b.d).filter((f) => f.code.startsWith('security.'));
    expect(sec.map((f) => [f.code, f.riskLevel])).toEqual([
      ['security.db_port_open_to_internet', 'critical'],
      ['security.admin_port_open_to_internet', 'major'],
      ['security.db_in_public_subnet', 'major'],
    ]);
  });

  it('reports structure problems in hand-made data before anything else', () => {
    const { b, webA } = standardStack();
    const broken = {
      ...b.d,
      resources: { ...b.d.resources, [webA]: { ...b.d.resources[webA]!, frameId: REGION_ID } },
    } as Diagram;
    expect(codes(broken)).toEqual(['structure.wrong_frame']);
    expect(getResource(b.d, webA)?.frameId).not.toBe(REGION_ID);
  });
});

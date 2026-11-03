import { describe, expect, it } from 'vitest';
import {
  REGION_ID,
  USERS_ID,
  addFrame,
  addResource,
  addableFrameKinds,
  addableResourceTypes,
  connect,
  createBaseDiagram,
  duplicateResource,
  getResource,
  linkCandidates,
  moveResource,
  parseDiagram,
  remove,
  removalImpact,
  rename,
  updateConfig,
  validateDiagram,
} from '../../src/model';
import { DiagramBuilder, must, standardStack } from './builders';

describe('frames', () => {
  it('nests Region › VPC › AZ › Subnet and rejects other parents', () => {
    const d = createBaseDiagram();
    const vpc = must(addFrame(d, 'vpc', REGION_ID));
    expect(vpc.id).toBe('vpc-1');
    expect(addFrame(vpc.diagram, 'subnet', vpc.id)).toMatchObject({
      ok: false,
      finding: { code: 'edit.wrong_frame' },
    });
    const az = must(addFrame(vpc.diagram, 'az', vpc.id));
    const subnet = must(addFrame(az.diagram, 'subnet', az.id, { config: { tier: 'public' } }));
    const s = subnet.diagram.frames[subnet.id];
    expect(s).toMatchObject({
      kind: 'subnet',
      parentId: az.id,
      name: 'public-a',
      config: { tier: 'public' },
    });
    expect(addFrame(subnet.diagram, 'vpc', subnet.id).ok).toBe(false);
  });

  it('gives each AZ in a VPC its own zone and refuses a fourth', () => {
    const b = new DiagramBuilder();
    const vpc = b.frame('vpc', REGION_ID);
    const zones = [b.frame('az', vpc), b.frame('az', vpc), b.frame('az', vpc)].map(
      (id) => (b.d.frames[id]?.config as { zone: string }).zone,
    );
    expect(zones).toEqual(['az-a', 'az-b', 'az-c']);
    expect(addFrame(b.d, 'az', vpc)).toMatchObject({ ok: false, finding: { code: 'edit.no_free_zone' } });
  });

  it('lists what can be added inside each frame kind', () => {
    expect(addableFrameKinds('region')).toEqual(['vpc']);
    expect(addableResourceTypes('region')).toEqual(['cloudwatch']);
    expect(addableFrameKinds('vpc')).toEqual(['az']);
    expect(addableResourceTypes('vpc')).toEqual(['igw', 'alb', 'asg', 'sg']);
    expect(addableFrameKinds('az')).toEqual(['subnet']);
    expect(addableResourceTypes('subnet')).toEqual(['ec2', 'rds']);
  });

  it('renames an auto-named subnet when its tier changes', () => {
    const b = new DiagramBuilder();
    const vpc = b.frame('vpc', REGION_ID);
    const az = b.frame('az', vpc);
    const s = b.frame('subnet', az, { tier: 'private' });
    b.set(s, { tier: 'public' });
    expect(b.d.frames[s]?.name).toBe('public-a');
  });
});

describe('resources', () => {
  it('places resources only in their frame kind', () => {
    const { b, vpc, privA } = standardStack();
    expect(addResource(b.d, 'ec2', vpc)).toMatchObject({ ok: false, finding: { code: 'edit.wrong_frame' } });
    expect(addResource(b.d, 'alb', privA)).toMatchObject({
      ok: false,
      finding: { code: 'edit.wrong_frame' },
    });
    expect(addResource(b.d, 'users', REGION_ID)).toMatchObject({
      ok: false,
      finding: { code: 'edit.system_managed' },
    });
    expect(addResource(b.d, 'cloudwatch', REGION_ID).ok).toBe(true);
  });

  it('suggests one subnet per AZ for spanning resources', () => {
    const { b, alb, pubA, pubB, privA, privB } = standardStack();
    expect(getResource(b.d, alb, 'alb')?.config.subnetIds).toEqual([pubA, pubB]);
    const asg = b.resource('asg', 'vpc-1');
    expect(getResource(b.d, asg, 'asg')?.config.subnetIds).toEqual([privA, privB]);
  });

  it('rejects invalid configs and references outside the VPC', () => {
    const { b, alb, webA } = standardStack();
    const asg = b.resource('asg', 'vpc-1');
    const cfg = getResource(b.d, asg, 'asg')!.config;
    expect(updateConfig(b.d, asg, { ...cfg, min: 5, desired: 2 })).toMatchObject({
      ok: false,
      finding: { code: 'edit.invalid_config' },
    });
    const vpc2 = b.frame('vpc', REGION_ID);
    const az2 = b.frame('az', vpc2);
    const other = b.frame('subnet', az2);
    const albCfg = getResource(b.d, alb, 'alb')!.config;
    expect(updateConfig(b.d, alb, { ...albCfg, subnetIds: [other] })).toMatchObject({
      ok: false,
      finding: { code: 'edit.outside_vpc' },
    });
    expect(moveResource(b.d, webA, other)).toMatchObject({
      ok: false,
      finding: { code: 'edit.outside_vpc' },
    });
  });

  it('moves an EC2 instance to another subnet of the same VPC', () => {
    const { b, webA, pubB } = standardStack();
    expect(must(moveResource(b.d, webA, pubB)).diagram.resources[webA]?.frameId).toBe(pubB);
  });

  it('duplicates a server with its settings and links', () => {
    const { b, webA, privB, alb, db } = standardStack();
    const r = must(duplicateResource(b.d, webA, privB));
    const copy = getResource(r.diagram, r.id, 'ec2')!;
    expect(copy.frameId).toBe(privB);
    expect(copy.config).toEqual(getResource(b.d, webA, 'ec2')!.config);
    const links = Object.values(r.diagram.links);
    expect(links.some((l) => l.from === alb && l.to === r.id && l.kind === 'traffic')).toBe(true);
    expect(links.some((l) => l.from === r.id && l.to === db && l.kind === 'data')).toBe(true);
  });

  it('honours mission policy: locked resources and allowed types', () => {
    const { b, db, privA } = standardStack();
    const policy = { lockedIds: [db], allowedTypes: ['ec2' as const] };
    expect(remove(b.d, db, policy)).toMatchObject({ ok: false, finding: { code: 'edit.locked' } });
    expect(rename(b.d, db, 'x').ok).toBe(true);
    expect(addResource(b.d, 'asg', 'vpc-1', {}, policy)).toMatchObject({
      ok: false,
      finding: { code: 'edit.type_not_allowed' },
    });
    // Removing a subnet the locked database uses would change it, so it is refused too.
    expect(remove(b.d, privA, policy)).toMatchObject({ ok: false, finding: { code: 'edit.locked' } });
    // Links to a locked resource are still allowed.
    const web = b.resource('ec2', privA);
    expect(connect(b.d, 'data', web, db).ok).toBe(true);
  });
});

describe('links', () => {
  it('allows only meaningful links', () => {
    const { b, alb, webA, db } = standardStack();
    expect(connect(b.d, 'traffic', db, webA)).toMatchObject({
      ok: false,
      finding: { code: 'edit.link_not_allowed' },
    });
    expect(connect(b.d, 'data', alb, db).ok).toBe(false);
    expect(connect(b.d, 'traffic', alb, webA)).toMatchObject({
      ok: false,
      finding: { code: 'edit.link_duplicate' },
    });
    expect(connect(b.d, 'traffic', USERS_ID, webA).ok).toBe(true);
  });

  it('lists link candidates for the connect flow', () => {
    const { b, alb, webA } = standardStack();
    const asg = b.resource('asg', 'vpc-1');
    expect(linkCandidates(b.d, 'traffic', alb).map((r) => r.id)).toEqual([asg]);
    expect(linkCandidates(b.d, 'data', webA)).toEqual([]);
  });
});

describe('removal', () => {
  it('removing a frame removes everything inside and strips references', () => {
    const { b, privA, privB, webA, webB, db, alb, pubA } = standardStack();
    b.set(db, { multiAz: true, standbySubnetId: privB });
    const azB = b.d.frames[privB]!.parentId!;
    const impact = removalImpact(b.d, azB);
    expect(impact.frames).toEqual(expect.arrayContaining([privB]));
    expect(impact.resources).toEqual([webB]);
    const r = must(remove(b.d, azB));
    expect(r.diagram.frames[privB]).toBeUndefined();
    expect(r.diagram.resources[webB]).toBeUndefined();
    // The standby subnet is gone: the database keeps running in AZ a without a standby.
    expect(getResource(r.diagram, db, 'rds')!.config.standbySubnetId).toBeNull();
    expect(getResource(r.diagram, alb, 'alb')!.config.subnetIds).toEqual([pubA]);
    expect(Object.values(r.diagram.links).some((l) => l.from === webB || l.to === webB)).toBe(false);
    // Removing AZ a removes the database placed in it.
    const azA = b.d.frames[privA]!.parentId!;
    expect(removalImpact(b.d, azA).resources).toEqual([db, webA]);
  });

  it('allows one Internet Gateway per VPC', () => {
    const { b, vpc } = standardStack();
    expect(addResource(b.d, 'igw', vpc)).toMatchObject({ ok: false, finding: { code: 'edit.max_reached' } });
  });

  it('removing a security group detaches it and drops rules that referenced it', () => {
    const { b, sgAlb, sgWeb, alb } = standardStack();
    const r = must(remove(b.d, sgAlb));
    expect(getResource(r.diagram, alb, 'alb')!.config.securityGroupIds).toEqual([]);
    expect(getResource(r.diagram, sgWeb, 'sg')!.config.inbound).toEqual([]);
  });

  it('keeps the Region and Users', () => {
    const d = createBaseDiagram();
    expect(remove(d, REGION_ID).ok).toBe(false);
    expect(remove(d, USERS_ID).ok).toBe(false);
  });
});

describe('persistence', () => {
  it('round-trips through the schema and rejects junk', () => {
    const { b } = standardStack();
    const copy = parseDiagram(JSON.parse(JSON.stringify(b.d)));
    expect(copy).toEqual(b.d);
    expect(parseDiagram({ ...b.d, schemaVersion: 99 })).toBeNull();
    expect(validateDiagram(copy!).filter((f) => f.severity === 'error')).toEqual([]);
  });
});

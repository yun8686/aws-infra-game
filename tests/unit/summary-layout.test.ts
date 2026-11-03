import { describe, expect, it } from 'vitest';
import { connect } from '../../src/domain/graph/commands';
import { TEMPLATES } from '../../src/data/templates';
import { layoutGraph } from '../../src/features/infrastructure-editor/layout/tierLayout';
import {
  describeNode,
  instancesInAz,
  partSummary,
  relatedNodeIds,
} from '../../src/features/infrastructure-editor/summary';
import { buildWebStackFromBaseline, unwrap } from '../fixtures/builders';
import { ASG_SMALL, replaceWebWithAutoScaling, setConfig } from '../fixtures/solutions';

const template = () => TEMPLATES['ecommerce-starter']();

describe('per-AZ drawing (playtest: resources must not look as if they straddle subnets)', () => {
  it('draws a single-AZ server and a single-AZ database once, in their own column', () => {
    const layout = layoutGraph(template());
    const ec2 = layout.nodes.filter((n) => n.id === 'ec2-1');
    const rds = layout.nodes.filter((n) => n.id === 'rds-1');
    expect(ec2.map((n) => [n.role, n.az])).toEqual([['zonal', 'az-a']]);
    expect(rds.map((n) => [n.role, n.az])).toEqual([['primary', 'az-a']]);
    // Column width only, never spanning both AZs.
    expect(ec2[0]?.width).toBe(rds[0]?.width);
    expect((ec2[0]?.width ?? 0) * 2).toBeLessThan(layout.width);
  });

  it('draws a two-AZ Auto Scaling group as one box per AZ, linked as one group', () => {
    const g = setConfig(replaceWebWithAutoScaling(template(), ASG_SMALL).graph, 'rds-1', { multiAz: true });
    const layout = layoutGraph(g);
    const asg = layout.nodes.filter((n) => n.id === 'asg-1');
    expect(asg.map((n) => [n.key, n.az, n.role])).toEqual([
      ['asg-1@az-a', 'az-a', 'zonal'],
      ['asg-1@az-b', 'az-b', 'zonal'],
    ]);
    expect(layout.nodes.filter((n) => n.id === 'rds-1').map((n) => [n.role, n.az])).toEqual([
      ['primary', 'az-a'],
      ['standby', 'az-b'],
    ]);
    expect(layout.links.map((l) => [l.kind, l.nodeId])).toEqual(
      expect.arrayContaining([
        ['group', 'asg-1'],
        ['replication', 'rds-1'],
      ]),
    );
    // ALB → each ASG part; each ASG part → the database primary only.
    const albEdges = layout.edges.filter(
      (e) =>
        g.connections[e.id]?.sourceNodeId === 'alb-1' && g.connections[e.id]?.connectionType === 'routes_to',
    );
    expect(albEdges).toHaveLength(2);
    const primary = layout.nodes.find((n) => n.id === 'rds-1' && n.role === 'primary');
    const dbEdges = layout.edges.filter((e) => e.kind === 'data_access');
    expect(dbEdges).toHaveLength(2);
    for (const e of dbEdges) expect(e.to.x).toBe((primary?.x ?? 0) + (primary?.width ?? 0) / 2);
  });

  it('keeps load balancers spanning their AZs (they really are multi-AZ)', () => {
    const alb = layoutGraph(template()).nodes.filter((n) => n.id === 'alb-1');
    expect(alb.map((n) => n.role)).toEqual(['single']);
  });
});

describe('configuration summaries (playtest: settings were hard to grasp)', () => {
  it('splits fixed instances across AZs like the simulation', () => {
    expect([instancesInAz(4, ['az-a', 'az-b'], 'az-a'), instancesInAz(4, ['az-a', 'az-b'], 'az-b')]).toEqual([
      2, 2,
    ]);
    expect([instancesInAz(3, ['az-a', 'az-b'], 'az-a'), instancesInAz(3, ['az-a', 'az-b'], 'az-b')]).toEqual([
      2, 1,
    ]);
  });

  it('shows key settings on each drawn part', () => {
    const g = unwrap(
      connect(setConfig(template(), 'ec2-1', { instanceCount: 3 }), {
        sourceNodeId: 'ec2-1',
        targetNodeId: 'subnet-4',
        connectionType: 'placed_in',
      }),
    ).graph;
    expect(partSummary(g, 'ec2-1', { role: 'zonal', az: 'az-a' })).toBe('small × 2台');
    expect(partSummary(g, 'ec2-1', { role: 'zonal', az: 'az-b' })).toBe('small × 1台');
    expect(partSummary(g, 'rds-1', { role: 'primary', az: 'az-a' })).toBe('db.small・単一AZ');
    expect(partSummary(g, 'alb-1', { role: 'single' })).toBe('HTTP・インターネット向け');
  });

  it('describes placement, protection and connections in plain language', () => {
    const lines = Object.fromEntries(describeNode(template(), 'ec2-1').map((l) => [l.label, l.value]));
    expect(lines).toMatchObject({
      配置: 'private-a（az-a・プライベート）',
      台数: '2台（固定）',
      保護: 'web-sg（HTTP(80) ← SG alb-sg）',
      リクエスト元: 'shop-alb',
      データベース: 'shop-db（プール 10）',
    });
    const sg = Object.fromEntries(describeNode(template(), 'sg-3').map((l) => [l.label, l.value]));
    expect(sg).toEqual({ VPC: 'shop-vpc', 受信ルール: 'DB(5432) ← SG web-sg', 適用先: 'shop-db' });
  });

  it('relates a resource to its security groups and subnets', () => {
    expect([...relatedNodeIds(template(), 'ec2-1')].sort()).toEqual(['sg-2', 'subnet-3']);
    expect([...relatedNodeIds(template(), 'sg-2')]).toEqual(['ec2-1']);
  });
});

describe('load balancer drawn at VPC level (playtest decision B)', () => {
  const contains = (
    outer: { x: number; y: number; width: number; height: number },
    inner: { x: number; y: number },
  ) =>
    inner.x >= outer.x &&
    inner.x <= outer.x + outer.width &&
    inner.y >= outer.y &&
    inner.y <= outer.y + outer.height;

  it('places the ALB inside the VPC, above and outside every subnet box, linked to the subnets it uses', () => {
    const layout = layoutGraph(template());
    const alb = layout.nodes.find((n) => n.id === 'alb-1');
    const vpc = layout.zones.find((z) => z.kind === 'vpc');
    const subnetZones = layout.zones.filter((z) => z.kind === 'subnet');
    if (!alb || !vpc) throw new Error('missing');
    expect(contains(vpc, { x: alb.x, y: alb.y })).toBe(true);
    for (const z of subnetZones) expect(alb.y + alb.height).toBeLessThan(z.y);
    const placement = layout.links.filter((l) => l.kind === 'placement');
    expect(placement).toHaveLength(2);
    const publicZones = subnetZones.filter((z) => z.key.endsWith(':public'));
    for (const l of placement) expect(publicZones.some((z) => l.to.y === z.y)).toBe(true);
  });

  it('draws a server placed in a public subnet inside the public band', () => {
    const s = buildWebStackFromBaseline();
    const bastion = s.b.add('compute.ec2');
    s.b.link(bastion, s.pubB, 'placed_in');
    const layout = layoutGraph(s.b.graph);
    const part = layout.nodes.find((n) => n.id === bastion);
    const zone = layout.zones.find((z) => z.key === 'az-b:public');
    if (!part || !zone) throw new Error('missing');
    expect(contains(zone, { x: part.x, y: part.y })).toBe(true);
    expect(contains(zone, { x: part.x + part.width, y: part.y + part.height })).toBe(true);
  });
});

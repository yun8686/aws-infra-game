import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../../src/data/templates';
import { addNode } from '../../src/domain/graph/commands';
import {
  buildOverviewGroups,
  groupContaining,
  layoutOverview,
  overviewEdges,
} from '../../src/features/infrastructure-editor/layout/overview';
import { unwrap } from '../fixtures/builders';
import { setConfig, twoAppsSeparated } from '../fixtures/solutions';

describe('layered overview (playtest: drill-down instead of stacked boxes)', () => {
  it('summarises the starter as one box per layer with one arrow between layers', () => {
    const g = TEMPLATES['ecommerce-starter']();
    const groups = buildOverviewGroups(g);
    expect(groups.map((x) => [x.key, x.title])).toEqual([
      ['entry', 'Internet'],
      ['lb', 'ALB shop-alb'],
      ['compute:shop', 'サーバー'],
      ['database', 'RDS shop-db'],
      ['network', 'ネットワーク・セキュリティ'],
      ['subnet:subnet-1', 'public-a'],
      ['subnet:subnet-2', 'public-b'],
      ['subnet:subnet-3', 'private-a'],
      ['subnet:subnet-4', 'private-b'],
    ]);
    expect(groups.find((x) => x.kind === 'compute')?.lines).toEqual(['EC2 2台（az-a 2・az-b 0）']);
    expect(groups.find((x) => x.kind === 'database')?.lines).toEqual(['db.small・単一AZ（az-a）']);
    expect(overviewEdges(g, groups)).toEqual([
      { from: 'entry', to: 'lb', kind: 'routes_to' },
      { from: 'lb', to: 'compute:shop', kind: 'routes_to' },
      { from: 'compute:shop', to: 'database', kind: 'data_access' },
    ]);
    expect(groupContaining(groups, 'ec2-2')?.key).toBe('compute:shop');
    expect(groupContaining(groups, 'subnet-3')?.key).toBe('network');
  });

  it('separated applications become separate server boxes, each with its own arrows', () => {
    const g = twoAppsSeparated(TEMPLATES['ecommerce-two-apps']());
    const groups = buildOverviewGroups(g, { showApps: true });
    const compute = groups.filter((x) => x.kind === 'compute');
    expect(compute.map((x) => x.title)).toEqual(['サーバー（ショップ）', 'サーバー（受注）']);
    expect(compute[0]?.lines).toEqual(['ASG asg-1 2〜14台（az-a・az-b）']);
    expect(compute[1]?.lines).toEqual(['EC2 2台（az-a 1・az-b 1）']);
    const edges = overviewEdges(g, groups);
    expect(
      edges
        .filter((e) => e.from === 'lb')
        .map((e) => e.to)
        .sort(),
    ).toEqual(['compute:orders', 'compute:shop']);
    expect(edges.filter((e) => e.to === 'database')).toHaveLength(2);
    // Side by side, never overlapping.
    const layout = layoutOverview(g, groups);
    const [a, b] = layout.boxes.filter((x) => x.group.kind === 'compute');
    expect(a && b && a.y === b.y && a.x + a.width < b.x).toBe(true);
    expect(layout.arrows).toHaveLength(edges.length);
  });

  it('collects resources without placement in their own box', () => {
    const g = unwrap(
      addNode(setConfig(TEMPLATES['ecommerce-starter'](), 'ec2-1', {}), {
        serviceType: 'compute.ec2',
        name: 'new',
      }),
    ).graph;
    const groups = buildOverviewGroups(g);
    expect(groups.find((x) => x.kind === 'unplaced')).toMatchObject({
      title: '配置先が未設定',
      lines: ['new'],
    });
  });
});

describe('subnet drill-down (playtest: see what sits together in a subnet)', () => {
  it('adds one card per subnet that does not disturb layers or arrows', () => {
    const g = TEMPLATES['ecommerce-starter']();
    const groups = buildOverviewGroups(g);
    const cards = groups.filter((x) => x.kind === 'subnet');
    expect(cards.map((x) => [x.title, x.lines])).toEqual([
      ['public-a', ['az-a・パブリック', 'ALB 1']],
      ['public-b', ['az-b・パブリック', 'ALB 1']],
      ['private-a', ['az-a・プライベート', 'EC2 2・RDS 1']],
      ['private-b', ['az-b・プライベート', 'RDS 1']],
    ]);
    expect(groupContaining(groups, 'ec2-1')?.kind).toBe('compute');
    expect(overviewEdges(g, groups)).toHaveLength(3);
    const layout = layoutOverview(g, groups);
    expect(layout.labels.map((l) => l.text)).toEqual(['サブネットごとに見る']);
    // Grid: AZ columns, public row above private row.
    const box = (title: string) => layout.boxes.find((b) => b.group.title === title);
    expect(box('public-a')?.x).toBe(box('private-a')?.x);
    expect(box('public-a')?.y).toBe(box('public-b')?.y);
    expect((box('public-a')?.y ?? 0) < (box('private-a')?.y ?? 0)).toBe(true);
  });

  it('places a server and a database in the same subnet side by side', async () => {
    const { layoutSubnets } = await import('../../src/features/infrastructure-editor/layout/subnetLayout');
    const view = layoutSubnets(TEMPLATES['ecommerce-starter'](), ['subnet-3']);
    expect(view.subnets.map((s) => [s.label, s.tier])).toEqual([['private-a', 'private']]);
    expect(view.resources.map((r) => r.id)).toEqual(['ec2-1', 'ec2-2', 'rds-1']);
    const [web1, web2] = view.resources;
    expect(web1 && web2 && web1.y === web2.y && web1.x < web2.x).toBe(true);
  });

  it('shows a Multi-AZ standby in the standby subnet', async () => {
    const { layoutSubnets } = await import('../../src/features/infrastructure-editor/layout/subnetLayout');
    const g = setConfig(TEMPLATES['ecommerce-starter'](), 'rds-1', { multiAz: true });
    expect(layoutSubnets(g, ['subnet-3']).resources.find((r) => r.id === 'rds-1')?.role).toBe('primary');
    expect(layoutSubnets(g, ['subnet-4']).resources.find((r) => r.id === 'rds-1')?.role).toBe('standby');
  });
});

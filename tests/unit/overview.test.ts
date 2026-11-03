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

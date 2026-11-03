import { describe, expect, it } from 'vitest';
import { createEmptyGraph } from '../../src/domain/graph/graph';
import { layoutGraph, type Rect } from '../../src/features/infrastructure-editor/layout/tierLayout';
import { TEMPLATES } from '../../src/data/templates';
import { buildWebStackFromBaseline } from '../fixtures/builders';

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const expectNoOverlap = (rects: readonly Rect[]) => {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(overlaps(rects[i] as Rect, rects[j] as Rect), `rects ${i} and ${j} overlap`).toBe(false);
    }
  }
};

describe('tier × AZ layout', () => {
  it('lays out the template with one column per AZ and every tier node placed', () => {
    const g = TEMPLATES['ecommerce-starter']();
    const layout = layoutGraph(g);
    expect(layout.columns).toEqual(['az-a', 'az-b']);
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(['alb-1', 'ec2-1', 'internet-1', 'rds-1']);
    expect(layout.chips.map((c) => c.id)).toEqual(['sg-1', 'sg-2', 'sg-3']);
    const y = (id: string) => layout.nodes.find((n) => n.id === id)?.y ?? NaN;
    expect(y('internet-1')).toBeLessThan(y('alb-1'));
    expect(y('alb-1')).toBeLessThan(y('ec2-1'));
    expect(y('ec2-1')).toBeLessThan(y('rds-1'));
    expect(layout.edges).toHaveLength(3);
  });

  it('is deterministic and ignores insertion order', () => {
    const g = TEMPLATES['ecommerce-starter']();
    const reversed = {
      ...g,
      nodes: Object.fromEntries(Object.entries(g.nodes).reverse()),
      connections: Object.fromEntries(Object.entries(g.connections).reverse()),
    };
    expect(layoutGraph(reversed)).toEqual(layoutGraph(g));
  });

  it('fits three AZs in a 375px-wide phone and never overlaps nodes', () => {
    const s = buildWebStackFromBaseline();
    const pubC = s.b.add('network.subnet', { tier: 'public', az: 'az-c', cidr: '10.0.2.0/24' });
    s.b.link(pubC, s.vpc, 'placed_in');
    const privC = s.b.add('network.subnet', { tier: 'private', az: 'az-c', cidr: '10.0.12.0/24' });
    s.b.link(privC, s.vpc, 'placed_in');
    const asg = s.b.add('compute.autoscaling');
    s.b.link(asg, s.privA, 'placed_in');
    s.b.link(asg, privC, 'placed_in');
    const ec2b = s.b.add('compute.ec2');
    s.b.link(ec2b, s.privB, 'placed_in');
    s.b.add('compute.ec2'); // unplaced
    const layout = layoutGraph(s.b.graph);
    expect(layout.columns).toEqual(['az-a', 'az-b', 'az-c']);
    expect(layout.width).toBeLessThanOrEqual(376);
    expectNoOverlap([...layout.nodes, ...layout.chips]);
    for (const n of layout.nodes) expect(n.height).toBeGreaterThanOrEqual(44); // touch target
  });

  it('handles an empty graph', () => {
    const layout = layoutGraph(createEmptyGraph());
    expect(layout.nodes).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
  });
});

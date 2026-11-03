import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../../src/content';
import { breadcrumb, layoutView, type DiagramView, type Rect } from '../../src/features/diagram/layout';
import { createBaseDiagram } from '../../src/model';

const d = TEMPLATES['ecommerce-starter']();
const W = 360;
const item = (v: DiagramView, id: string) => v.items.find((i) => i.resourceId === id);
const box = (v: DiagramView, id: string) => v.boxes.find((b) => b.frameId === id);
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 0.01 &&
  inner.y >= outer.y - 0.01 &&
  inner.x + inner.w <= outer.x + outer.w + 0.01 &&
  inner.y + inner.h <= outer.y + outer.h + 0.01;

describe('diagram views', () => {
  it('Region view: users outside the AWS Cloud, VPCs as boxes with a preview', () => {
    const v = layoutView(d, 'region-1', W);
    const cloud = v.boxes.find((b) => b.kind === 'cloud')!;
    const users = item(v, 'users-1')!;
    expect(users.y + users.h).toBeLessThanOrEqual(cloud.y);
    const vpc = box(v, 'vpc-1')!;
    expect(vpc.open).toBe(false);
    expect(vpc.preview).toEqual([
      { type: 'alb', count: 1 },
      { type: 'ec2', count: 2 },
      { type: 'rds', count: 1 },
      { type: 'sg', count: 3 },
    ]);
    // The users → ALB link ends at the VPC box, since the ALB is inside it.
    expect(v.arrows).toHaveLength(1);
    expect(v.arrows[0]!.y2).toBeCloseTo(vpc.y, 5);
  });

  it('VPC view: AZ columns, subnets in rows, spanning resources as bands', () => {
    const v = layoutView(d, 'vpc-1', W);
    const azA = box(v, 'az-1')!;
    const azB = box(v, 'az-2')!;
    expect(azA.x).toBeLessThan(azB.x);
    expect(azA.y).toBe(azB.y);
    // Public subnets on the first row, private on the second, in both AZs.
    expect(box(v, 'subnet-1')!.y).toBe(box(v, 'subnet-2')!.y);
    expect(box(v, 'subnet-3')!.y).toBeGreaterThan(box(v, 'subnet-1')!.y);
    // EC2 instances are inside their subnet.
    expect(inside(item(v, 'web-1')!, box(v, 'subnet-3')!)).toBe(true);
    expect(inside(item(v, 'web-2')!, box(v, 'subnet-3')!)).toBe(true);
    // The ALB band spans both public subnets; the database band both private subnets.
    const alb = item(v, 'alb-1')!;
    expect(alb.variant).toBe('band');
    expect(alb.x).toBeLessThan(box(v, 'subnet-1')!.x + box(v, 'subnet-1')!.w);
    expect(alb.x + alb.w).toBeGreaterThan(box(v, 'subnet-2')!.x);
    const db = item(v, 'db-1')!;
    expect(db.y).toBeGreaterThan(item(v, 'web-1')!.y);
    // Security groups go to the VPC-wide strip.
    expect(item(v, 'sg-1')?.variant).toBe('icon');
  });

  it('VPC view arrows run top to bottom: users → ALB → servers → database', () => {
    const v = layoutView(d, 'vpc-1', W);
    expect(v.arrows.map((a) => a.kind).sort()).toEqual(['data', 'data', 'traffic', 'traffic', 'traffic']);
    for (const a of v.arrows) expect(a.y2).toBeGreaterThan(a.y1);
    expect(v.arrows.every((a) => !a.outsideLabel)).toBe(true);
  });

  it('subnet view: neighbours outside the subnet are named at the frame edge', () => {
    const v = layoutView(d, 'subnet-3', W);
    expect(v.items.map((i) => i.resourceId).sort()).toEqual(['db-1', 'web-1', 'web-2']);
    const fromAlb = v.arrows.filter((a) => a.outsideEnd === 'from');
    expect(fromAlb).toHaveLength(2);
    expect(fromAlb.filter((a) => a.outsideLabel === 'shop-alb')).toHaveLength(1);
    const open = v.boxes.find((b) => b.open)!;
    expect(fromAlb[0]!.y1).toBe(open.y);
  });

  it('AZ view: the ALB comes before the servers and the database after them', () => {
    const v = layoutView(d, 'az-1', W);
    expect(item(v, 'alb-1')!.y).toBeLessThan(item(v, 'web-1')!.y);
    expect(item(v, 'db-1')!.y).toBeGreaterThan(item(v, 'web-1')!.y);
  });

  it('an empty diagram still has a Region view and a breadcrumb', () => {
    const empty = createBaseDiagram();
    const v = layoutView(empty, null, W);
    expect(v.frameId).toBe('region-1');
    expect(v.boxes.some((b) => b.open && b.kind === 'region')).toBe(true);
    expect(breadcrumb(d, 'subnet-3').map((f) => f.id)).toEqual(['region-1', 'vpc-1', 'az-1', 'subnet-3']);
  });

  it('stays within the canvas width', () => {
    for (const f of ['region-1', 'vpc-1', 'az-1', 'az-2', 'subnet-1', 'subnet-3']) {
      const v = layoutView(d, f, W);
      for (const r of [...v.boxes, ...v.items]) expect(r.x + r.w).toBeLessThanOrEqual(W + 0.01);
    }
  });
});

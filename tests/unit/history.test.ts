import { describe, expect, it } from 'vitest';
import { addNode } from '../../src/domain/graph/commands';
import { canRedo, canUndo, createHistory, pushHistory, redo, undo } from '../../src/domain/graph/history';
import { createBaselineGraph } from '../../src/data/templates';
import { unwrap } from '../fixtures/builders';

describe('graph history', () => {
  it('undoes and redoes edits', () => {
    const g0 = createBaselineGraph();
    const g1 = unwrap(addNode(g0, { serviceType: 'network.vpc' })).graph;
    const g2 = unwrap(addNode(g1, { serviceType: 'compute.ec2' })).graph;
    let h = pushHistory(pushHistory(createHistory(g0), g1), g2);
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(g1);
    h = undo(h);
    expect(h.present).toBe(g0);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toBe(g1);
    expect(canRedo(h)).toBe(true);
    // a new edit clears the redo stack
    h = pushHistory(h, g2);
    expect(canRedo(h)).toBe(false);
  });

  it('caps history length', () => {
    let h = createHistory(createBaselineGraph());
    for (let i = 0; i < 5; i++) h = pushHistory(h, { ...h.present }, 3);
    expect(h.past).toHaveLength(3);
  });
});

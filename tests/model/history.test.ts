import { describe, expect, it } from 'vitest';
import {
  REGION_ID,
  addFrame,
  canRedo,
  canUndo,
  createBaseDiagram,
  createHistory,
  pushHistory,
  redo,
  undo,
} from '../../src/model';
import { must } from './builders';

describe('diagram history', () => {
  it('undoes and redoes, and a new edit clears redo', () => {
    const d0 = createBaseDiagram();
    const d1 = must(addFrame(d0, 'vpc', REGION_ID)).diagram;
    const d2 = must(addFrame(d1, 'vpc', REGION_ID)).diagram;
    let h = pushHistory(pushHistory(createHistory(d0), d1), d2);
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(d1);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(d2);
    h = pushHistory(undo(h), d0);
    expect(canRedo(h)).toBe(false);
  });

  it('caps the history length and ignores no-op pushes', () => {
    let h = createHistory(createBaseDiagram());
    expect(pushHistory(h, h.present)).toBe(h);
    for (let i = 0; i < 5; i++) h = pushHistory(h, { ...h.present }, 3);
    expect(h.past).toHaveLength(3);
  });
});

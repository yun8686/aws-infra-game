import { describe, expect, it } from 'vitest';
import { FINDING_TEXT_JA, formatFindingText } from '../../src/data/i18n/ja/findings';
import { FINDING_CODES } from '../../src/domain/validation/findings';

describe('Japanese finding text', () => {
  it.each(FINDING_CODES)('%s has non-empty text', (code) => {
    const t = FINDING_TEXT_JA[code];
    expect(t.message.length).toBeGreaterThan(0);
    expect(t.explanation.length).toBeGreaterThan(0);
    expect(t.remediation.length).toBeGreaterThan(0);
  });

  it('fills placeholders from params and leaves unknown ones intact', () => {
    expect(formatFindingText('最大 {max} / {x}', { max: 3 })).toBe('最大 3 / {x}');
  });
});

describe('Japanese bottleneck text', () => {
  it('covers every bottleneck cause', async () => {
    const { BOTTLENECK_TEXT_JA } = await import('../../src/data/i18n/ja/bottlenecks');
    for (const t of Object.values(BOTTLENECK_TEXT_JA)) {
      expect(t.message && t.explanation && t.remediation).toBeTruthy();
    }
    expect(Object.keys(BOTTLENECK_TEXT_JA)).toHaveLength(11);
  });
});

describe('Japanese evaluation text', () => {
  it('covers dimensions, metrics and learning topics', async () => {
    const t = await import('../../src/data/i18n/ja/evaluation');
    const { DIMENSIONS } = await import('../../src/domain/missions/mission');
    for (const d of DIMENSIONS) expect(t.DIMENSION_TEXT_JA[d]).toBeTruthy();
    for (const v of Object.values(t.LEARNING_TOPIC_TEXT_JA)) expect(v.title && v.summary).toBeTruthy();
    expect(Object.keys(t.METRIC_TEXT_JA)).toHaveLength(5);
  });
});

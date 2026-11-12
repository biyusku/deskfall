import { describe, expect, it } from 'vitest';
import { inIntervals, subtractIntervals, visibleEdge } from '../src/renderer/geometry';

describe('subtractIntervals', () => {
  it('splits around a cut in the middle', () => {
    expect(subtractIntervals({ start: 0, end: 100 }, [{ start: 40, end: 60 }])).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ]);
  });

  it('handles overlapping and covering cuts', () => {
    expect(subtractIntervals({ start: 0, end: 100 }, [{ start: -10, end: 30 }, { start: 20, end: 50 }])).toEqual([
      { start: 50, end: 100 },
    ]);
    expect(subtractIntervals({ start: 0, end: 100 }, [{ start: -1, end: 200 }])).toEqual([]);
  });

  it('ignores cuts that do not touch', () => {
    expect(subtractIntervals({ start: 0, end: 10 }, [{ start: 20, end: 30 }])).toEqual([{ start: 0, end: 10 }]);
  });
});

describe('visibleEdge', () => {
  it('hides the part of a top edge covered by a window above it', () => {
    const above = [{ x: 50, y: 0, width: 100, height: 300 }];
    expect(visibleEdge(0, 200, 100, above)).toEqual([
      { start: 0, end: 50 },
      { start: 150, end: 200 },
    ]);
  });

  it('keeps the edge when the upper window ends above it', () => {
    const above = [{ x: 0, y: 0, width: 300, height: 50 }];
    expect(visibleEdge(0, 200, 100, above)).toEqual([{ start: 0, end: 200 }]);
  });

  it('keeps the edge when the upper window starts below it', () => {
    const above = [{ x: 0, y: 150, width: 300, height: 50 }];
    expect(visibleEdge(0, 200, 100, above)).toEqual([{ start: 0, end: 200 }]);
  });
});

describe('inIntervals', () => {
  it('detects membership including bounds', () => {
    const ivs = [{ start: 0, end: 10 }, { start: 20, end: 30 }];
    expect(inIntervals(10, ivs)).toBe(true);
    expect(inIntervals(15, ivs)).toBe(false);
  });
});

import type { Rect } from '../shared/types';

export interface Interval {
  start: number;
  end: number;
}

/** Removes every cut from base; result is sorted and non-overlapping. */
export function subtractIntervals(base: Interval, cuts: ReadonlyArray<Interval>): Interval[] {
  let pieces: Interval[] = base.end > base.start ? [base] : [];
  for (const cut of cuts) {
    const next: Interval[] = [];
    for (const piece of pieces) {
      if (cut.end <= piece.start || cut.start >= piece.end) {
        next.push(piece);
        continue;
      }
      if (cut.start > piece.start) next.push({ start: piece.start, end: cut.start });
      if (cut.end < piece.end) next.push({ start: cut.end, end: piece.end });
    }
    pieces = next;
  }
  return pieces.sort((a, b) => a.start - b.start);
}

export function inIntervals(x: number, intervals: ReadonlyArray<Interval>): boolean {
  return intervals.some((iv) => x >= iv.start && x <= iv.end);
}

/**
 * Horizontal parts of a surface's top edge (at y = edgeY, from left to right) that are
 * not hidden behind any of the occluders (rectangles stacked above it).
 */
export function visibleEdge(left: number, right: number, edgeY: number, occluders: ReadonlyArray<Rect>): Interval[] {
  const cuts: Interval[] = [];
  for (const r of occluders) {
    if (r.y <= edgeY - 1 && r.y + r.height >= edgeY - 1) cuts.push({ start: r.x, end: r.x + r.width });
  }
  return subtractIntervals({ start: left, end: right }, cuts);
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

import { SWIPE } from './config';
import { inIntervals } from './geometry';
import type { Surface } from './surfaces';

export interface Point {
  x: number;
  y: number;
}

/** Snow brushed off one spot; the caller turns it into falling chunks. */
export interface BrushHit {
  x: number;
  y: number;
  removed: number;
}

/** True when `p` is inside the visible snow pile lying on top of window `s`. */
function inPile(s: Surface, p: Point): boolean {
  if (!s.collects || !inIntervals(p.x, s.visible)) return false;
  const h = s.layer.heightAt(p.x - s.rect.x);
  if (h < SWIPE.minHeight) return false;
  return p.y >= s.rect.y - h - SWIPE.padding && p.y <= s.rect.y + SWIPE.padding;
}

/**
 * The cursor moved from `from` to `to`: every window pile it passed through loses the snow under
 * it. No speed needed — a gentle pass brushes snow off. Points are sampled along the path so
 * quick moves don't skip over a pile. `windows` must be top-most first.
 */
export function brushSnow(windows: ReadonlyArray<Surface>, from: Point | null, to: Point): BrushHit[] {
  const hits: BrushHit[] = [];
  const start = from && Math.hypot(to.x - from.x, to.y - from.y) <= SWIPE.maxSegment ? from : to;
  const length = Math.hypot(to.x - start.x, to.y - start.y);
  const steps = Math.max(1, Math.ceil(length / SWIPE.sampleStep));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = { x: start.x + (to.x - start.x) * t, y: start.y + (to.y - start.y) * t };
    const s = windows.find((w) => inPile(w, p));
    if (!s) continue;
    const lx = p.x - s.rect.x;
    const removed = s.layer.take(lx - SWIPE.radius, lx + SWIPE.radius, 0);
    if (removed > 0) hits.push({ x: p.x, y: s.rect.y - SWIPE.radius / 2, removed });
  }
  return hits;
}

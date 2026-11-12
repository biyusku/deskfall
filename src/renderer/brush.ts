import { SWIPE } from './config';
import { clamp, inIntervals } from './geometry';
import type { Surface } from './surfaces';

export interface Point {
  x: number;
  y: number;
}

/** Snow brushed off one spot; the caller flings it away as falling chunks. */
export interface BrushHit {
  x: number;
  y: number;
  removed: number;
  /** Window it came off; the chunks must not land back on it. */
  sourceId: string;
}

/** Upward kick (px/s) added to every flung chunk so it pops off before falling. */
const FLING_LIFT = 80;

/**
 * Velocity (px/s) for snow brushed by a cursor moving from `last` to `to`: along the cursor's
 * direction, faster for faster moves, never slower than SWIPE.minThrow, plus a small upward pop.
 */
export function flingVelocity(
  last: (Point & { t: number }) | null,
  to: Point,
  now: number,
): { vx: number; vy: number } {
  if (!last) return { vx: 0, vy: -SWIPE.minThrow };
  const dx = to.x - last.x;
  const dy = to.y - last.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { vx: 0, vy: -SWIPE.minThrow };
  const pxPerMs = distance / Math.max(1, now - last.t);
  const speed = clamp(pxPerMs * SWIPE.throwFactor, SWIPE.minThrow, SWIPE.maxThrow);
  return { vx: (dx / distance) * speed, vy: (dy / distance) * speed - FLING_LIFT };
}

/** True when `p` is inside the visible snow pile lying on top of window `s`. */
function inPile(s: Surface, p: Point): boolean {
  if (!s.collects || !inIntervals(p.x, s.visible)) return false;
  const h = s.layer.heightAt(p.x - s.rect.x);
  if (h < SWIPE.minHeight) return false;
  return p.y >= s.rect.y - h - SWIPE.padding && p.y <= s.rect.y + SWIPE.padding;
}

/**
 * The cursor moved from `from` to `to`: only the snow it actually passed through is cleared
 * (SWIPE.radius on each side of the path). No speed needed — a gentle pass works. Points are
 * sampled along the path so quick moves don't skip. `windows` must be top-most first.
 */
export function brushSnow(windows: ReadonlyArray<Surface>, from: Point | null, to: Point): BrushHit[] {
  const hits: BrushHit[] = [];
  const start = from && Math.hypot(to.x - from.x, to.y - from.y) <= SWIPE.maxSegment ? from : to;
  const length = Math.hypot(to.x - start.x, to.y - start.y);
  const steps = Math.max(1, Math.ceil(length / SWIPE.sampleStep));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = { x: start.x + (to.x - start.x) * t, y: start.y + (to.y - start.y) * t };
    const s = windows.find((w) => inPile(w, p));
    if (!s) continue;
    const lx = p.x - s.rect.x;
    const top = s.rect.y - s.layer.heightAt(lx);
    const removed = s.layer.take(lx - SWIPE.radius, lx + SWIPE.radius, 0);
    if (removed > 0) hits.push({ x: p.x, y: (top + s.rect.y) / 2, removed, sourceId: s.id });
  }
  return hits;
}

import { SWIPE } from './config';
import { inIntervals } from './geometry';
import type { Surface } from './surfaces';

export interface Point {
  x: number;
  y: number;
}

/** True when `p` is inside the visible snow pile lying on top of window `s`. */
function inPile(s: Surface, p: Point): boolean {
  if (!s.collects || !inIntervals(p.x, s.visible)) return false;
  const h = s.layer.heightAt(p.x - s.rect.x);
  if (h < SWIPE.minHeight) return false;
  return p.y >= s.rect.y - h - SWIPE.padding && p.y <= s.rect.y + SWIPE.padding;
}

/**
 * The cursor moved from `from` to `to`: returns every window whose snow pile it touched (top-most
 * first, each once). No speed needed — a gentle touch counts. Points are sampled along the path so
 * quick moves don't skip over a pile. The caller knocks the whole pile off those windows.
 */
export function touchedPiles(windows: ReadonlyArray<Surface>, from: Point | null, to: Point): Surface[] {
  const touched: Surface[] = [];
  const start = from && Math.hypot(to.x - from.x, to.y - from.y) <= SWIPE.maxSegment ? from : to;
  const length = Math.hypot(to.x - start.x, to.y - start.y);
  const steps = Math.max(1, Math.ceil(length / SWIPE.sampleStep));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = { x: start.x + (to.x - start.x) * t, y: start.y + (to.y - start.y) * t };
    const s = windows.find((w) => inPile(w, p));
    if (s && !touched.includes(s)) touched.push(s);
  }
  return touched;
}

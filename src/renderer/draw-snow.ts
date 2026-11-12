import { LAYER } from './config';
import type { Surface } from './surfaces';

const CAP_TOP = '#ffffff';
const CAP_MID = '#f1f5fb';
const CAP_BOTTOM = '#cfdbea';
const HIGHLIGHT = 'rgba(255,255,255,0.95)';
const SHADOW_DEPTH = 5;
/** Windows 11 window corner radius (px). */
const WINDOW_CORNER = 8;
/** How far the snow hangs over a window's side, at most. */
const MAX_DRAPE = 6;
/** Gaussian smoothing weights over neighbouring columns: makes a soft blanket instead of spikes. */
const SMOOTH_KERNEL = [0.05, 0.09, 0.14, 0.17, 0.18, 0.17, 0.14, 0.09, 0.05] as const;
const SMOOTH_HALF = (SMOOTH_KERNEL.length - 1) / 2;

interface Run {
  from: number;
  to: number;
}

/** Column heights blurred for drawing (simulation keeps its own raw values). */
export function smoothHeights(s: Surface): Float32Array {
  const n = s.layer.columns;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let weight = 0;
    for (let k = -SMOOTH_HALF; k <= SMOOTH_HALF; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const w = SMOOTH_KERNEL[k + SMOOTH_HALF];
      sum += s.layer.heightOf(j) * w;
      weight += w;
    }
    out[i] = weight > 0 ? sum / weight : 0;
  }
  return out;
}

function runsOf(h: Float32Array): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let i = 0; i < h.length; i++) {
    const has = h[i] > LAYER.minVisibleHeight;
    if (has && start < 0) start = i;
    if (!has && start >= 0) {
      runs.push({ from: start, to: i - 1 });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ from: start, to: h.length - 1 });
  return runs;
}

interface Geometry {
  s: Surface;
  h: Float32Array;
  px: (i: number) => number;
  py: (i: number) => number;
}

function traceTopCurve(ctx: CanvasRenderingContext2D, g: Geometry, run: Run): void {
  for (let i = run.from; i < run.to; i++) {
    ctx.quadraticCurveTo(g.px(i), g.py(i), (g.px(i) + g.px(i + 1)) / 2, (g.py(i) + g.py(i + 1)) / 2);
  }
  ctx.lineTo(g.px(run.to), g.py(run.to));
}

/**
 * One pile outline. Ends that reach a window edge wrap over the rounded corner and hang a little
 * down the side (draped blanket); ends in the middle of an edge taper softly into the surface.
 */
function tracePile(ctx: CanvasRenderingContext2D, g: Geometry, run: Run): void {
  const { s, h } = g;
  const top = s.rect.y;
  const left = s.rect.x;
  const right = s.rect.x + s.rect.width;
  const half = LAYER.columnWidth / 2;
  const isWindow = s.kind === 'window';
  const wrapsLeft = isWindow && run.from === 0;
  const wrapsRight = isWindow && run.to === h.length - 1;
  const corner = Math.min(WINDOW_CORNER, s.rect.width / 4);

  // Left end.
  if (wrapsLeft) {
    const drape = top + Math.min(MAX_DRAPE, corner * 0.4 + h[run.from] * 0.35);
    ctx.moveTo(left - 1, drape);
    ctx.quadraticCurveTo(left - 1.5, g.py(run.from), g.px(run.from) + 1, g.py(run.from));
  } else {
    ctx.moveTo(g.px(run.from) - half * 3, top + 0.5);
    ctx.quadraticCurveTo(g.px(run.from) - half, g.py(run.from), g.px(run.from), g.py(run.from));
  }

  traceTopCurve(ctx, g, run);

  // Right end, then back along the underside, which hugs the window's rounded corners.
  if (wrapsRight) {
    const drape = top + Math.min(MAX_DRAPE, corner * 0.4 + h[run.to] * 0.35);
    ctx.quadraticCurveTo(right + 1.5, g.py(run.to), right + 1, drape);
    ctx.quadraticCurveTo(right + 0.5, top + 0.5, right - corner, top + 0.5);
  } else {
    ctx.quadraticCurveTo(g.px(run.to) + half, g.py(run.to), g.px(run.to) + half * 3, top + 0.5);
  }
  if (wrapsLeft) {
    ctx.lineTo(left + corner, top + 0.5);
    const drape = top + Math.min(MAX_DRAPE, corner * 0.4 + h[run.from] * 0.35);
    ctx.quadraticCurveTo(left - 0.5, top + 0.5, left - 1, drape);
  }
  ctx.closePath();
}

function drawShadow(ctx: CanvasRenderingContext2D, g: Geometry, runs: Run[]): void {
  const { s } = g;
  const shadow = ctx.createLinearGradient(0, s.rect.y, 0, s.rect.y + SHADOW_DEPTH);
  shadow.addColorStop(0, 'rgba(10,25,55,0.2)');
  shadow.addColorStop(1, 'rgba(10,25,55,0)');
  ctx.fillStyle = shadow;
  for (const run of runs) {
    const x0 = Math.max(g.px(run.from), s.rect.x + WINDOW_CORNER / 2);
    const x1 = Math.min(g.px(run.to), s.rect.x + s.rect.width - WINDOW_CORNER / 2);
    if (x1 > x0) ctx.fillRect(x0, s.rect.y + 0.5, x1 - x0, SHADOW_DEPTH);
  }
}

/** Draws the snow pile lying on a surface's top edge. */
export function drawSnowCap(ctx: CanvasRenderingContext2D, s: Surface): void {
  const h = smoothHeights(s);
  const runs = runsOf(h);
  if (runs.length === 0) return;
  const g: Geometry = {
    s,
    h,
    px: (i) => s.rect.x + s.layer.columnX(i),
    py: (i) => s.rect.y - h[i],
  };

  drawShadow(ctx, g, runs);

  const fill = ctx.createLinearGradient(0, s.rect.y - s.layer.maxHeight, 0, s.rect.y + MAX_DRAPE);
  fill.addColorStop(0, CAP_TOP);
  fill.addColorStop(0.55, CAP_MID);
  fill.addColorStop(1, CAP_BOTTOM);
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (const run of runs) tracePile(ctx, g, run);
  ctx.fill();

  ctx.strokeStyle = HIGHLIGHT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const run of runs) {
    ctx.moveTo(g.px(run.from), g.py(run.from));
    traceTopCurve(ctx, g, run);
  }
  ctx.stroke();
}

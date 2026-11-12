import { GARLAND } from './config';

export interface Sprites {
  dot: HTMLCanvasElement;
  crystal: HTMLCanvasElement;
  glows: HTMLCanvasElement[];
  headlight: HTMLCanvasElement;
}

const DOT_SIZE = 32;
const CRYSTAL_SIZE = 40;
const ARMS = 6;

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function makeDot(): HTMLCanvasElement {
  const [c, ctx] = canvas(DOT_SIZE);
  const g = ctx.createRadialGradient(DOT_SIZE / 2, DOT_SIZE / 2, 0, DOT_SIZE / 2, DOT_SIZE / 2, DOT_SIZE / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.55, 'rgba(235,244,255,0.35)');
  g.addColorStop(1, 'rgba(220,235,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, DOT_SIZE, DOT_SIZE);
  return c;
}

function makeCrystal(): HTMLCanvasElement {
  const [c, ctx] = canvas(CRYSTAL_SIZE);
  const mid = CRYSTAL_SIZE / 2;
  const r = CRYSTAL_SIZE * 0.42;
  ctx.translate(mid, mid);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(200,225,255,0.9)';
  ctx.shadowBlur = 3;
  ctx.lineWidth = 1.6;
  for (let i = 0; i < ARMS; i++) {
    ctx.save();
    ctx.rotate((i / ARMS) * Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r);
    for (const [pos, len] of [
      [0.45, 0.28],
      [0.7, 0.2],
    ] as const) {
      ctx.moveTo(0, -r * pos);
      ctx.lineTo(-r * len, -r * pos - r * len);
      ctx.moveTo(0, -r * pos);
      ctx.lineTo(r * len, -r * pos - r * len);
    }
    ctx.stroke();
    ctx.restore();
  }
  return c;
}

function makeGlow(color: string): HTMLCanvasElement {
  const size = GARLAND.glowSize;
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.25, `${color}aa`);
  g.addColorStop(1, `${color}00`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function makeHeadlight(): HTMLCanvasElement {
  const size = 64;
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(4, size / 2, 0, 4, size / 2, size);
  g.addColorStop(0, 'rgba(255,240,180,0.55)');
  g.addColorStop(1, 'rgba(255,240,180,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, size / 2 - 3);
  ctx.lineTo(size, size * 0.15);
  ctx.lineTo(size, size * 0.85);
  ctx.lineTo(0, size / 2 + 3);
  ctx.closePath();
  ctx.fill();
  return c;
}

export function createSprites(): Sprites {
  return {
    dot: makeDot(),
    crystal: makeCrystal(),
    glows: GARLAND.colors.map(makeGlow),
    headlight: makeHeadlight(),
  };
}

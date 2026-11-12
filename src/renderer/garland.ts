import { GARLAND } from './config';
import type { Sprites } from './sprites';
import type { Surface } from './surfaces';

const WIRE_COLOR = 'rgba(30,45,30,0.85)';
const CHASE_PERIOD = 14;
const CHASE_DURATION = 5;

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100_000;
  return h;
}

function wireY(top: number, x: number, left: number): number {
  const t = (((x - left) % GARLAND.span) + GARLAND.span) % GARLAND.span / GARLAND.span;
  return top + 2 + GARLAND.sag * 4 * t * (1 - t);
}

/** Brightness 0..1 of a bulb; alternates between twinkling and a running chase. */
function brightness(time: number, index: number, seed: number): number {
  const cycle = (time + seed) % CHASE_PERIOD;
  if (cycle < CHASE_DURATION) {
    const head = (cycle * 18) % 6;
    return (index % 6) === Math.floor(head) ? 1 : 0.35;
  }
  return 0.55 + 0.45 * Math.sin(time * (1.5 + hash(index + seed) * 2.5) + hash(index * 7 + seed) * 6.28);
}

/** Christmas-light string hanging just below a window's top edge. */
export function drawGarland(ctx: CanvasRenderingContext2D, s: Surface, sprites: Sprites, time: number): void {
  if (s.rect.width < GARLAND.minWidth || s.rect.y < -GARLAND.sag) return;
  const left = s.rect.x + 6;
  const right = s.rect.x + s.rect.width - 6;
  const top = s.rect.y;
  const seed = seedOf(s.id);

  ctx.strokeStyle = WIRE_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, wireY(top, left, left));
  for (let x = left + 3; x <= right; x += 3) ctx.lineTo(x, wireY(top, x, left));
  ctx.stroke();

  let index = 0;
  for (let x = left + GARLAND.bulbSpacing / 2; x < right; x += GARLAND.bulbSpacing, index++) {
    const y = wireY(top, x, left) + 2.5;
    const colorIndex = index % GARLAND.colors.length;
    const b = brightness(time, index, seed);
    const glowSize = GARLAND.glowSize * (0.7 + b * 0.5);
    ctx.globalAlpha = 0.25 + b * 0.75;
    ctx.drawImage(sprites.glows[colorIndex], x - glowSize / 2, y - glowSize / 2, glowSize, glowSize);
    ctx.globalAlpha = 0.6 + b * 0.4;
    ctx.fillStyle = GARLAND.colors[colorIndex];
    ctx.beginPath();
    ctx.ellipse(x, y, GARLAND.bulbRadiusX, GARLAND.bulbRadiusY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5 * b;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - 0.6, y - 1, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

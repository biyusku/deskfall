import { CRUMBS } from './config';
import { rand } from './geometry';
import type { ShedEvent, SurfaceSet } from './surfaces';

interface Crumb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Surface the chunk was knocked off; it must not land back on it. */
  skipId: string | null;
}

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
}

const SPARKLE_GRAVITY = 160;
const PUFF_LIFE = 1.4;
const CRUMB_VOLUME_PER_HEIGHT = 2.6;
const MAX_CRUMBS_PER_COLUMN = 3;

export class Particles {
  private crumbs: Crumb[] = [];
  private sparkles: Sparkle[] = [];
  private puffs: Puff[] = [];

  /** Turns a snow pile into falling chunks. */
  shed(event: ShedEvent): void {
    const { layer, rect } = event;
    for (let i = 0; i < layer.columns; i++) {
      const h = layer.heightOf(i);
      if (h < 0.4) continue;
      const count = Math.min(MAX_CRUMBS_PER_COLUMN, Math.ceil(h / CRUMB_VOLUME_PER_HEIGHT));
      for (let k = 0; k < count; k++) {
        this.addCrumb({
          x: rect.x + layer.columnX(i) + rand(-1, 1),
          y: rect.y - rand(0, h),
          vx: event.vx * 0.25 + rand(-30, 30),
          vy: rand(-90, 10),
          r: rand(1.2, 2.6),
          skipId: event.sourceId ?? null,
        });
      }
    }
    layer.clear();
  }

  burst(x: number, y: number, vx: number, vy: number, count: number): void {
    for (let k = 0; k < count; k++) {
      this.addCrumb({ x: x + rand(-4, 4), y: y + rand(-3, 3), vx: vx + rand(-50, 50), vy: vy + rand(-120, 0), r: rand(1, 2.6), skipId: null });
    }
  }

  get crumbCount(): number {
    return this.crumbs.length;
  }

  sparkle(x: number, y: number, count: number): void {
    for (let k = 0; k < count; k++) {
      const a = rand(0, Math.PI * 2);
      const speed = rand(40, 150);
      const maxLife = rand(0.6, 1.2);
      this.sparkles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 60, life: maxLife, maxLife, hue: rand(0, 360) });
    }
  }

  puff(x: number, y: number, dir: number): void {
    this.puffs.push({ x, y, vx: -dir * rand(8, 20), vy: rand(-28, -14), r: rand(2, 3.5), life: PUFF_LIFE });
  }

  update(dt: number, surfaces: SurfaceSet, height: number, accumulate: boolean): void {
    this.crumbs = this.crumbs.filter((c) => {
      const y0 = c.y;
      c.vy += CRUMBS.gravity * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.vx *= 1 - Math.min(1, dt * 0.8);
      if (c.vy > 0) {
        const s = surfaces.findLanding(c.x, y0, c.y, c.skipId);
        if (s) {
          if (accumulate) s.layer.deposit(c.x - s.rect.x, c.r * CRUMBS.depositPerRadius);
          return false;
        }
      }
      return c.y < height + 10;
    });
    this.sparkles = this.sparkles.filter((s) => {
      s.vy += SPARKLE_GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      return s.life > 0;
    });
    this.puffs = this.puffs.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += dt * 5;
      p.life -= dt;
      return p.life > 0;
    });
  }

  drawBehind(ctx: CanvasRenderingContext2D): void {
    for (const p of this.puffs) {
      ctx.globalAlpha = (p.life / PUFF_LIFE) * 0.35;
      ctx.fillStyle = '#cfd6e0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawFront(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#f4f8ff';
    for (const c of this.crumbs) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of this.sparkles) {
      const a = s.life / s.maxLife;
      ctx.globalAlpha = a;
      ctx.fillStyle = `hsl(${s.hue}, 90%, 80%)`;
      const size = 1.2 + a * 2;
      ctx.fillRect(s.x - size / 2, s.y - size * 1.5, size, size * 3);
      ctx.fillRect(s.x - size * 1.5, s.y - size / 2, size * 3, size);
    }
    ctx.globalAlpha = 1;
  }

  private addCrumb(crumb: Crumb): void {
    if (this.crumbs.length >= CRUMBS.max) return;
    this.crumbs.push(crumb);
  }
}

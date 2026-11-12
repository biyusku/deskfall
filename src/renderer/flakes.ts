import { FLAKES } from './config';
import { rand } from './geometry';
import type { Sprites } from './sprites';

interface Flake {
  x: number;
  y: number;
  r: number;
  speed: number;
  depth: number;
  phase: number;
  sway: number;
  swayFreq: number;
  alpha: number;
  crystal: boolean;
  rotation: number;
  spin: number;
  alive: boolean;
}

const PIXELS_PER_MEGAPIXEL = 1_000_000;

/** Called when a near flake crosses y0 -> y1; return true when it landed (flake recycles). */
export type LandingCheck = (x: number, y0: number, y1: number, flakeRadius: number) => boolean;

export class FlakeField {
  private flakes: Flake[] = [];
  private width = 0;
  private height = 0;
  private target = 0;
  /** 0..1 fade-in of the target population so snowfall starts gently. */
  private ramp = 0;

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  setDensity(perMegapixel: number, snowing: boolean): void {
    this.target = snowing ? Math.round((this.width * this.height * perMegapixel) / PIXELS_PER_MEGAPIXEL) : 0;
  }

  get count(): number {
    return this.flakes.length;
  }

  /** `floorY`: flakes disappear here (taskbar top edge) instead of falling over the taskbar. */
  step(dt: number, time: number, wind: number, land: LandingCheck, floorY: number = this.height): void {
    this.ramp = Math.min(1, this.ramp + dt * FLAKES.rampPerSecond);
    const wanted = Math.round(this.target * this.ramp);
    while (this.flakes.length < wanted) this.flakes.push(this.spawn(true));

    for (const f of this.flakes) {
      const prevY = f.y;
      const drift = wind * (0.35 + f.depth * 0.65);
      f.x += (drift + Math.sin(time * f.swayFreq + f.phase) * f.sway) * dt;
      f.y += f.speed * dt;
      f.rotation += f.spin * dt;
      if (f.x < -FLAKES.spawnMargin) f.x += this.width + FLAKES.spawnMargin * 2;
      else if (f.x > this.width + FLAKES.spawnMargin) f.x -= this.width + FLAKES.spawnMargin * 2;

      const landed = f.depth >= FLAKES.landingDepth && land(f.x, prevY, f.y, f.r);
      if (landed || f.y - f.r > floorY) f.alive = false;
    }

    let write = 0;
    for (const f of this.flakes) {
      if (f.alive) {
        this.flakes[write++] = f;
      } else if (write < wanted) {
        this.flakes[write++] = this.spawn(false);
      }
    }
    this.flakes.length = write;
  }

  draw(ctx: CanvasRenderingContext2D, sprites: Sprites): void {
    for (const f of this.flakes) {
      ctx.globalAlpha = f.alpha;
      if (f.crystal) {
        const size = f.r * 5;
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rotation);
        ctx.drawImage(sprites.crystal, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        const size = f.r * 4;
        ctx.drawImage(sprites.dot, f.x - size / 2, f.y - size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;
  }

  private spawn(anywhere: boolean): Flake {
    const depth = Math.random();
    const crystal = depth > 0.7 && Math.random() < FLAKES.crystalChance * 3;
    const r = FLAKES.minRadius + (FLAKES.maxRadius - FLAKES.minRadius) * depth * rand(0.75, 1.15);
    return {
      x: rand(-FLAKES.spawnMargin, this.width + FLAKES.spawnMargin),
      y: anywhere ? rand(-this.height * 0.6, this.height) : rand(-40, -6),
      r: crystal ? r * 1.3 : r,
      speed: FLAKES.minSpeed + (FLAKES.maxSpeed - FLAKES.minSpeed) * depth * rand(0.8, 1.2),
      depth,
      phase: rand(0, Math.PI * 2),
      sway: rand(FLAKES.swayMin, FLAKES.swayMax) * (0.4 + depth * 0.6),
      swayFreq: rand(0.6, 1.6),
      alpha: 0.35 + depth * 0.6,
      crystal,
      rotation: rand(0, Math.PI),
      spin: rand(-1, 1),
      alive: true,
    };
  }
}

/** Smoothly varying wind in px/s. */
export function windAt(time: number, base: number, gust: number): number {
  const wave = Math.sin(time * 0.11) + 0.6 * Math.sin(time * 0.29 + 1.3) + 0.3 * Math.sin(time * 0.71 + 4.1);
  return base + gust * (wave / 1.9);
}

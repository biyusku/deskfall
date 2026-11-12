import { DEFAULT_SETTINGS, type DesktopState, type DeskfallBridge, type OverlayCommand, type Rect, type Settings } from '../shared/types';
import { touchedPiles } from './brush';
import { FLAKES, LAYER, SWIPE, WIND } from './config';
import { drawSnowCap } from './draw-snow';
import { clamp } from './geometry';
import { FlakeField, windAt } from './flakes';
import { drawGarland } from './garland';
import { Particles } from './particles';
import { Snowplow } from './plow';
import { SnowmanWorld, type Cursor } from './snowman';
import { createSprites } from './sprites';
import { SurfaceSet, type Surface } from './surfaces';

declare global {
  interface Window {
    deskfall: DeskfallBridge;
  }
}

const MAX_FRAME_SECONDS = 0.05;
const TARGET_FPS = 30;
/** Small slack so a 60 Hz display reliably draws every second vsync. */
const FRAME_SLACK_MS = 3;
const MIN_FRAME_MS = 1000 / TARGET_FPS - FRAME_SLACK_MS;
const RESUME_QUIET_MS = 600;

class Overlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = createSprites();
  private readonly surfaces = new SurfaceSet();
  private readonly flakes = new FlakeField();
  private readonly particles = new Particles();
  private readonly plow = new Snowplow();
  private readonly snowmen = new SnowmanWorld();
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private display: Rect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  private cursor: Cursor | null = null;
  private lastPointer = { x: 0, y: 0, t: 0 };
  private interactive = false;
  private lastFrame = performance.now();
  private lastError = '';
  /** False while this screen is paused (maximized window / hidden): no simulation, no drawing. */
  private running = true;
  private frameScheduled = false;
  /** Latest desktop state received while paused; applied on resume. */
  private pendingDesktop: DesktopState | null = null;
  /** Until this time desktop updates never shed snow (just resumed from a pause). */
  private quietUntil = 0;

  constructor() {
    const canvas = document.getElementById('snow');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('canvas missing');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindPointer();
    this.bindBridge();
    window.addEventListener('error', (e) => this.reportError(e.error ?? e.message));
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (this.frameScheduled) return;
    this.frameScheduled = true;
    requestAnimationFrame(() => {
      this.frameScheduled = false;
      this.frame();
    });
  }

  private setRunning(running: boolean): void {
    if (running === this.running) return;
    this.running = running;
    if (!running) {
      this.setInteractive(false);
      return;
    }
    // Window changes that happened while paused (e.g. un-maximizing) must not shake snow off.
    this.quietUntil = performance.now() + RESUME_QUIET_MS;
    if (this.pendingDesktop) this.applyDesktop(this.pendingDesktop);
    this.pendingDesktop = null;
    this.lastFrame = performance.now();
    this.scheduleFrame();
  }

  private applyDesktop(state: DesktopState): void {
    const now = performance.now();
    const sheds = this.surfaces.update(state, this.display, now, now >= this.quietUntil);
    sheds.forEach((shed) => this.particles.shed(shed));
  }

  private bindBridge(): void {
    const bridge = window.deskfall;
    bridge.onInit((init) => {
      this.display = init.bounds;
      this.resize();
    });
    bridge.onSettings((settings) => {
      this.settings = settings;
      this.applyDensity();
      if (!settings.play) this.setInteractive(false);
    });
    bridge.onDesktop((state) => {
      if (this.running) this.applyDesktop(state);
      else this.pendingDesktop = state;
    });
    bridge.onCommand((command) => this.runCommand(command));
    bridge.onRunning((running) => this.setRunning(running));
    bridge.ready();
  }

  private runCommand(command: OverlayCommand): void {
    if (command === 'clear-snow') {
      this.surfaces.forEachLayer((s) => s.layer.clear());
      this.snowmen.clear();
    } else if (command === 'shake-all') {
      this.surfaces.windows.forEach((s) => this.particles.shed({ rect: s.rect, layer: s.layer, vx: 0, sourceId: s.id }));
    } else if (command === 'call-plow' && this.surfaces.floor) {
      this.plow.start(this.surfaces.floor);
    }
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.flakes.resize(w, h);
    this.applyDensity();
  }

  private applyDensity(): void {
    this.flakes.setDensity(FLAKES.perMegapixel[this.settings.intensity], this.settings.snowing);
  }

  // ----- pointer -----

  private bindPointer(): void {
    window.addEventListener('mousemove', (e) => this.onMove(e.clientX, e.clientY));
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const floor = this.surfaces.floor;
      if (floor && this.overPlow(e.clientX, e.clientY)) {
        this.plow.shoo(floor);
      } else if (this.settings.play) {
        this.snowmen.pointerDown(e.clientX, e.clientY, floor, performance.now());
      }
      this.updateInteractive(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', (e) => {
      this.snowmen.pointerUp(this.surfaces.floor, performance.now(), this.particles);
      this.updateInteractive(e.clientX, e.clientY);
    });
    window.addEventListener('dblclick', (e) => {
      if (this.settings.play) this.snowmen.doubleClick(e.clientX, e.clientY, this.surfaces.floor, this.particles);
    });
    document.addEventListener('mouseleave', () => {
      this.cursor = null;
    });
  }

  private onMove(x: number, y: number): void {
    const now = performance.now();
    this.cursor = { x, y };
    if (this.settings.play) {
      this.snowmen.pointerMove(x, y, this.surfaces.floor);
      this.swipe(x, y, now);
    }
    this.lastPointer = { x, y, t: now };
    this.updateInteractive(x, y);
  }

  /** Touching a window's snow — even gently — knocks the whole pile off, thrown the way you moved. */
  private swipe(x: number, y: number, now: number): void {
    if (this.snowmen.busy) return;
    const last = this.lastPointer.t > 0 ? this.lastPointer : null;
    const touched = touchedPiles(this.surfaces.windows, last, { x, y });
    if (touched.length === 0) return;
    const dt = last ? Math.max(1, now - last.t) : 16;
    const throwX = last ? clamp(((x - last.x) / dt) * SWIPE.throwFactor, -SWIPE.maxThrow, SWIPE.maxThrow) : 0;
    for (const s of touched) this.particles.shed({ rect: { ...s.rect }, layer: s.layer, vx: throwX, sourceId: s.id });
  }

  /** The plow can be clicked away unless you're in the middle of rolling/carrying a snowball. */
  private overPlow(x: number, y: number): boolean {
    return !this.snowmen.busy && !this.plow.leaving && this.plow.hitTest(x, y, this.surfaces.floor);
  }

  private updateInteractive(x: number, y: number): void {
    const onPlow = this.overPlow(x, y);
    const onSnow = this.settings.play && this.snowmen.wantsPointer(x, y, this.surfaces.floor);
    const want = onPlow || onSnow;
    if (want !== this.interactive) this.setInteractive(want);
    document.body.style.cursor = this.cursorFor(onPlow, onSnow);
  }

  private cursorFor(onPlow: boolean, onSnow: boolean): string {
    if (this.snowmen.holding) return 'grabbing';
    if (onPlow) return 'pointer';
    return onSnow ? 'grab' : 'default';
  }

  private setInteractive(value: boolean): void {
    this.interactive = value;
    window.deskfall.setInteractive(value);
  }

  // ----- simulation -----

  private frame(): void {
    // Paused screens stop here: no new frame is requested until setRunning(true).
    if (!this.running) return;
    // Schedule first so a single bad frame can never stop the animation.
    this.scheduleFrame();
    // performance.now() (not the rAF timestamp) so it shares a clock with pointer handlers.
    const now = performance.now();
    // Snow looks the same at 30 fps; skipping frames leaves the canvas untouched, so the GPU idles too.
    if (now - this.lastFrame < MIN_FRAME_MS) return;
    const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const time = now / 1000;
    try {
      this.step(dt, time, now);
      this.draw(time, now);
    } catch (err: unknown) {
      this.reportError(err);
      this.ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      this.ctx.globalAlpha = 1;
    }
  }

  private reportError(err: unknown): void {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    if (message === this.lastError) return;
    this.lastError = message;
    window.deskfall.reportError(message);
  }

  private step(dt: number, time: number, now: number): void {
    const s = this.settings;
    const wind = windAt(time, WIND.base[s.wind], WIND.gust[s.wind]);
    const deposit = LAYER.flakeDeposit * FLAKES.depositScale[s.intensity];
    this.flakes.step(dt, time, wind, (x, y0, y1, r) => {
      const surface = this.surfaces.findLanding(x, y0, y1);
      if (!surface) return false;
      if (s.accumulate) surface.layer.deposit(x - surface.rect.x, deposit * (0.5 + r / FLAKES.maxRadius));
      return true;
    }, this.floorTop());
    const melting = !s.snowing || !s.accumulate;
    this.surfaces.forEachLayer((surface) => {
      surface.layer.relax();
      if (melting) surface.layer.melt(LAYER.meltPerSecond * dt);
    });
    this.particles.update(dt, this.surfaces, this.display.height, s.accumulate);
    this.plow.update(dt, this.surfaces.floor, this.snowmen.obstacles(), s.plow, this.particles);
    this.snowmen.update(dt, now, this.cursor);
  }

  private draw(time: number, now: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Bottom-most window first; each window erases whatever lies behind it.
    // Falling snow first: each window below then erases the flakes behind it, so snow falls on
    // the desktop and lands on window tops instead of drifting over tabs and content.
    this.aboveFloor(() => this.flakes.draw(ctx, this.sprites));
    for (let i = this.surfaces.windows.length - 1; i >= 0; i--) {
      const s = this.surfaces.windows[i];
      ctx.clearRect(s.rect.x, s.rect.y, s.rect.width, s.rect.height);
      if (this.wantsGarland(s)) drawGarland(ctx, s, this.sprites, time);
      if (s.collects) drawSnowCap(ctx, s);
    }
    const floor = this.surfaces.floor;
    if (floor) {
      if (floor.kind === 'bar') ctx.clearRect(floor.rect.x, floor.rect.y, floor.rect.width, floor.rect.height);
      this.particles.drawBehind(ctx);
      drawSnowCap(ctx, floor);
      this.plow.draw(ctx, floor, this.sprites, time);
      this.snowmen.draw(ctx, floor, time, now, this.cursor);
    }
    // Chunks knocked off windows and sparkles stay in front, so you can see them tumble.
    this.aboveFloor(() => this.particles.drawFront(ctx));
  }

  /** Nothing falls over the (possibly transparent) taskbar: clips to above its top edge. */
  private aboveFloor(drawFn: () => void): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.display.width, this.floorTop());
    ctx.clip();
    try {
      drawFn();
    } finally {
      ctx.restore();
    }
  }

  /** Top edge of the taskbar, or the screen bottom when there is none. */
  private floorTop(): number {
    const floor = this.surfaces.floor;
    return floor && floor.kind === 'bar' ? floor.rect.y : this.display.height;
  }

  private wantsGarland(s: Surface): boolean {
    const mode = this.settings.garland;
    if (mode === 'off') return false;
    return mode === 'all' || s.id === this.surfaces.foregroundId;
  }
}

new Overlay();

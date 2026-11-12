import type { DesktopState, Rect } from '../shared/types';
import { CRUMBS, LAYER } from './config';
import { inIntervals, rectsIntersect, visibleEdge, type Interval } from './geometry';
import { SnowLayer, type LayerOptions } from './snow-layer';

export type SurfaceKind = 'window' | 'bar' | 'ground';

export interface Surface {
  id: string;
  kind: SurfaceKind;
  /** Local (overlay) coordinates. */
  rect: Rect;
  layer: SnowLayer;
  /** Visible parts of the top edge, local x. */
  visible: Interval[];
  /** Whether flakes can land here (top edge is inside the overlay). */
  collects: boolean;
}

/** A pile of snow that should fall off (window moved fast, closed or minimized). */
export interface ShedEvent {
  rect: Rect;
  layer: SnowLayer;
  vx: number;
  /** Window the snow came off; its chunks never land back on it. */
  sourceId?: string;
}

const BAR_ID = '__bar__';
const GROUND_ID = '__ground__';
const MIN_TOP_FOR_SNOW = 3;

function layerOptions(kind: SurfaceKind): LayerOptions {
  const maxHeight = { window: LAYER.windowMaxHeight, bar: LAYER.barMaxHeight, ground: LAYER.groundMaxHeight }[kind];
  return {
    columnWidth: LAYER.columnWidth,
    maxHeight,
    overhang: kind === 'window' ? LAYER.overhang : 0,
    edgeCapacity: kind === 'window' ? LAYER.edgeCapacity : 1,
    overhangTipCapacity: LAYER.overhangTipCapacity,
    maxSlope: LAYER.maxSlope,
  };
}

function toLocal(rect: Rect, display: Rect): Rect {
  return { x: rect.x - display.x, y: rect.y - display.y, width: rect.width, height: rect.height };
}

export class SurfaceSet {
  /** Windows top-most first. */
  windows: Surface[] = [];
  /** Taskbar on this display, or the screen bottom when there is none. */
  floor: Surface | null = null;
  foregroundId = '';
  private lastUpdate = 0;

  /**
   * Applies a new desktop snapshot. Returns piles that should crumble away.
   * With `canShed: false` (resuming after a pause) windows keep their snow however far they
   * moved, because nobody saw them move.
   */
  update(state: DesktopState, display: Rect, now: number, canShed = true): ShedEvent[] {
    const dt = Math.max(0.016, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;
    this.foregroundId = state.foregroundId;
    const localDisplay: Rect = { x: 0, y: 0, width: display.width, height: display.height };
    const previous = new Map(this.windows.map((s) => [s.id, s]));
    const sheds: ShedEvent[] = [];
    const next: Surface[] = [];

    for (const w of state.windows) {
      const rect = toLocal(w.rect, display);
      if (!rectsIntersect(rect, localDisplay)) continue;
      const old = previous.get(w.id);
      previous.delete(w.id);
      next.push(this.carryOver(w.id, rect, old, dt, canShed ? sheds : null));
    }
    previous.forEach((gone) => {
      if (canShed && gone.layer.totalVolume() > 0) sheds.push({ rect: gone.rect, layer: gone.layer, vx: 0 });
    });

    this.windows = next;
    this.updateFloor(state.bars, display);
    this.computeVisibility(localDisplay);
    return sheds;
  }

  /** All surfaces flakes may land on, top-most first. */
  landingOrder(): Surface[] {
    return this.floor ? [this.floor, ...this.windows] : this.windows;
  }

  /** Finds the surface a particle moving from y0 to y1 at x lands on, if any. */
  findLanding(x: number, y0: number, y1: number, skipId: string | null = null): Surface | null {
    for (const s of this.landingOrder()) {
      if (!s.collects || s.id === skipId) continue;
      const lx = x - s.rect.x;
      if (lx < -s.layer.overhang || lx > s.rect.width + s.layer.overhang) continue;
      const surfaceY = s.rect.y - s.layer.heightAt(lx);
      if (y0 <= surfaceY && y1 >= surfaceY && inIntervals(x, s.visible)) return s;
    }
    return null;
  }

  forEachLayer(fn: (s: Surface) => void): void {
    this.windows.forEach(fn);
    if (this.floor) fn(this.floor);
  }

  private carryOver(id: string, rect: Rect, old: Surface | undefined, dt: number, sheds: ShedEvent[] | null): Surface {
    if (!old) {
      const layer = new SnowLayer(rect.width, layerOptions('window'));
      return { id, kind: 'window', rect, layer, visible: [], collects: false };
    }
    const dx = rect.x - old.rect.x;
    const dy = rect.y - old.rect.y;
    const distance = Math.hypot(dx, dy);
    const isFastMove = distance / dt > CRUMBS.shedSpeed || distance > CRUMBS.shedDistance;
    if (sheds && distance > 0 && isFastMove && old.layer.totalVolume() > 0) {
      sheds.push({ rect: { ...old.rect }, layer: old.layer, vx: dx / dt, sourceId: id });
      old.layer = new SnowLayer(old.rect.width, layerOptions('window'));
    }
    old.layer.resize(rect.width);
    old.rect = rect;
    return old;
  }

  private updateFloor(bars: ReadonlyArray<Rect>, display: Rect): void {
    const local = bars
      .map((b) => toLocal(b, display))
      .find((b) => b.y > 0 && b.y < display.height && b.x < display.width / 2 && b.x + b.width > display.width / 2);
    const rect: Rect = local ?? { x: 0, y: display.height, width: display.width, height: 0 };
    const kind: SurfaceKind = local ? 'bar' : 'ground';
    const id = local ? BAR_ID : GROUND_ID;
    if (!this.floor || this.floor.id !== id) {
      this.floor = { id, kind, rect, layer: new SnowLayer(rect.width, layerOptions(kind)), visible: [], collects: true };
      return;
    }
    this.floor.layer.resize(rect.width);
    this.floor.rect = rect;
  }

  private computeVisibility(display: Rect): void {
    const floorRect = this.floor && this.floor.kind === 'bar' ? [this.floor.rect] : [];
    const occluders: Rect[] = [...floorRect];
    for (const s of this.windows) {
      const left = s.rect.x - s.layer.overhang;
      const right = s.rect.x + s.rect.width + s.layer.overhang;
      s.visible = visibleEdge(left, right, s.rect.y, occluders);
      s.collects = s.rect.y >= MIN_TOP_FOR_SNOW && s.rect.y < display.height && s.visible.length > 0;
      occluders.push(s.rect);
    }
    if (this.floor) this.floor.visible = [{ start: this.floor.rect.x, end: this.floor.rect.x + this.floor.rect.width }];
  }
}

export interface LayerOptions {
  columnWidth: number;
  maxHeight: number;
  /** Extra px of snow beyond each side of the surface. */
  overhang: number;
  edgeCapacity: number;
  overhangTipCapacity: number;
  maxSlope: number;
}

const NEIGHBOR_SHARE = 0.5;
const SPILL_JITTER = 0.15;

/**
 * Column height map of snow lying on a horizontal edge. Local x runs from
 * -overhang to width + overhang; 0 is the left edge of the surface.
 */
export class SnowLayer {
  private heights: Float32Array;
  private capacity: Float32Array;

  constructor(
    private surfaceWidth: number,
    private readonly opts: LayerOptions,
  ) {
    this.heights = new Float32Array(this.countFor(surfaceWidth));
    this.capacity = this.buildCapacity(surfaceWidth);
  }

  get width(): number {
    return this.surfaceWidth;
  }

  get columns(): number {
    return this.heights.length;
  }

  get overhang(): number {
    return this.opts.overhang;
  }

  get maxHeight(): number {
    return this.opts.maxHeight;
  }

  columnX(index: number): number {
    return -this.opts.overhang + (index + 0.5) * this.opts.columnWidth;
  }

  heightOf(index: number): number {
    return this.heights[index] ?? 0;
  }

  indexAt(x: number): number {
    return Math.floor((x + this.opts.overhang) / this.opts.columnWidth);
  }

  /** Linearly interpolated surface height at local x. */
  heightAt(x: number): number {
    const pos = (x + this.opts.overhang) / this.opts.columnWidth - 0.5;
    const i = Math.floor(pos);
    const t = pos - i;
    return this.heightOf(i) * (1 - t) + this.heightOf(i + 1) * t;
  }

  /** Adds snow around x. Returns the amount that actually stuck. */
  deposit(x: number, amount: number): number {
    const i = this.indexAt(x);
    if (i < 0 || i >= this.columns) return 0;
    let stuck = this.addTo(i, amount);
    const side = amount * NEIGHBOR_SHARE * (1 + (Math.random() - 0.5) * SPILL_JITTER);
    stuck += this.addTo(i - 1, side);
    stuck += this.addTo(i + 1, side);
    return stuck;
  }

  /** Removes snow above `keep` between local x0..x1, at most `limit` in total. Returns removed volume. */
  take(x0: number, x1: number, keep: number, limit: number = Number.POSITIVE_INFINITY): number {
    const from = Math.max(0, this.indexAt(Math.min(x0, x1)));
    const to = Math.min(this.columns - 1, this.indexAt(Math.max(x0, x1)));
    let removed = 0;
    for (let i = from; i <= to && removed < limit; i++) {
      const excess = this.heights[i] - keep;
      if (excess <= 0) continue;
      const amount = Math.min(excess, limit - removed);
      this.heights[i] -= amount;
      removed += amount;
    }
    return removed;
  }

  /** Lets steep steps slump sideways so piles look like snow, not spikes. */
  relax(): void {
    const h = this.heights;
    const slope = this.opts.maxSlope;
    for (let i = 0; i + 1 < h.length; i++) {
      const diff = h[i] - h[i + 1];
      if (Math.abs(diff) <= slope) continue;
      const move = (Math.abs(diff) - slope) / 2;
      const [hi, lo] = diff > 0 ? [i, i + 1] : [i + 1, i];
      const room = Math.max(0, this.capacity[lo] - h[lo]);
      const moved = Math.min(move, room);
      h[hi] -= move;
      h[lo] += moved;
    }
  }

  melt(amount: number): void {
    for (let i = 0; i < this.heights.length; i++) this.heights[i] = Math.max(0, this.heights[i] - amount);
  }

  clear(): void {
    this.heights.fill(0);
  }

  totalVolume(): number {
    let sum = 0;
    for (const v of this.heights) sum += v;
    return sum;
  }

  peakHeight(): number {
    let peak = 0;
    for (const v of this.heights) peak = Math.max(peak, v);
    return peak;
  }

  averageHeight(): number {
    return this.columns === 0 ? 0 : this.totalVolume() / this.columns;
  }

  resize(newWidth: number): void {
    if (newWidth === this.surfaceWidth) return;
    const old = this.heights;
    const next = new Float32Array(this.countFor(newWidth));
    const ratio = old.length / Math.max(1, next.length);
    for (let i = 0; i < next.length; i++) next[i] = old[Math.min(old.length - 1, Math.floor(i * ratio))] ?? 0;
    this.surfaceWidth = newWidth;
    this.heights = next;
    this.capacity = this.buildCapacity(newWidth);
    for (let i = 0; i < next.length; i++) next[i] = Math.min(next[i], this.capacity[i]);
  }

  private addTo(i: number, amount: number): number {
    if (i < 0 || i >= this.columns) return 0;
    const room = this.capacity[i] - this.heights[i];
    if (room <= 0) return 0;
    const added = Math.min(room, amount);
    this.heights[i] += added;
    return added;
  }

  private countFor(width: number): number {
    return Math.max(1, Math.ceil((width + this.opts.overhang * 2) / this.opts.columnWidth));
  }

  private buildCapacity(width: number): Float32Array {
    const count = this.countFor(width);
    const cap = new Float32Array(count);
    const { overhang, maxHeight, edgeCapacity, overhangTipCapacity } = this.opts;
    const rampLength = Math.max(overhang * 2, this.opts.columnWidth * 4);
    for (let i = 0; i < count; i++) {
      const x = this.columnX(i);
      const distInside = Math.min(x, width - x);
      let factor: number;
      if (distInside < 0) {
        const t = overhang === 0 ? 1 : Math.min(1, -distInside / overhang);
        factor = edgeCapacity + (overhangTipCapacity - edgeCapacity) * t;
      } else {
        const t = Math.min(1, distInside / rampLength);
        factor = edgeCapacity + (1 - edgeCapacity) * Math.sqrt(t);
      }
      cap[i] = maxHeight * factor;
    }
    return cap;
  }
}

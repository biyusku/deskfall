import { describe, expect, it } from 'vitest';
import type { DesktopState } from '../src/shared/types';
import { brushSnow, flingVelocity } from '../src/renderer/brush';
import { Particles } from '../src/renderer/particles';
import { SurfaceSet } from '../src/renderer/surfaces';

const DISPLAY = { x: 0, y: 0, width: 1920, height: 1080 };
const BAR = { x: 0, y: 1032, width: 1920, height: 48 };
const TOP = 200;

function snowyWindows(): SurfaceSet {
  const set = new SurfaceSet();
  const state: DesktopState = {
    windows: [
      { id: 'a', rect: { x: 300, y: TOP, width: 800, height: 500 } },
      { id: 'b', rect: { x: 1200, y: TOP + 100, width: 500, height: 400 } },
    ],
    bars: [BAR],
    foregroundId: 'a',
    time: 0,
  };
  set.update(state, DISPLAY);
  for (const w of set.windows)
    for (let k = 0; k < 20; k++) for (let x = 0; x < w.rect.width; x += 3) w.layer.deposit(x, 1);
  return set;
}

describe('brushSnow', () => {
  it('should_clear_only_the_spot_under_the_cursor_when_it_moves_slowly_through_the_pile', () => {
    // Arrange
    const set = snowyWindows();
    const layer = set.windows[0].layer;
    const elsewhere = layer.heightAt(400 - 300);
    // Act: a gentle 2px move inside the pile.
    const hits = brushSnow(set.windows, { x: 698, y: TOP - 3 }, { x: 700, y: TOP - 3 });
    // Assert: snow under the cursor is gone, snow elsewhere is untouched.
    expect(elsewhere).toBeGreaterThan(5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].sourceId).toBe('a');
    expect(layer.heightAt(700 - 300)).toBe(0);
    expect(layer.heightAt(400 - 300)).toBeCloseTo(elsewhere);
  });

  it('should_clear_the_whole_path_when_the_cursor_sweeps_along_the_top', () => {
    const set = snowyWindows();
    const layer = set.windows[0].layer;
    brushSnow(set.windows, { x: 400, y: TOP - 2 }, { x: 600, y: TOP - 2 });
    for (let x = 400; x <= 600; x += 10) expect(layer.heightAt(x - 300)).toBe(0);
    expect(layer.heightAt(800 - 300)).toBeGreaterThan(5);
  });

  it('should_not_touch_the_snow_when_the_cursor_is_inside_the_window', () => {
    const set = snowyWindows();
    const before = set.windows[0].layer.totalVolume();
    expect(brushSnow(set.windows, { x: 500, y: TOP + 40 }, { x: 600, y: TOP + 40 })).toEqual([]);
    expect(set.windows[0].layer.totalVolume()).toBe(before);
  });

  it('should_only_brush_the_end_point_when_the_cursor_jumps_far', () => {
    const set = snowyWindows();
    const layer = set.windows[0].layer;
    brushSnow(set.windows, { x: -2000, y: TOP - 2 }, { x: 900, y: TOP - 2 });
    expect(layer.heightAt(900 - 300)).toBe(0);
    expect(layer.heightAt(500 - 300)).toBeGreaterThan(5);
  });

  it('should_let_brushed_snow_fly_off_without_landing_back_on_its_window', () => {
    // Arrange: brush a spot and fling it right, like the renderer does.
    const set = snowyWindows();
    const [a] = set.windows;
    const before = a.layer.totalVolume();
    const fx = new Particles();
    const hits = brushSnow(set.windows, { x: 690, y: TOP - 3 }, { x: 700, y: TOP - 3 });
    const removed = before - a.layer.totalVolume();
    const v = flingVelocity({ x: 690, y: TOP - 3, t: 0 }, { x: 700, y: TOP - 3 }, 10);
    hits.forEach((h) => fx.burst(h.x, h.y, v.vx, v.vy, 20, h.sourceId));
    // Act: three seconds of falling.
    for (let t = 0; t < 3; t += 0.016) fx.update(0.016, set, DISPLAY.height, true);
    // Assert: window a only lost snow, it got none back.
    expect(removed).toBeGreaterThan(0);
    expect(a.layer.totalVolume()).toBeCloseTo(before - removed);
  });
});

describe('flingVelocity', () => {
  it('should_fling_in_the_direction_the_cursor_moves', () => {
    const right = flingVelocity({ x: 100, y: 100, t: 0 }, { x: 110, y: 100 }, 16);
    const left = flingVelocity({ x: 100, y: 100, t: 0 }, { x: 90, y: 100 }, 16);
    expect(right.vx).toBeGreaterThan(0);
    expect(left.vx).toBeLessThan(0);
    expect(right.vy).toBeLessThan(0);
  });

  it('should_fling_at_least_a_little_when_the_cursor_moves_very_slowly', () => {
    const v = flingVelocity({ x: 100, y: 100, t: 0 }, { x: 101, y: 100 }, 1000);
    expect(v.vx).toBeGreaterThanOrEqual(140 - 1e-9);
  });

  it('should_pop_snow_upward_when_there_is_no_previous_position', () => {
    const v = flingVelocity(null, { x: 100, y: 100 }, 0);
    expect(v.vx).toBe(0);
    expect(v.vy).toBeLessThan(0);
  });
});

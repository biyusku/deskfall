import { describe, expect, it } from 'vitest';
import type { DesktopState } from '../src/shared/types';
import { brushSnow } from '../src/renderer/brush';
import { SurfaceSet } from '../src/renderer/surfaces';

const DISPLAY = { x: 0, y: 0, width: 1920, height: 1080 };
const BAR = { x: 0, y: 1032, width: 1920, height: 48 };
const TOP = 200;

function snowyWindow(): SurfaceSet {
  const set = new SurfaceSet();
  const state: DesktopState = {
    windows: [{ id: 'w', rect: { x: 300, y: TOP, width: 800, height: 500 } }],
    bars: [BAR],
    foregroundId: 'w',
  };
  set.update(state, DISPLAY, 0);
  for (let k = 0; k < 20; k++) for (let x = 0; x < 800; x += 3) set.windows[0].layer.deposit(x, 1);
  return set;
}

describe('brushSnow', () => {
  it('should_brush_snow_off_when_the_cursor_moves_slowly_through_the_pile', () => {
    // Arrange
    const set = snowyWindow();
    const layer = set.windows[0].layer;
    const elsewhere = layer.heightAt(400 - 300);
    // Act: a gentle 2px move inside the pile.
    const hits = brushSnow(set.windows, { x: 698, y: TOP - 3 }, { x: 700, y: TOP - 3 });
    // Assert: snow under the cursor is gone, snow elsewhere is untouched.
    expect(elsewhere).toBeGreaterThan(5);
    expect(hits.length).toBeGreaterThan(0);
    expect(layer.heightAt(700 - 300)).toBe(0);
    expect(layer.heightAt(400 - 300)).toBeCloseTo(elsewhere);
  });

  it('should_clear_the_whole_path_when_the_cursor_sweeps_along_the_top', () => {
    const set = snowyWindow();
    const layer = set.windows[0].layer;
    brushSnow(set.windows, { x: 400, y: TOP - 2 }, { x: 600, y: TOP - 2 });
    for (let x = 400; x <= 600; x += 10) expect(layer.heightAt(x - 300)).toBe(0);
  });

  it('should_not_touch_the_snow_when_the_cursor_is_inside_the_window', () => {
    const set = snowyWindow();
    const before = set.windows[0].layer.totalVolume();
    expect(brushSnow(set.windows, { x: 500, y: TOP + 40 }, { x: 600, y: TOP + 40 })).toEqual([]);
    expect(set.windows[0].layer.totalVolume()).toBe(before);
  });

  it('should_only_brush_the_end_point_when_the_cursor_jumps_far', () => {
    const set = snowyWindow();
    const layer = set.windows[0].layer;
    brushSnow(set.windows, { x: -2000, y: TOP - 2 }, { x: 900, y: TOP - 2 });
    expect(layer.heightAt(900 - 300)).toBe(0);
    expect(layer.heightAt(500 - 300)).toBeGreaterThan(5);
  });
});

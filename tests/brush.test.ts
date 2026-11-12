import { describe, expect, it } from 'vitest';
import type { DesktopState } from '../src/shared/types';
import { touchedPiles } from '../src/renderer/brush';
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
  };
  set.update(state, DISPLAY, 0);
  for (const w of set.windows) for (let k = 0; k < 20; k++) for (let x = 0; x < w.rect.width; x += 3) w.layer.deposit(x, 1);
  return set;
}

describe('touchedPiles', () => {
  it('should_knock_the_whole_pile_off_when_the_cursor_gently_touches_it', () => {
    // Arrange
    const set = snowyWindows();
    const [a, b] = set.windows;
    // Act: a 2px move inside window a's pile, then the caller sheds it.
    const touched = touchedPiles(set.windows, { x: 698, y: TOP - 3 }, { x: 700, y: TOP - 3 });
    touched.forEach((s) => new Particles().shed({ rect: s.rect, layer: s.layer, vx: 0 }));
    // Assert: all of a's snow is gone, b is untouched.
    expect(touched).toEqual([a]);
    expect(a.layer.totalVolume()).toBe(0);
    expect(b.layer.totalVolume()).toBeGreaterThan(0);
  });

  it('should_let_the_knocked_off_snow_fall_past_its_window_when_it_comes_down', () => {
    // Arrange: knock window a's pile off.
    const set = snowyWindows();
    const [a] = set.windows;
    const fx = new Particles();
    fx.shed({ rect: a.rect, layer: a.layer, vx: 0, sourceId: a.id });
    expect(fx.crumbCount).toBeGreaterThan(0);
    // Act: let the chunks fall for 3 seconds.
    for (let t = 0; t < 3; t += 0.016) fx.update(0.016, set, DISPLAY.height, true);
    // Assert: none of it landed back on window a; it ended up on the taskbar.
    expect(a.layer.totalVolume()).toBe(0);
    expect(set.floor?.layer.totalVolume()).toBeGreaterThan(0);
  });

  it('should_touch_every_pile_crossed_when_the_cursor_sweeps_across_two_windows', () => {
    const set = snowyWindows();
    const touched = touchedPiles(set.windows, { x: 1000, y: TOP - 3 }, { x: 1220, y: TOP + 97 });
    expect(touched.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('should_not_touch_the_snow_when_the_cursor_is_inside_the_window', () => {
    const set = snowyWindows();
    expect(touchedPiles(set.windows, { x: 500, y: TOP + 40 }, { x: 600, y: TOP + 40 })).toEqual([]);
  });

  it('should_ignore_the_long_jump_when_the_cursor_comes_from_far_away', () => {
    const set = snowyWindows();
    // Coming from another screen: only the end point counts, and it is in empty space.
    expect(touchedPiles(set.windows, { x: -2000, y: TOP - 2 }, { x: 150, y: TOP - 2 })).toEqual([]);
  });

  it('should_not_touch_a_window_that_has_no_snow', () => {
    const set = snowyWindows();
    set.windows[0].layer.clear();
    expect(touchedPiles(set.windows, null, { x: 700, y: TOP - 2 })).toEqual([]);
  });
});

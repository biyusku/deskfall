import { describe, expect, it } from 'vitest';
import type { DesktopState } from '../src/shared/types';
import { SurfaceSet } from '../src/renderer/surfaces';

const DISPLAY = { x: 0, y: 0, width: 1920, height: 1080 };
const BAR = { x: 0, y: 1032, width: 1920, height: 48 };

/** A desktop snapshot stamped at `time` ms (as the main process would). */
function state(windows: DesktopState['windows'], time = 0): DesktopState {
  return { windows, bars: [BAR], foregroundId: windows[0]?.id ?? '0', time };
}

function win(x: number, y = 300): DesktopState['windows'][number] {
  return { id: 'w', rect: { x, y, width: 400, height: 300 } };
}

describe('SurfaceSet', () => {
  it('uses the taskbar as the floor and lands flakes on it', () => {
    const set = new SurfaceSet();
    set.update(state([]), DISPLAY);
    expect(set.floor?.kind).toBe('bar');
    expect(set.findLanding(500, 1020, 1040)?.kind).toBe('bar');
  });

  it('lands on the visible top edge of the upper window, not the hidden one below', () => {
    const set = new SurfaceSet();
    set.update(
      state([
        { id: 'top', rect: { x: 400, y: 200, width: 400, height: 400 } },
        { id: 'under', rect: { x: 100, y: 300, width: 1000, height: 500 } },
      ]),
      DISPLAY,
    );
    expect(set.findLanding(600, 190, 210)?.id).toBe('top');
    expect(set.findLanding(600, 290, 310)).toBeNull();
    expect(set.findLanding(200, 290, 310)?.id).toBe('under');
  });

  it('maps windows on another display into local coordinates', () => {
    const set = new SurfaceSet();
    const second = { x: -1920, y: 0, width: 1920, height: 1080 };
    set.update(
      {
        windows: [{ id: 'w', rect: { x: -1500, y: 100, width: 300, height: 300 } }],
        bars: [],
        foregroundId: 'w',
        time: 0,
      },
      second,
    );
    expect(set.windows[0].rect.x).toBe(420);
    expect(set.floor?.kind).toBe('ground');
  });

  it('sheds snow when a window jumps far, and when it disappears', () => {
    const set = new SurfaceSet();
    set.update(state([win(100)], 0), DISPLAY);
    set.windows[0].layer.deposit(100, 5);
    const moved = set.update(state([win(700)], 1000), DISPLAY);
    expect(moved).toHaveLength(1);
    expect(set.windows[0].layer.totalVolume()).toBe(0);

    set.windows[0].layer.deposit(100, 5);
    const closed = set.update(state([], 2000), DISPLAY);
    expect(closed).toHaveLength(1);
  });

  it('should_keep_snow_when_a_paused_screen_resumes_after_restore_from_maximized', () => {
    // Arrange: a floating window with snow, then (while paused) it was maximized.
    const set = new SurfaceSet();
    const floating = { id: 'w', rect: { x: 300, y: 200, width: 800, height: 500 } };
    set.update(state([floating], 0), DISPLAY);
    set.windows[0].layer.deposit(100, 5);
    const before = set.windows[0].layer.totalVolume();
    // Act: resume applies the maximized layout, then the restored one, without shedding.
    const maximized = { id: 'w', rect: { x: 0, y: 0, width: 1920, height: 1032 } };
    const sheds1 = set.update(state([maximized], 50), DISPLAY, false);
    const sheds2 = set.update(state([floating], 100), DISPLAY, false);
    // Assert
    expect(sheds1).toHaveLength(0);
    expect(sheds2).toHaveLength(0);
    expect(set.windows[0].layer.totalVolume()).toBeGreaterThan(before * 0.8);
  });

  it('keeps snow when a window moves slowly', () => {
    const set = new SurfaceSet();
    set.update(state([win(100)], 0), DISPLAY);
    set.windows[0].layer.deposit(100, 5);
    const sheds = set.update(state([win(102)], 500), DISPLAY);
    expect(sheds).toHaveLength(0);
    expect(set.windows[0].layer.totalVolume()).toBeGreaterThan(0);
  });

  it('should_keep_snow_during_a_moderate_drag_when_snapshots_are_handled_late_and_bunched', () => {
    // Arrange: snapshots stamped 33 ms apart, 11 px apart (~330 px/s, a calm drag).
    const set = new SurfaceSet();
    set.update(state([win(100)], 0), DISPLAY);
    set.windows[0].layer.deposit(100, 5);
    // Act: the renderer handles them back-to-back (a busy frame); only the stamps say 33 ms.
    const sheds = [33, 66, 99].flatMap((t, i) => set.update(state([win(100 + 11 * (i + 1))], t), DISPLAY));
    // Assert
    expect(sheds).toHaveLength(0);
    expect(set.windows[0].layer.totalVolume()).toBeGreaterThan(0);
  });

  it('does not collect snow on maximized windows', () => {
    const set = new SurfaceSet();
    set.update(state([{ id: 'max', rect: { x: 0, y: 0, width: 1920, height: 1032 } }]), DISPLAY);
    expect(set.windows[0].collects).toBe(false);
  });

  it('should_reuse_the_landing_list_when_flakes_query_it_repeatedly', () => {
    const set = new SurfaceSet();
    set.update(state([win(100)]), DISPLAY);
    expect(set.landingOrder()).toBe(set.landingOrder());
    expect(set.landingOrder().map((s) => s.kind)).toEqual(['bar', 'window']);
  });
});

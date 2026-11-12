import { describe, expect, it } from 'vitest';
import type { DesktopState } from '../src/shared/types';
import { SurfaceSet } from '../src/renderer/surfaces';

const DISPLAY = { x: 0, y: 0, width: 1920, height: 1080 };
const BAR = { x: 0, y: 1032, width: 1920, height: 48 };

function state(windows: DesktopState['windows']): DesktopState {
  return { windows, bars: [BAR], foregroundId: windows[0]?.id ?? '0' };
}

describe('SurfaceSet', () => {
  it('uses the taskbar as the floor and lands flakes on it', () => {
    const set = new SurfaceSet();
    set.update(state([]), DISPLAY, 0);
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
      0,
    );
    expect(set.findLanding(600, 190, 210)?.id).toBe('top');
    expect(set.findLanding(600, 290, 310)).toBeNull();
    expect(set.findLanding(200, 290, 310)?.id).toBe('under');
  });

  it('maps windows on another display into local coordinates', () => {
    const set = new SurfaceSet();
    const second = { x: -1920, y: 0, width: 1920, height: 1080 };
    set.update(
      { windows: [{ id: 'w', rect: { x: -1500, y: 100, width: 300, height: 300 } }], bars: [], foregroundId: 'w' },
      second,
      0,
    );
    expect(set.windows[0].rect.x).toBe(420);
    expect(set.floor?.kind).toBe('ground');
  });

  it('sheds snow when a window jumps far, and when it disappears', () => {
    const set = new SurfaceSet();
    const w = { id: 'w', rect: { x: 100, y: 300, width: 400, height: 300 } };
    set.update(state([w]), DISPLAY, 0);
    set.windows[0].layer.deposit(100, 5);
    const moved = set.update(state([{ id: 'w', rect: { x: 700, y: 300, width: 400, height: 300 } }]), DISPLAY, 1000);
    expect(moved).toHaveLength(1);
    expect(set.windows[0].layer.totalVolume()).toBe(0);

    set.windows[0].layer.deposit(100, 5);
    const closed = set.update(state([]), DISPLAY, 2000);
    expect(closed).toHaveLength(1);
  });

  it('should_keep_snow_when_a_paused_screen_resumes_after_restore_from_maximized', () => {
    // Arrange: a floating window with snow, then (while paused) it was maximized.
    const set = new SurfaceSet();
    const floating = { id: 'w', rect: { x: 300, y: 200, width: 800, height: 500 } };
    set.update(state([floating]), DISPLAY, 0);
    set.windows[0].layer.deposit(100, 5);
    const before = set.windows[0].layer.totalVolume();
    // Act: resume applies the maximized layout, then the restored one, without shedding.
    const sheds1 = set.update(state([{ id: 'w', rect: { x: 0, y: 0, width: 1920, height: 1032 } }]), DISPLAY, 50, false);
    const sheds2 = set.update(state([floating]), DISPLAY, 100, false);
    // Assert
    expect(sheds1).toHaveLength(0);
    expect(sheds2).toHaveLength(0);
    expect(set.windows[0].layer.totalVolume()).toBeGreaterThan(before * 0.8);
  });

  it('keeps snow when a window moves slowly', () => {
    const set = new SurfaceSet();
    set.update(state([{ id: 'w', rect: { x: 100, y: 300, width: 400, height: 300 } }]), DISPLAY, 0);
    set.windows[0].layer.deposit(100, 5);
    const sheds = set.update(state([{ id: 'w', rect: { x: 102, y: 300, width: 400, height: 300 } }]), DISPLAY, 500);
    expect(sheds).toHaveLength(0);
    expect(set.windows[0].layer.totalVolume()).toBeGreaterThan(0);
  });

  it('does not collect snow on maximized windows', () => {
    const set = new SurfaceSet();
    set.update(state([{ id: 'max', rect: { x: 0, y: 0, width: 1920, height: 1032 } }]), DISPLAY, 0);
    expect(set.windows[0].collects).toBe(false);
  });
});

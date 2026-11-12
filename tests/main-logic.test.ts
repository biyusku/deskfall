import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isReady: (): boolean => false, getPath: (): string => '' } }));

const { parseSnapshot, powershellPath, restartDelay } = await import('../src/main/window-watcher');
const { parseSettings } = await import('../src/main/settings-store');
const { barsFromWorkAreas, coversDisplay, coveredDisplays, fillsWorkArea, toDesktopState } =
  await import('../src/main/desktop-state');
const { detectLanguage } = await import('../src/main/i18n');
const { DEFAULT_SETTINGS } = await import('../src/shared/types');

describe('parseSnapshot', () => {
  it('parses a helper line', () => {
    const line = JSON.stringify({
      fg: 42,
      fgDesktop: false,
      fgRect: [0, 0, 1920, 1032],
      bars: [[0, 1032, 1920, 1080]],
      windows: [
        [42, 0, 0, 1920, 1032],
        [7, 10, 20, 110, 220],
      ],
    });
    const snap = parseSnapshot(line);
    expect(snap?.foreground).toBe('42');
    expect(snap?.windows).toHaveLength(2);
    expect(snap?.windows[1]).toEqual({ id: '7', rect: [10, 20, 110, 220] });
    expect(snap?.bars).toHaveLength(1);
  });

  it('rejects garbage', () => {
    expect(parseSnapshot('not json')).toBeNull();
    expect(parseSnapshot('{"windows":[["x",1,2,3,4]],"bars":[]}')).toBeNull();
    expect(parseSnapshot('{"windows":5}')).toBeNull();
  });
});

describe('parseSettings', () => {
  it('falls back to defaults for invalid values', () => {
    expect(parseSettings({ intensity: 'tsunami', wind: 'gusty', plow: 'yes' })).toEqual({
      ...DEFAULT_SETTINGS,
      wind: 'gusty',
    });
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('desktop state', () => {
  it('converts raw rects through the DIP mapper', () => {
    const half = (r: { x: number; y: number; width: number; height: number }): typeof r => ({
      x: r.x / 2,
      y: r.y / 2,
      width: r.width / 2,
      height: r.height / 2,
    });
    const raw = {
      foreground: '1',
      foregroundIsDesktop: false,
      foregroundRect: null,
      bars: [],
      windows: [{ id: '1', rect: [100, 200, 300, 400] as const }],
    };
    const state = toDesktopState(raw, half, 1234);
    expect(state.windows[0].rect).toEqual({ x: 50, y: 100, width: 100, height: 100 });
    expect(state.time).toBe(1234);
  });

  it('should_back_off_exponentially_when_the_window_helper_keeps_failing', () => {
    expect(restartDelay(1)).toBe(2000);
    expect(restartDelay(2)).toBe(4000);
    expect(restartDelay(4)).toBe(16000);
    expect(restartDelay(50)).toBe(60000);
  });

  it('should_use_the_absolute_system_powershell_when_spawning_the_helper', () => {
    expect(powershellPath('C:\\Windows')).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(powershellPath(undefined)).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });

  it('detects fullscreen windows', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(coversDisplay({ x: 0, y: 0, width: 1920, height: 1080 }, display)).toBe(true);
    expect(coversDisplay({ x: 0, y: 0, width: 1920, height: 1032 }, display)).toBe(false);
  });

  it('should_pause_only_the_screen_with_a_maximized_window_when_several_displays_exist', () => {
    // Arrange: primary (taskbar 48px) and a left monitor.
    const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1032 } };
    const left = { id: 2, workArea: { x: -1920, y: 0, width: 1920, height: 1032 } };
    const state = {
      foregroundId: 'max',
      time: 0,
      bars: [],
      windows: [
        { id: 'small', rect: { x: -1500, y: 100, width: 600, height: 400 } },
        { id: 'max', rect: { x: 0, y: 0, width: 1920, height: 1032 } },
      ],
    };
    // Act
    const covered = coveredDisplays(state, [primary, left]);
    // Assert
    expect([...covered]).toEqual([1]);
  });

  it('should_not_pause_when_a_window_only_fills_half_the_screen', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1032 };
    expect(fillsWorkArea({ x: 0, y: 0, width: 960, height: 1032 }, area)).toBe(false);
    expect(fillsWorkArea({ x: 0, y: 0, width: 1920, height: 1080 }, area)).toBe(true);
  });

  it('should_find_the_dock_from_the_work_area_when_no_window_tracker_exists', () => {
    // Arrange: a Mac screen with a 70px Dock at the bottom and a 25px menu bar on top.
    const display = {
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 25, width: 1440, height: 805 },
    };
    // Act
    const bars = barsFromWorkAreas([display]);
    // Assert
    expect(bars).toEqual([{ x: 0, y: 830, width: 1440, height: 70 }]);
  });

  it('should_return_no_floor_when_the_dock_is_hidden', () => {
    const display = {
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 25, width: 1440, height: 875 },
    };
    expect(barsFromWorkAreas([display])).toEqual([]);
  });

  it('picks Turkish for tr locales', () => {
    expect(detectLanguage('tr-TR')).toBe('tr');
    expect(detectLanguage('en-US')).toBe('en');
  });
});

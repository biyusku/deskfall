import type { DesktopState, Rect } from '../shared/types';
import type { RawRect, RawSnapshot } from './window-watcher';

export type ToDip = (rect: Rect) => Rect;

const FULLSCREEN_TOLERANCE = 2;

export function rawToRect(raw: RawRect): Rect {
  const [left, top, right, bottom] = raw;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function toDesktopState(snapshot: RawSnapshot, toDip: ToDip): DesktopState {
  return {
    foregroundId: snapshot.foreground,
    bars: snapshot.bars.map((bar) => toDip(rawToRect(bar))),
    windows: snapshot.windows.map((w) => ({ id: w.id, rect: toDip(rawToRect(w.rect)) })),
  };
}

export function coversDisplay(rect: Rect, display: Rect): boolean {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= FULLSCREEN_TOLERANCE;
  return (
    rect.x <= display.x + FULLSCREEN_TOLERANCE &&
    rect.y <= display.y + FULLSCREEN_TOLERANCE &&
    (near(rect.x + rect.width, display.x + display.width) || rect.x + rect.width > display.x + display.width) &&
    (near(rect.y + rect.height, display.y + display.height) || rect.y + rect.height > display.y + display.height)
  );
}

const MAXIMIZED_TOLERANCE = 8;

/** True when rect fills the display's work area (maximized) or the whole display. */
export function fillsWorkArea(rect: Rect, workArea: Rect): boolean {
  const t = MAXIMIZED_TOLERANCE;
  return (
    rect.x <= workArea.x + t &&
    rect.y <= workArea.y + t &&
    rect.x + rect.width >= workArea.x + workArea.width - t &&
    rect.y + rect.height >= workArea.y + workArea.height - t
  );
}

/** Display ids that have at least one maximized or fullscreen window on them. */
export function coveredDisplays(
  state: DesktopState,
  displays: ReadonlyArray<{ id: number; workArea: Rect }>,
): Set<number> {
  const result = new Set<number>();
  for (const display of displays) {
    if (state.windows.some((w) => fillsWorkArea(w.rect, display.workArea))) result.add(display.id);
  }
  return result;
}

const MIN_BAR_HEIGHT = 4;

/**
 * Fallback when there is no window tracker (macOS/Linux): a bottom Dock or panel shows up as the
 * gap between a display's bounds and its work area. Returns that gap as the "taskbar".
 */
export function barsFromWorkAreas(displays: ReadonlyArray<{ bounds: Rect; workArea: Rect }>): Rect[] {
  const bars: Rect[] = [];
  for (const { bounds, workArea } of displays) {
    const workBottom = workArea.y + workArea.height;
    const gap = bounds.y + bounds.height - workBottom;
    if (gap >= MIN_BAR_HEIGHT) bars.push({ x: bounds.x, y: workBottom, width: bounds.width, height: gap });
  }
  return bars;
}

/** Returns the display ids that currently show a fullscreen foreground app. */
export function fullscreenDisplays(
  snapshot: RawSnapshot,
  toDip: ToDip,
  displays: ReadonlyArray<{ id: number; bounds: Rect }>,
): Set<number> {
  const result = new Set<number>();
  if (snapshot.foregroundIsDesktop || !snapshot.foregroundRect) return result;
  const fg = toDip(rawToRect(snapshot.foregroundRect));
  for (const display of displays) {
    if (coversDisplay(fg, display.bounds)) result.add(display.id);
  }
  return result;
}

export type Intensity = 'light' | 'medium' | 'heavy' | 'blizzard';
export type WindMode = 'calm' | 'breeze' | 'gusty';
export type GarlandMode = 'all' | 'active' | 'off';
export type Language = 'tr' | 'en';

export interface Settings {
  /** Overlay visible at all. */
  enabled: boolean;
  /** New flakes keep falling. When false, piles slowly melt. */
  snowing: boolean;
  intensity: Intensity;
  wind: WindMode;
  garland: GarlandMode;
  plow: boolean;
  accumulate: boolean;
  /** Snowballs, snowmen and swiping snow off windows. */
  play: boolean;
  hideInFullscreen: boolean;
  /** Stop the overlay entirely on screens with a maximized or fullscreen window. */
  pauseOnMaximized: boolean;
  launchAtLogin: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  enabled: true,
  snowing: true,
  intensity: 'medium',
  wind: 'breeze',
  garland: 'all',
  plow: true,
  accumulate: true,
  play: true,
  hideInFullscreen: true,
  pauseOnMaximized: true,
  launchAtLogin: false,
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TrackedWindow {
  id: string;
  /** Global DIP coordinates. */
  rect: Rect;
}

export interface DesktopState {
  /** Visible top-level windows, top-most first. */
  windows: TrackedWindow[];
  /** Taskbars in global DIP coordinates. */
  bars: Rect[];
  foregroundId: string;
}

export interface OverlayInit {
  displayId: number;
  /** Display bounds in global DIP coordinates. */
  bounds: Rect;
}

export type OverlayCommand = 'clear-snow' | 'shake-all' | 'call-plow';

export const IPC = {
  init: 'deskfall:init',
  desktop: 'deskfall:desktop',
  settings: 'deskfall:settings',
  command: 'deskfall:command',
  interactive: 'deskfall:interactive',
  ready: 'deskfall:ready',
  error: 'deskfall:error',
  running: 'deskfall:running',
} as const;

export interface DeskfallBridge {
  onInit(cb: (init: OverlayInit) => void): void;
  onDesktop(cb: (state: DesktopState) => void): void;
  onSettings(cb: (settings: Settings) => void): void;
  onCommand(cb: (command: OverlayCommand) => void): void;
  onRunning(cb: (running: boolean) => void): void;
  setInteractive(interactive: boolean): void;
  ready(): void;
  reportError(message: string): void;
}

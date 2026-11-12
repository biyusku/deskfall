import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor, screen, type Display } from 'electron';
import { IPC, type DesktopState, type OverlayCommand, type Rect, type Settings } from '../shared/types';
import { barsFromWorkAreas, coveredDisplays, fullscreenDisplays, toDesktopState, type ToDip } from './desktop-state';
import { detectLanguage, translator } from './i18n';
import { logger } from './logger';
import { loadSettings, saveSettings } from './settings-store';
import { DeskfallTray } from './tray';
import { WindowWatcher, type RawSnapshot } from './window-watcher';

const TOGGLE_SHORTCUT = 'CommandOrControl+Alt+K';
const REASSERT_TOP_MS = 2500;
const FIRST_RUN_FLAG = 'welcomed';
/** Only Windows has a native window tracker so far (see src/helper). */
const HAS_WINDOW_TRACKER = process.platform === 'win32';
const RECOVERY_WINDOW_MS = 60_000;
/** More crashes than this within RECOVERY_WINDOW_MS and the overlay stays off. */
const MAX_RECOVERIES = 3;
/** Window tracker poll rate while some screen shows snow, and while every screen is paused. */
const ACTIVE_POLL_MS = 33;
const IDLE_POLL_MS = 250;

interface Overlay {
  displayId: number;
  bounds: Rect;
  win: BrowserWindow;
  workArea: Rect;
  ready: boolean;
  fullscreenHidden: boolean;
  /** A maximized/fullscreen window covers this display. */
  covered: boolean;
  /** Last running state sent to the renderer. */
  running: boolean | null;
  /** Times (ms) the renderer crashed or hung recently. */
  recoveries: number[];
}

const overlays = new Map<number, Overlay>();
let settings: Settings;
let settingsFile = '';
let lastDesktop: DesktopState | null = null;
let fullscreenIds = new Set<number>();
let tray: DeskfallTray | null = null;
const watcher = new WindowWatcher();

const toDip: ToDip = (rect) => screen.screenToDipRect(null, rect);

function overlayVisible(overlay: Overlay): boolean {
  if (!settings.enabled) return false;
  if (settings.hideInFullscreen && overlay.fullscreenHidden) return false;
  return !(settings.pauseOnMaximized && overlay.covered);
}

/** Shows/hides the overlay and starts/stops its render loop so hidden screens cost nothing. */
function syncVisibility(overlay: Overlay): void {
  if (!overlay.ready || overlay.win.isDestroyed()) return;
  const shouldShow = overlayVisible(overlay);
  if (overlay.running !== shouldShow) {
    overlay.running = shouldShow;
    overlay.win.webContents.send(IPC.running, shouldShow);
  }
  if (shouldShow && !overlay.win.isVisible()) {
    overlay.win.showInactive();
    overlay.win.setAlwaysOnTop(true, 'screen-saver');
    resetClickThrough(overlay);
  } else if (!shouldShow && overlay.win.isVisible()) {
    overlay.win.hide();
  }
}

/**
 * Windows can drop a hidden window's mouse forwarding (show/hide, sleep, lock), after which the
 * renderer never sees the cursor over snow and every click falls through. Start again from
 * click-through and tell the renderer, which re-requests clicks as soon as the cursor is over snow.
 */
function resetClickThrough(overlay: Overlay): void {
  if (overlay.win.isDestroyed()) return;
  overlay.win.setIgnoreMouseEvents(true, { forward: true });
  send(overlay, IPC.running, overlay.running === true);
}

function send(overlay: Overlay, channel: string, payload: unknown): void {
  if (!overlay.ready || overlay.win.isDestroyed()) return;
  overlay.win.webContents.send(channel, payload);
}

function broadcast(channel: string, payload: unknown): void {
  overlays.forEach((overlay) => send(overlay, channel, payload));
}

function createOverlay(display: Display): Overlay {
  const { bounds } = display;
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  const overlay: Overlay = {
    displayId: display.id,
    bounds,
    workArea: display.workArea,
    win,
    ready: false,
    fullscreenHidden: false,
    covered: false,
    running: null,
    recoveries: [],
  };
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true);
  win.setBounds(bounds);
  win.webContents.on('render-process-gone', (_event, details) => recoverOverlay(overlay, `gone: ${details.reason}`));
  win.on('unresponsive', () => recoverOverlay(overlay, 'unresponsive'));
  loadOverlay(overlay);
  return overlay;
}

function loadOverlay(overlay: Overlay): void {
  overlay.win.loadFile(join(__dirname, 'renderer', 'index.html')).catch((err: unknown) => {
    logger.error('overlay failed to load', err);
  });
}

/**
 * A crashed or hung renderer must never leave a full-screen window that swallows clicks:
 * make it click-through and hidden at once, then reload it (rate-limited so a renderer that keeps
 * crashing stays off instead of looping).
 */
function recoverOverlay(overlay: Overlay, reason: string): void {
  if (overlay.win.isDestroyed()) return;
  overlay.win.setIgnoreMouseEvents(true, { forward: true });
  overlay.win.hide();
  overlay.ready = false;
  overlay.running = null;
  const now = Date.now();
  overlay.recoveries = overlay.recoveries.filter((t) => now - t < RECOVERY_WINDOW_MS);
  overlay.recoveries.push(now);
  logger.error('overlay renderer failed', { display: overlay.displayId, reason, recent: overlay.recoveries.length });
  if (overlay.recoveries.length > MAX_RECOVERIES) return;
  loadOverlay(overlay);
}

function rebuildOverlays(): void {
  const displays = screen.getAllDisplays();
  const liveIds = new Set(displays.map((d) => d.id));
  overlays.forEach((overlay, id) => {
    if (liveIds.has(id)) return;
    overlay.win.destroy();
    overlays.delete(id);
  });
  for (const display of displays) {
    const existing = overlays.get(display.id);
    if (!existing) {
      overlays.set(display.id, createOverlay(display));
      continue;
    }
    existing.bounds = display.bounds;
    existing.workArea = display.workArea;
    existing.win.setBounds(display.bounds);
    send(existing, IPC.init, { displayId: display.id, bounds: display.bounds });
  }
  // Re-evaluate pause/fullscreen for new or resized displays right away, not on the next window change.
  if (!HAS_WINDOW_TRACKER) publishFallbackDesktop();
  else if (lastDesktop) publishDesktop(lastDesktop, fullscreenIds);
}

function overlayFor(senderId: number): Overlay | undefined {
  return [...overlays.values()].find((o) => !o.win.isDestroyed() && o.win.webContents.id === senderId);
}

function displayInfos(): Array<{ id: number; bounds: Rect; workArea: Rect }> {
  return [...overlays.values()].map((o) => ({ id: o.displayId, bounds: o.bounds, workArea: o.workArea }));
}

/**
 * Windows: live window layout from the native tracker. Stamped here, as it arrives, so the
 * renderer measures window speed from real snapshot spacing rather than its own frame timing.
 */
function handleSnapshot(snapshot: RawSnapshot): void {
  const state = toDesktopState(snapshot, toDip, performance.now());
  publishDesktop(state, fullscreenDisplays(snapshot, toDip, displayInfos()));
}

/**
 * macOS / Linux: no window tracker yet, so the floor is derived from each display's work area
 * (Dock / panel). Snow falls and piles on that floor; windows don't collect snow.
 */
function publishFallbackDesktop(): void {
  const state = { windows: [], bars: barsFromWorkAreas(displayInfos()), foregroundId: '0', time: performance.now() };
  publishDesktop(state, new Set());
}

/** Tracker runs only while snow is enabled, and polls slowly while every screen is paused. */
function syncWatcher(): void {
  if (!HAS_WINDOW_TRACKER) return;
  if (!settings.enabled) {
    watcher.stop();
    return;
  }
  const anyShowing = [...overlays.values()].some(overlayVisible);
  watcher.start(anyShowing ? ACTIVE_POLL_MS : IDLE_POLL_MS);
}

function publishDesktop(state: DesktopState, fullscreen: Set<number>): void {
  lastDesktop = state;
  fullscreenIds = fullscreen;
  const covered = coveredDisplays(lastDesktop, displayInfos());
  overlays.forEach((overlay) => {
    overlay.fullscreenHidden = fullscreenIds.has(overlay.displayId);
    overlay.covered = covered.has(overlay.displayId);
  });
  // Pause screens before they see the new layout, resume them only after they have it,
  // so a paused screen never animates the jump (maximize/restore) as a window shake.
  const all = [...overlays.values()];
  all.filter((o) => !overlayVisible(o)).forEach(syncVisibility);
  broadcast(IPC.desktop, lastDesktop);
  all.filter((o) => overlayVisible(o)).forEach(syncVisibility);
  syncWatcher();
}

function updateSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  saveSettings(settingsFile, settings);
  if (patch.launchAtLogin !== undefined) {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  }
  broadcast(IPC.settings, settings);
  overlays.forEach(syncVisibility);
  syncWatcher();
  tray?.refresh();
}

function sendCommand(command: OverlayCommand): void {
  if (!settings.enabled) updateSettings({ enabled: true });
  broadcast(IPC.command, command);
}

function registerIpc(): void {
  ipcMain.on(IPC.ready, (event) => {
    const overlay = overlayFor(event.sender.id);
    if (!overlay) return;
    overlay.ready = true;
    overlay.running = null;
    send(overlay, IPC.init, { displayId: overlay.displayId, bounds: overlay.bounds });
    send(overlay, IPC.settings, settings);
    if (lastDesktop) send(overlay, IPC.desktop, lastDesktop);
    syncVisibility(overlay);
  });
  ipcMain.on(IPC.error, (event, message: unknown) => {
    if (typeof message !== 'string') return;
    logger.error('renderer error', { display: overlayFor(event.sender.id)?.displayId, message });
  });
  ipcMain.on(IPC.interactive, (event, interactive: unknown) => {
    const overlay = overlayFor(event.sender.id);
    if (!overlay || typeof interactive !== 'boolean') return;
    overlay.win.setIgnoreMouseEvents(!interactive, { forward: true });
  });
}

function keepOnTop(): void {
  overlays.forEach((overlay) => {
    if (overlay.win.isDestroyed() || !overlay.win.isVisible()) return;
    overlay.win.setAlwaysOnTop(true, 'screen-saver');
  });
}

function showWelcomeOnce(): void {
  const flagFile = join(app.getPath('userData'), FIRST_RUN_FLAG);
  if (existsSync(flagFile)) return;
  try {
    writeFileSync(flagFile, new Date().toISOString(), 'utf8');
  } catch (err: unknown) {
    logger.warn('could not write first-run flag', err);
  }
  tray?.welcome();
}

async function start(): Promise<void> {
  await app.whenReady();
  settingsFile = join(app.getPath('userData'), 'settings.json');
  settings = loadSettings(settingsFile);
  const t = translator(detectLanguage(app.getLocale()));

  registerIpc();
  rebuildOverlays();
  screen.on('display-added', rebuildOverlays);
  screen.on('display-removed', rebuildOverlays);
  screen.on('display-metrics-changed', rebuildOverlays);
  const resetAll = (): void => overlays.forEach((o) => o.win.isVisible() && resetClickThrough(o));
  powerMonitor.on('resume', resetAll);
  powerMonitor.on('unlock-screen', resetAll);

  if (HAS_WINDOW_TRACKER) {
    watcher.onSnapshot(handleSnapshot);
    syncWatcher();
  } else {
    publishFallbackDesktop();
  }
  if (process.platform === 'darwin') app.dock?.hide();

  tray = new DeskfallTray({
    getSettings: () => settings,
    update: updateSettings,
    command: sendCommand,
    quit: () => app.quit(),
    t,
  });
  if (!globalShortcut.register(TOGGLE_SHORTCUT, () => updateSettings({ enabled: !settings.enabled }))) {
    logger.warn('shortcut already in use', TOGGLE_SHORTCUT);
  }
  setInterval(keepOnTop, REASSERT_TOP_MS);
  showWelcomeOnce();
  logger.info('deskfall started', { displays: overlays.size });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId('com.deskfall.app');
  // Linux needs this for transparent overlay windows on most compositors.
  if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');
  app.on('window-all-closed', () => {
    // Overlays are recreated on display changes; the tray keeps the app alive.
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    watcher.stop();
    tray?.destroy();
  });
  start().catch((err: unknown) => {
    logger.error('startup failed', err);
    app.quit();
  });
}

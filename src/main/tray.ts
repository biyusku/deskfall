import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import type { GarlandMode, Intensity, OverlayCommand, Settings, WindMode } from '../shared/types';
import { renderTrayIcon, toBgra } from '../shared/icon';
import type { StringKey } from './i18n';

const TRAY_ICON_PX = 32;
const TRAY_SCALE = 2;

export interface TrayHandlers {
  getSettings(): Settings;
  update(patch: Partial<Settings>): void;
  command(command: OverlayCommand): void;
  quit(): void;
  t(key: StringKey): string;
}

function trayImage(): NativeImage {
  const bitmap = renderTrayIcon(TRAY_ICON_PX);
  const image = nativeImage.createFromBitmap(toBgra(bitmap), {
    width: TRAY_ICON_PX,
    height: TRAY_ICON_PX,
    scaleFactor: TRAY_SCALE,
  });
  // macOS recolours template images to match a light or dark menu bar.
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}

function radioGroup<TValue extends string>(
  handlers: TrayHandlers,
  current: TValue,
  options: ReadonlyArray<{ value: TValue; label: StringKey }>,
  apply: (value: TValue) => Partial<Settings>,
): MenuItemConstructorOptions[] {
  return options.map((option) => ({
    type: 'radio',
    label: handlers.t(option.label),
    checked: option.value === current,
    click: (): void => handlers.update(apply(option.value)),
  }));
}

function toggle(handlers: TrayHandlers, label: StringKey, key: keyof Settings): MenuItemConstructorOptions {
  const settings = handlers.getSettings();
  const value = settings[key];
  return {
    type: 'checkbox',
    label: handlers.t(label),
    checked: value === true,
    click: (): void => handlers.update({ [key]: value !== true }),
  };
}

const INTENSITY_OPTIONS: ReadonlyArray<{ value: Intensity; label: StringKey }> = [
  { value: 'light', label: 'light' },
  { value: 'medium', label: 'medium' },
  { value: 'heavy', label: 'heavy' },
  { value: 'blizzard', label: 'blizzard' },
];
const WIND_OPTIONS: ReadonlyArray<{ value: WindMode; label: StringKey }> = [
  { value: 'calm', label: 'calm' },
  { value: 'breeze', label: 'breeze' },
  { value: 'gusty', label: 'gusty' },
];
const GARLAND_OPTIONS: ReadonlyArray<{ value: GarlandMode; label: StringKey }> = [
  { value: 'all', label: 'garlandAll' },
  { value: 'active', label: 'garlandActive' },
  { value: 'off', label: 'garlandOff' },
];

function buildMenu(h: TrayHandlers): Menu {
  const s = h.getSettings();
  const template: MenuItemConstructorOptions[] = [
    toggle(h, 'show', 'enabled'),
    toggle(h, 'snowing', 'snowing'),
    { type: 'separator' },
    {
      label: h.t('intensity'),
      submenu: radioGroup(h, s.intensity, INTENSITY_OPTIONS, (intensity) => ({ intensity })),
    },
    { label: h.t('wind'), submenu: radioGroup(h, s.wind, WIND_OPTIONS, (wind) => ({ wind })) },
    {
      label: h.t('garland'),
      submenu: radioGroup(h, s.garland, GARLAND_OPTIONS, (garland) => ({ garland })),
    },
    toggle(h, 'accumulate', 'accumulate'),
    toggle(h, 'play', 'play'),
    toggle(h, 'plow', 'plow'),
    { type: 'separator' },
    { label: h.t('callPlow'), click: (): void => h.command('call-plow') },
    { label: h.t('shake'), click: (): void => h.command('shake-all') },
    { label: h.t('clear'), click: (): void => h.command('clear-snow') },
    { type: 'separator' },
    toggle(h, 'pauseMaximized', 'pauseOnMaximized'),
    toggle(h, 'hideFullscreen', 'hideInFullscreen'),
    toggle(h, 'login', 'launchAtLogin'),
    { label: h.t('shortcutHint'), enabled: false },
    { type: 'separator' },
    { label: h.t('quit'), click: (): void => h.quit() },
  ];
  return Menu.buildFromTemplate(template);
}

export class DeskfallTray {
  private readonly tray: Tray;

  constructor(private readonly handlers: TrayHandlers) {
    this.tray = new Tray(trayImage());
    this.tray.setToolTip(handlers.t('tooltip'));
    this.tray.on('click', () => handlers.update({ enabled: !handlers.getSettings().enabled }));
    this.refresh();
  }

  refresh(): void {
    this.tray.setContextMenu(buildMenu(this.handlers));
  }

  welcome(): void {
    this.tray.displayBalloon({
      title: this.handlers.t('welcomeTitle'),
      content: this.handlers.t('welcomeBody'),
      iconType: 'none',
    });
  }

  destroy(): void {
    this.tray.destroy();
  }
}

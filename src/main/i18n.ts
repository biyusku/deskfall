import type { Language } from '../shared/types';

const STRINGS = {
  tooltip: { tr: 'Deskfall — masaüstünüzde kış', en: 'Deskfall — winter on your desktop' },
  show: { tr: 'Karı göster', en: 'Show snow' },
  snowing: { tr: 'Kar yağıyor', en: 'Snow falling' },
  intensity: { tr: 'Yoğunluk', en: 'Intensity' },
  light: { tr: 'Hafif', en: 'Light' },
  medium: { tr: 'Orta', en: 'Medium' },
  heavy: { tr: 'Yoğun', en: 'Heavy' },
  blizzard: { tr: 'Tipi', en: 'Blizzard' },
  wind: { tr: 'Rüzgâr', en: 'Wind' },
  calm: { tr: 'Durgun', en: 'Calm' },
  breeze: { tr: 'Esinti', en: 'Breeze' },
  gusty: { tr: 'Sert', en: 'Gusty' },
  garland: { tr: 'Yılbaşı ışıkları', en: 'Holiday lights' },
  garlandAll: { tr: 'Tüm pencereler', en: 'All windows' },
  garlandActive: { tr: 'Yalnızca aktif pencere', en: 'Active window only' },
  garlandOff: { tr: 'Kapalı', en: 'Off' },
  accumulate: { tr: 'Kar birikmesi', en: 'Snow piles up' },
  play: { tr: 'Kardan adam & karla oyna', en: 'Snowmen & snow play' },
  plow: { tr: 'Kar küreme aracı', en: 'Snowplow' },
  callPlow: { tr: 'Küreme aracını çağır', en: 'Call the snowplow' },
  shake: { tr: 'Pencerelerdeki karı silkele', en: 'Shake snow off windows' },
  clear: { tr: 'Tüm karı temizle', en: 'Clear all snow' },
  hideFullscreen: { tr: 'Tam ekranda gizle', en: 'Hide in fullscreen apps' },
  pauseMaximized: {
    tr: 'Ekranı kaplayan pencere varsa o ekranda dur',
    en: 'Pause on screens with a maximized window',
  },
  login: { tr: 'Windows ile başlat', en: 'Start with Windows' },
  shortcutHint: { tr: 'Kısayol: Ctrl+Alt+K', en: 'Shortcut: Ctrl+Alt+K' },
  quit: { tr: 'Çıkış', en: 'Quit' },
  welcomeTitle: { tr: 'Kar yağmaya başladı ❄', en: 'It is snowing ❄' },
  welcomeBody: {
    tr: 'Ayarlar için görev çubuğundaki kar tanesine sağ tıklayın. Görev çubuğundaki karı sürükleyerek kartopu yuvarlayın!',
    en: 'Right-click the snowflake in the tray for settings. Drag across the snow on the taskbar to roll snowballs!',
  },
} as const;

export type StringKey = keyof typeof STRINGS;

export function detectLanguage(locale: string): Language {
  return locale.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export function translator(language: Language): (key: StringKey) => string {
  return (key) => STRINGS[key][language];
}

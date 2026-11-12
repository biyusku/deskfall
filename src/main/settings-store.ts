import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';
import { logger } from './logger';

const INTENSITIES = ['light', 'medium', 'heavy', 'blizzard'] as const;
const WINDS = ['calm', 'breeze', 'gusty'] as const;
const GARLANDS = ['all', 'active', 'off'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickEnum<TValue extends string>(value: unknown, allowed: readonly TValue[], fallback: TValue): TValue {
  const match = allowed.find((option) => option === value);
  return match ?? fallback;
}

function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Validates untrusted JSON into a complete Settings object. */
export function parseSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isRecord(raw)) return { ...d };
  return {
    enabled: pickBool(raw.enabled, d.enabled),
    snowing: pickBool(raw.snowing, d.snowing),
    intensity: pickEnum(raw.intensity, INTENSITIES, d.intensity),
    wind: pickEnum(raw.wind, WINDS, d.wind),
    garland: pickEnum(raw.garland, GARLANDS, d.garland),
    plow: pickBool(raw.plow, d.plow),
    accumulate: pickBool(raw.accumulate, d.accumulate),
    play: pickBool(raw.play, d.play),
    hideInFullscreen: pickBool(raw.hideInFullscreen, d.hideInFullscreen),
    pauseOnMaximized: pickBool(raw.pauseOnMaximized, d.pauseOnMaximized),
    launchAtLogin: pickBool(raw.launchAtLogin, d.launchAtLogin),
  };
}

export function loadSettings(file: string): Settings {
  try {
    return parseSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err: unknown) {
    if (isRecord(err) && err.code === 'ENOENT') return { ...DEFAULT_SETTINGS };
    logger.warn('settings unreadable, using defaults', err);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(file: string, settings: Settings): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err: unknown) {
    logger.error('settings save failed', err);
  }
}

import { appendFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

type Level = 'info' | 'warn' | 'error';

const LOG_FILE = 'deskfall.log';
const OLD_LOG_FILE = 'deskfall.old.log';
const MAX_LOG_BYTES = 1024 * 1024;

function format(level: Level, message: string, context?: unknown): string {
  const extra = context === undefined ? '' : ` ${describe(context)}`;
  return `${new Date().toISOString()} [${level}] ${message}${extra}\n`;
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Moves `file` to `oldFile` once it passes `maxBytes`, so the log never grows without bound. */
export function rotateIfLarge(file: string, oldFile: string, maxBytes: number): void {
  try {
    if (statSync(file).size > maxBytes) renameSync(file, oldFile);
  } catch (err: unknown) {
    const missing = typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
    if (!missing) process.stderr.write(`log rotation failed: ${describe(err)}\n`);
  }
}

function write(level: Level, message: string, context?: unknown): void {
  const line = format(level, message, context);
  process.stderr.write(line);
  if (!app.isReady()) return;
  const dir = app.getPath('userData');
  const file = join(dir, LOG_FILE);
  rotateIfLarge(file, join(dir, OLD_LOG_FILE), MAX_LOG_BYTES);
  try {
    appendFileSync(file, line);
  } catch (err: unknown) {
    process.stderr.write(`log write failed: ${describe(err)}\n`);
  }
}

export const logger = {
  info: (message: string, context?: unknown): void => write('info', message, context),
  warn: (message: string, context?: unknown): void => write('warn', message, context),
  error: (message: string, context?: unknown): void => write('error', message, context),
};

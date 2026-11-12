import { appendFile } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

type Level = 'info' | 'warn' | 'error';

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

function write(level: Level, message: string, context?: unknown): void {
  const line = format(level, message, context);
  process.stderr.write(line);
  if (!app.isReady()) return;
  appendFile(join(app.getPath('userData'), 'deskfall.log'), line, (err) => {
    if (err) process.stderr.write(`log write failed: ${err.message}\n`);
  });
}

export const logger = {
  info: (message: string, context?: unknown): void => write('info', message, context),
  warn: (message: string, context?: unknown): void => write('warn', message, context),
  error: (message: string, context?: unknown): void => write('error', message, context),
};

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { logger } from './logger';

/** Physical-pixel rectangle as [left, top, right, bottom]. */
export type RawRect = readonly [number, number, number, number];

export interface RawSnapshot {
  foreground: string;
  foregroundIsDesktop: boolean;
  foregroundRect: RawRect | null;
  bars: RawRect[];
  /** [id, rect], top-most first. */
  windows: Array<{ id: string; rect: RawRect }>;
}

const POLL_INTERVAL_MS = 33;
const RESTART_DELAY_MS = 2000;
const MAX_LINE_LENGTH = 1_000_000;

function isRawRect(value: unknown): value is RawRect {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validates one JSON line emitted by winlist.ps1. Returns null when malformed. */
export function parseSnapshot(line: string): RawSnapshot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !Array.isArray(raw.windows) || !Array.isArray(raw.bars)) return null;
  const windows: RawSnapshot['windows'] = [];
  for (const entry of raw.windows) {
    if (!Array.isArray(entry) || entry.length !== 5) return null;
    const [id, ...rest] = entry;
    if (typeof id !== 'number' || !isRawRect(rest)) return null;
    windows.push({ id: String(id), rect: rest });
  }
  const bars = raw.bars.filter(isRawRect);
  const fgRect = isRawRect(raw.fgRect) ? raw.fgRect : null;
  return {
    foreground: typeof raw.fg === 'number' ? String(raw.fg) : '0',
    foregroundIsDesktop: raw.fgDesktop === true,
    foregroundRect: fgRect,
    bars,
    windows,
  };
}

export function helperScriptPath(): string {
  // Inside a packaged app the script must be read from the unpacked asar folder.
  return join(__dirname, 'helper', 'winlist.ps1').replace('app.asar', 'app.asar.unpacked');
}

export class WindowWatcher extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private stopped = false;
  private restartTimer: NodeJS.Timeout | null = null;

  start(): void {
    this.stopped = false;
    this.spawnHelper();
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.child?.kill();
    this.child = null;
  }

  onSnapshot(listener: (snapshot: RawSnapshot) => void): void {
    this.on('snapshot', listener);
  }

  private spawnHelper(): void {
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperScriptPath(),
      String(process.pid),
      String(POLL_INTERVAL_MS),
    ];
    const child = spawn('powershell.exe', args, { windowsHide: true });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    child.stderr.on('data', (chunk: Buffer) => logger.warn('window helper stderr', chunk.toString()));
    child.on('error', (err) => logger.error('window helper failed to start', err));
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      logger.warn('window helper exited, restarting', { code });
      this.restartTimer = setTimeout(() => this.spawnHelper(), RESTART_DELAY_MS);
    });
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_LENGTH) this.buffer = '';
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        const snapshot = parseSnapshot(line);
        if (snapshot) this.emit('snapshot', snapshot);
        else logger.warn('malformed window snapshot', line.slice(0, 200));
      }
      newline = this.buffer.indexOf('\n');
    }
  }
}

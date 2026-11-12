import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { join, win32 } from 'node:path';
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

const DEFAULT_POLL_INTERVAL_MS = 33;
const RESTART_DELAY_MS = 2000;
const MAX_RESTART_DELAY_MS = 60_000;
const MAX_LINE_LENGTH = 1_000_000;
const LOG_PREVIEW_CHARS = 200;
const DEFAULT_SYSTEM_ROOT = 'C:\\Windows';

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

/** Delay before restarting a helper that failed `failures` times in a row (exponential, capped). */
export function restartDelay(failures: number): number {
  return Math.min(MAX_RESTART_DELAY_MS, RESTART_DELAY_MS * 2 ** Math.max(0, failures - 1));
}

/** Absolute path, so a `powershell.exe` in the working directory can never be picked up instead. */
export function powershellPath(systemRoot: string | undefined): string {
  return win32.join(systemRoot ?? DEFAULT_SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export class WindowWatcher extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private running = false;
  private intervalMs = DEFAULT_POLL_INTERVAL_MS;
  private failures = 0;
  private restartTimer: NodeJS.Timeout | null = null;

  /** Starts the helper (no-op if running) and sets how often it polls. */
  start(intervalMs: number = DEFAULT_POLL_INTERVAL_MS): void {
    const changed = intervalMs !== this.intervalMs;
    this.intervalMs = intervalMs;
    if (!this.running) {
      this.running = true;
      this.spawnHelper();
      return;
    }
    if (changed) this.child?.stdin.write(`interval ${intervalMs}\n`);
  }

  stop(): void {
    this.running = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    child?.kill();
  }

  onSnapshot(listener: (snapshot: RawSnapshot) => void): void {
    this.on('snapshot', listener);
  }

  private spawnHelper(): void {
    this.restartTimer = null;
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperScriptPath(),
      String(process.pid),
      String(this.intervalMs),
    ];
    const child = spawn(powershellPath(process.env.SystemRoot), args, { windowsHide: true });
    this.child = child;
    this.buffer = '';
    let failed = false;
    const onFailure = (reason: string, detail: unknown): void => {
      if (failed) return;
      failed = true;
      this.handleFailure(child, reason, detail);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    child.stderr.on('data', (chunk: Buffer) => logger.warn('window helper stderr', chunk.toString()));
    child.stdin.on('error', (err) => logger.warn('window helper stdin closed', err.message));
    // 'error' (e.g. ENOENT) can fire without 'exit', so both lead to the same restart path.
    child.on('error', (err) => onFailure('failed to start', err));
    child.on('exit', (code) => onFailure('exited', { code }));
  }

  private handleFailure(child: ChildProcessWithoutNullStreams, reason: string, detail: unknown): void {
    if (this.child === child) this.child = null;
    if (!this.running) return;
    this.failures += 1;
    const delay = restartDelay(this.failures);
    logger.warn(`window helper ${reason}, restarting`, { detail, failures: this.failures, delayMs: delay });
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.spawnHelper(), delay);
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
        if (snapshot) {
          this.failures = 0;
          this.emit('snapshot', snapshot);
        } else {
          logger.warn('malformed window snapshot', line.slice(0, LOG_PREVIEW_CHARS));
        }
      }
      newline = this.buffer.indexOf('\n');
    }
  }
}

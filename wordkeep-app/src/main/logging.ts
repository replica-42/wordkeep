import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { LogLevel } from '../shared/api';

export const LOG_BYTES = 25_000_000;
const priorities: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
};
export class FileLogger {
  private level: LogLevel = 'WARNING';
  constructor(
    private readonly path: string,
    private readonly maxBytes = LOG_BYTES,
    private readonly backups = 3,
  ) {
    mkdirSync(dirname(path), { recursive: true });
  }
  setLevel(level: LogLevel): void {
    this.level = level;
  }
  write(level: LogLevel, message: string, error?: unknown): void {
    if (priorities[level] < priorities[this.level]) return;
    const detail =
      error instanceof Error
        ? (error.stack ?? error.message)
        : error === undefined
          ? ''
          : String(error);
    const raw = Buffer.from(
      `${new Date().toISOString()} ${level} ${message}${detail ? `: ${detail}` : ''}`,
    );
    let end = Math.min(raw.length, 64_000, this.maxBytes - 1);
    // Truncate at a complete UTF-8 character boundary.
    while (end > 0 && end < raw.length && ((raw[end] ?? 0) & 0xc0) === 0x80)
      end--;
    const line = Buffer.concat([raw.subarray(0, end), Buffer.from('\n')]);
    if (
      existsSync(this.path) &&
      statSync(this.path).size + line.length > this.maxBytes
    ) {
      rmSync(`${this.path}.${this.backups}`, { force: true });
      for (let i = this.backups - 1; i >= 1; i--) {
        if (existsSync(`${this.path}.${i}`))
          renameSync(`${this.path}.${i}`, `${this.path}.${i + 1}`);
      }
      renameSync(this.path, `${this.path}.1`);
    }
    appendFileSync(this.path, line);
  }
}

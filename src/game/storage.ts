import type { StoragePort } from './types';

export class BrowserStorage implements StoragePort {
  readNumber(key: string, fallback: number): number {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  writeNumber(key: string, value: number): void {
    try {
      localStorage.setItem(key, String(value));
    } catch (_error) {
      // Storage is optional; gameplay must not crash when unavailable.
    }
  }

  readBoolean(key: string, fallback: boolean): boolean {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return raw === 'true';
    } catch (_error) {
      return fallback;
    }
  }

  writeBoolean(key: string, value: boolean): void {
    try {
      localStorage.setItem(key, String(value));
    } catch (_error) {
      // Storage is optional; gameplay must not crash when unavailable.
    }
  }
}

export class MemoryStorage implements StoragePort {
  private values = new Map<string, string>();
  constructor(private fail = false) {}

  readNumber(key: string, fallback: number): number {
    if (this.fail) return fallback;
    const raw = this.values.get(key);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  writeNumber(key: string, value: number): void {
    if (!this.fail) this.values.set(key, String(value));
  }

  readBoolean(key: string, fallback: boolean): boolean {
    if (this.fail) return fallback;
    const raw = this.values.get(key);
    return raw === undefined ? fallback : raw === 'true';
  }

  writeBoolean(key: string, value: boolean): void {
    if (!this.fail) this.values.set(key, String(value));
  }
}

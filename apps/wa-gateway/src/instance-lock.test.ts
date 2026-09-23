import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireInstanceLock } from './instance-lock.js';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('kunci satu-instance gateway', () => {
  it('menolak instance kedua selama pemegang kunci masih hidup', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'gw-lock-'));
    const first = acquireInstanceLock(dir);
    expect(first.acquired).toBe(true);
    // Instance lain (pid berbeda) melihat kunci milik proses hidup (proses test ini).
    const second = acquireInstanceLock(dir, process.pid + 100_000);
    expect(second).toEqual({ acquired: false, holderPid: process.pid });
    if (first.acquired) first.release();
    expect(existsSync(path.join(dir, '.gateway.lock'))).toBe(false);
  });

  it('mengambil alih kunci basi milik proses yang sudah mati', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'gw-lock-'));
    writeFileSync(path.join(dir, '.gateway.lock'), '999999999');
    const result = acquireInstanceLock(dir);
    expect(result.acquired).toBe(true);
    expect(readFileSync(path.join(dir, '.gateway.lock'), 'utf8')).toBe(String(process.pid));
  });
});

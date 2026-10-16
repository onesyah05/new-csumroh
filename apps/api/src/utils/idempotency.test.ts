import { beforeEach, describe, expect, it, vi } from 'vitest';
import { idempotent, resetIdempotency } from './idempotency.js';

beforeEach(() => {
  resetIdempotency();
  vi.useRealTimers();
});

describe('idempotent', () => {
  it('kunci sama hanya menjalankan sekali dan mengembalikan hasil yang sama', async () => {
    const run = vi.fn(async () => ({ id: 1 }));
    const first = await idempotent('u1:a', run);
    const second = await idempotent('u1:a', run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('permintaan ulang saat yang pertama masih berjalan menunggu hasil yang sama', async () => {
    let release!: (value: string) => void;
    const run = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
    const a = idempotent('u1:b', run);
    const b = idempotent('u1:b', run);
    release('terkirim');
    expect(await a).toBe('terkirim');
    expect(await b).toBe('terkirim');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('yang gagal tidak disimpan: coba ulang menjalankan lagi', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('gateway putus')).mockResolvedValueOnce('ok');
    await expect(idempotent('u1:c', run)).rejects.toThrow('gateway putus');
    await expect(idempotent('u1:c', run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('kunci berbeda (mis. pengguna lain) tidak saling memengaruhi', async () => {
    const run = vi.fn(async () => 'x');
    await idempotent('u1:d', run);
    await idempotent('u2:d', run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('tanpa kunci selalu menjalankan', async () => {
    const run = vi.fn(async () => 'x');
    await idempotent(undefined, run);
    await idempotent(undefined, run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('hasil kedaluwarsa setelah 10 menit', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => 'x');
    await idempotent('u1:e', run);
    vi.advanceTimersByTime(10 * 60_000 + 1);
    await idempotent('u1:e', run);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { onSessionChange, refreshSession, SessionRefreshUnavailableError } from './api';

const response = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Refresh sesi', () => {
  it('ditolak server (401): sesi berakhir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(401)));
    const seen: unknown[] = [];
    const stop = onSessionChange((session) => seen.push(session));
    await expect(refreshSession()).resolves.toBeNull();
    stop();
    expect(seen).toEqual([null]);
  });

  it('gangguan sementara (429/503/jaringan): dicoba ulang, lalu gagal tanpa mengeluarkan pengguna', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(429))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response(503));
    vi.stubGlobal('fetch', fetch);
    const seen: unknown[] = [];
    const stop = onSessionChange((session) => seen.push(session));
    const result = refreshSession();
    const assertion = expect(result).rejects.toBeInstanceOf(SessionRefreshUnavailableError);
    await vi.runAllTimersAsync();
    await assertion;
    stop();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(seen).toEqual([]);
  });

  it('pulih setelah gangguan singkat', async () => {
    vi.useFakeTimers();
    const session = { accessToken: 'baru', user: { id: 1 } };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(502))
      .mockResolvedValueOnce(response(200, { success: true, data: session })));
    const result = refreshSession();
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual(session);
  });
});

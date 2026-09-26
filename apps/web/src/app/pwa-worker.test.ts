import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function worker() {
  const events: Record<string, (event: any) => void> = {};
  const addAll = vi.fn(async () => {});
  const offline = { offline: true };
  const cache = { open: vi.fn(async () => ({ addAll })), match: vi.fn(async () => offline), keys: vi.fn(async () => []), delete: vi.fn() };
  const fetch = vi.fn(async () => ({ online: true }));
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://crm.example' }, addEventListener: (name: string, callback: (event: any) => void) => { events[name] = callback; } },
    caches: cache, fetch, URL, Response,
  });
  return { events, addAll, cache, fetch, offline };
}

describe('PWA offline boundary', () => {
  it('hanya menyimpan halaman bantuan publik saat instalasi', async () => {
    const w = worker(); let completed: Promise<unknown> = Promise.resolve();
    w.events.install!({ waitUntil: (promise: Promise<unknown>) => { completed = promise; } });
    await completed;
    expect(w.addAll).toHaveBeenCalledWith(['/offline.html']);
  });
  it('tidak mengintersep API, unggahan, mutasi, atau request origin lain', () => {
    const w = worker();
    for (const [path, mode, method] of [
      ['/api/v1/prospects', 'navigate', 'GET'], ['/uploads/proof.png', 'navigate', 'GET'],
      ['/inbox', 'navigate', 'POST'], ['/api/v1/chat', 'cors', 'GET'],
      ['https://other.example/inbox', 'navigate', 'GET'],
    ] as const) {
      const respondWith = vi.fn();
      w.events.fetch!({ request: { url: path.startsWith('https:') ? path : `https://crm.example${path}`, mode, method }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
  it('menggunakan bantuan offline hanya saat navigasi gagal, tanpa menyimpan halaman autentikasi', async () => {
    const w = worker(); w.fetch.mockRejectedValueOnce(new Error('offline'));
    let response: Promise<unknown> = Promise.resolve();
    w.events.fetch!({ request: { url: 'https://crm.example/inbox', mode: 'navigate', method: 'GET' }, respondWith: (promise: Promise<unknown>) => { response = promise; } });
    expect(await response).toEqual(w.offline);
    expect(w.cache.match).toHaveBeenCalledWith('/offline.html');
    expect(w.cache.open).not.toHaveBeenCalled();
  });
});

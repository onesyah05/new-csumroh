import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, isApiUrl, resolveMediaUrl, setAccessToken } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Klien API: kredensial, batas waktu, dan URL media', () => {
  it('berkas privat dari origin API membawa token; URL absolut ke host lain tidak', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(['x']) }));
    vi.stubGlobal('fetch', fetch);
    setAccessToken('rahasia');
    await api.blob('/uploads/media/a.jpg');
    const [, own] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((own.headers as Record<string, string>).Authorization).toBe('Bearer rahasia');
    expect(own.credentials).toBe('include');

    await api.blob('https://penyerang.example/bukti.jpg');
    const [, foreign] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(foreign.headers).toEqual({});
    expect(foreign.credentials).toBe('omit');
  });

  it('isApiUrl: hanya origin API', () => {
    expect(isApiUrl('http://localhost:4000/uploads/x.jpg')).toBe(true);
    expect(isApiUrl('https://evil.example/uploads/x.jpg')).toBe(false);
    expect(isApiUrl('http://localhost:4000.evil.example/x')).toBe(false);
  });

  it('permintaan yang melewati batas waktu menjadi galat 504 yang jelas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }));
    await expect(api.get('/prospects')).rejects.toMatchObject({ status: 504, message: expect.stringContaining('tidak merespons') });
  });

  it('permintaan membawa AbortSignal batas waktu', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: 1 }) }));
    vi.stubGlobal('fetch', fetch);
    await api.get('/prospects');
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('data: hanya gambar yang dirender', () => {
    expect(resolveMediaUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(resolveMediaUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
    expect(resolveMediaUrl('data:image/svg+xml;base64,AAAA')).toBe('');
    expect(resolveMediaUrl('/uploads/media/a.jpg')).toContain('/uploads/media/a.jpg');
  });
});

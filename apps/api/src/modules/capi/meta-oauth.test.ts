import type { AddressInfo } from 'node:net';
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  brandFindUnique: vi.fn(),
  brandFindMany: vi.fn(),
  brandUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  claimOnce: vi.fn(),
  fetch: vi.fn(),
  allowed: true,
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    brand: { findUnique: mocks.brandFindUnique, findMany: mocks.brandFindMany, update: mocks.brandUpdate },
    user: { findUnique: mocks.userFindUnique },
  },
}));
vi.mock('../notifications/jobs.js', () => ({ claimOnce: (key: string) => mocks.claimOnce(key) }));
vi.mock('./send-guard.js', () => ({ isMetaSendingAllowed: () => mocks.allowed }));

const realFetch = globalThis.fetch;
const jsonResponse =(body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

async function load() {
  vi.resetModules();
  vi.stubEnv('META_APP_ID', '123456789');
  vi.stubEnv('META_APP_SECRET', 'app-secret-0123456789abcdef');
  vi.stubEnv('META_OAUTH_REDIRECT_URI', 'https://crm.example.com/api/v1/meta/oauth/callback');
  const oauth = await import('./meta-oauth.js');
  const { metaOauthCallbackRouter } = await import('./meta-oauth.routes.js');
  return { ...oauth, metaOauthCallbackRouter };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claimOnce.mockResolvedValue(true);
  mocks.allowed = true;
  mocks.brandUpdate.mockResolvedValue({});
  vi.stubGlobal('fetch', mocks.fetch);
});

// Impor pertama memuat rantai modul besar (ad-insights, reports): beri waktu lebih.
describe('meta oauth', { timeout: 30_000 }, () => {
  it('safeReturnPath hanya menerima path internal', async () => {
    const { safeReturnPath } = await load();
    expect(safeReturnPath('/brands/3?tab=meta')).toBe('/brands/3?tab=meta');
    expect(safeReturnPath('//evil.com')).toBe('/brands');
    expect(safeReturnPath('https://evil.com')).toBe('/brands');
    expect(safeReturnPath('/\\evil.com')).toBe('/brands');
    expect(safeReturnPath(undefined)).toBe('/brands');
  });

  it('URL otorisasi memuat scope, redirect_uri, dan state yang dapat diverifikasi sekali pakai', async () => {
    const { buildAuthorizeUrl, consumeState } = await load();
    const url = new URL(buildAuthorizeUrl({ brandId: 7, userId: 2, returnTo: '/brands/7?tab=meta' }));
    expect(url.hostname).toBe('www.facebook.com');
    expect(url.searchParams.get('client_id')).toBe('123456789');
    expect(url.searchParams.get('redirect_uri')).toBe('https://crm.example.com/api/v1/meta/oauth/callback');
    expect(url.searchParams.get('scope')).toBe('ads_read,ads_management');
    const state = url.searchParams.get('state')!;
    await expect(consumeState(state)).resolves.toEqual({ brandId: 7, userId: 2, returnTo: '/brands/7?tab=meta' });
    mocks.claimOnce.mockResolvedValue(false);
    await expect(consumeState(state)).rejects.toThrow(/sudah dipakai/);
  });

  it('state palsu ditolak', async () => {
    const { consumeState } = await load();
    await expect(consumeState('bukan-jwt')).rejects.toThrow(/kedaluwarsa/);
  });

  it('kode ditukar jadi token panjang lewat POST tanpa secret di URL', async () => {
    const { exchangeCodeForLongLivedToken } = await load();
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'SHORT' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'LONG', expires_in: 5_184_000 }));
    const result = await exchangeCodeForLongLivedToken('CODE');
    expect(result.token).toBe('LONG');
    expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
    for (const [url, init] of mocks.fetch.mock.calls) {
      expect(String(url)).not.toContain('app-secret');
      expect(init.method).toBe('POST');
    }
    expect(String(mocks.fetch.mock.calls[1]![1].body)).toContain('fb_exchange_token=SHORT');
  });

  it('token tanpa expires_in disimpan dengan masa berlaku bawaan 60 hari', async () => {
    const { saveOauthToken } = await load();
    await saveOauthToken(3, { token: 'LONG', expiresAt: null });
    const data = mocks.brandUpdate.mock.calls[0]![0].data;
    expect(data.metaAdsTokenSource).toBe('oauth');
    expect(data.metaAdsTokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
  });

  describe('refreshOauthTokensJob', () => {
    it('memperpanjang token yang hampir habis', async () => {
      const { refreshOauthTokensJob, encryptMetaToken } = await load().then(async (m) => ({ ...m, ...(await import('./meta-token.js')) }));
      mocks.brandFindMany.mockResolvedValue([{ id: 1, metaAdsAccessToken: encryptMetaToken('OLD') }]);
      mocks.fetch.mockResolvedValue(jsonResponse({ access_token: 'NEW', expires_in: 5_184_000 }));
      await expect(refreshOauthTokensJob()).resolves.toEqual({ refreshed: 1, failed: 0 });
      expect(String(mocks.fetch.mock.calls[0]![1].body)).toContain('fb_exchange_token=OLD');
    });

    it('gagal: simpan error di brand dan lempar agar scheduler mencoba lagi', async () => {
      const { refreshOauthTokensJob, encryptMetaToken } = await load().then(async (m) => ({ ...m, ...(await import('./meta-token.js')) }));
      mocks.brandFindMany.mockResolvedValue([{ id: 1, metaAdsAccessToken: encryptMetaToken('OLD') }]);
      mocks.fetch.mockResolvedValue(jsonResponse({ error: { message: 'Session has expired' } }, false, 400));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(refreshOauthTokensJob()).rejects.toThrow(/gagal diperpanjang/);
      expect(mocks.brandUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, data: { metaLastError: expect.stringContaining('Session has expired') } }));
    });

    it('tidak menyentuh Meta di lingkungan non-production', async () => {
      const { refreshOauthTokensJob } = await load();
      mocks.allowed = false;
      await expect(refreshOauthTokensJob()).resolves.toEqual({ refreshed: 0, failed: 0 });
      expect(mocks.brandFindMany).not.toHaveBeenCalled();
    });
  });

  describe('callback', () => {
    async function call(query: (stateFor: (input: { brandId: number; userId: number; returnTo: string }) => string) => string) {
      const { metaOauthCallbackRouter, buildAuthorizeUrl } = await load();
      const stateFor = (input: { brandId: number; userId: number; returnTo: string }) => new URL(buildAuthorizeUrl(input)).searchParams.get('state')!;
      const app = express();
      app.use('/cb', metaOauthCallbackRouter);
      const server = app.listen(0);
      try {
        const { port } = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${port}/cb?${query(stateFor)}`, { redirect: 'manual' });
        return new URL(response.headers.get('location')!, 'http://x');
      } finally {
        server.close();
      }
    }
    // fetch global dipalsukan untuk Meta; callback test memakai fetch asli ke server lokal.
    beforeEach(() => {
      mocks.fetch.mockImplementation((url: string, init?: RequestInit) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : Promise.resolve(jsonResponse({ access_token: 'T', expires_in: 5_184_000 }))));
    });

    it('sukses: simpan token dan kembali ke halaman asal', async () => {
      mocks.brandFindUnique.mockResolvedValue({ id: 7 });
      mocks.userFindUnique.mockResolvedValue({ isActive: true, role: 'admin' });
      const location = await call((stateFor) => `code=C&state=${stateFor({ brandId: 7, userId: 2, returnTo: '/brands/7?tab=meta' })}`);
      expect(location.pathname).toBe('/brands/7');
      expect(location.searchParams.get('meta')).toBe('connected');
      expect(mocks.brandUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }));
    });

    it('pengguna tidak aktif ditolak dan token tidak disimpan', async () => {
      mocks.brandFindUnique.mockResolvedValue({ id: 7 });
      mocks.userFindUnique.mockResolvedValue({ isActive: false, role: 'admin' });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const location = await call((stateFor) => `code=C&state=${stateFor({ brandId: 7, userId: 2, returnTo: '/brands/7' })}`);
      expect(location.searchParams.get('reason')).toBe('failed');
      expect(mocks.brandUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metaAdsTokenSource: 'oauth' }) }));
    });

    it('izin ditolak di dialog Meta -> reason=denied', async () => {
      const location = await call((stateFor) => `error=access_denied&state=${stateFor({ brandId: 7, userId: 2, returnTo: '/brands/7' })}`);
      expect(location.searchParams.get('reason')).toBe('denied');
    });

    it('state palsu -> reason=expired tanpa menyentuh DB', async () => {
      const location = await call(() => 'code=C&state=palsu');
      expect(location.pathname).toBe('/brands');
      expect(location.searchParams.get('reason')).toBe('expired');
      expect(mocks.brandUpdate).not.toHaveBeenCalled();
    });
  });
});

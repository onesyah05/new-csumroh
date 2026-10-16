import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/prisma.js', () => ({ prisma: {} }));
const claimOnce = vi.fn(async () => true);
vi.mock('../notifications/jobs.js', () => ({ claimOnce: (key: string) => claimOnce(key) }));

async function load() {
  vi.resetModules();
  vi.stubEnv('META_APP_ID', '123456789');
  vi.stubEnv('META_APP_SECRET', 'app-secret-0123456789abcdef');
  vi.stubEnv('META_OAUTH_REDIRECT_URI', 'https://crm.example.com/api/v1/meta/oauth/callback');
  return import('./meta-oauth.js');
}

// Impor pertama memuat rantai modul besar (ad-insights, reports): beri waktu lebih.
describe('meta oauth', { timeout: 30_000 }, () => {
  beforeEach(() => {
    claimOnce.mockClear();
    claimOnce.mockResolvedValue(true);
  });

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
    claimOnce.mockResolvedValue(false);
    await expect(consumeState(state)).rejects.toThrow(/sudah dipakai/);
  });

  it('state palsu ditolak', async () => {
    const { consumeState } = await load();
    await expect(consumeState('bukan-jwt')).rejects.toThrow(/kedaluwarsa/);
  });
});

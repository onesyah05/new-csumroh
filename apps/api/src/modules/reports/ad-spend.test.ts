import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../capi/meta-token.js', () => ({ decryptMetaToken: () => 'TOKEN' }));
import { clearAdSpendCache, fetchAdSpend } from './ad-spend.js';

const brand = { id: 1, metaAdAccountId: '123', metaAccessToken: 'enc' };
const respond = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

describe('Biaya iklan dari Meta Insights', () => {
  beforeEach(() => clearAdSpendCache());
  afterEach(() => vi.unstubAllGlobals());

  it('meminta spend level akun untuk rentang tanggal dan meng-cache hasilnya', async () => {
    const fetchMock = respond(200, { data: [{ spend: '1250000.50', account_currency: 'IDR' }] });
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchAdSpend(brand, '2026-09-01', '2026-09-30')).toEqual({ status: 'ok', spend: 1250000.5, currency: 'IDR' });
    await fetchAdSpend(brand, '2026-09-01', '2026-09-30');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/act_123/insights?');
    expect(decodeURIComponent(url)).toContain('time_range={"since":"2026-09-01","until":"2026-09-30"}');
    expect(url).not.toContain('TOKEN');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
  });

  it('tanpa tayangan = biaya 0; tanpa ad account = belum diatur', async () => {
    vi.stubGlobal('fetch', respond(200, { data: [] }));
    expect(await fetchAdSpend(brand, '2026-09-01', '2026-09-02')).toEqual({ status: 'ok', spend: 0, currency: 'IDR' });
    expect(await fetchAdSpend({ ...brand, metaAdAccountId: null }, '2026-09-01', '2026-09-02')).toEqual({ status: 'not_configured' });
  });

  it('galat izin & token diterjemahkan, tidak di-cache', async () => {
    const fetchMock = respond(400, { error: { code: 200, message: 'Requires ads_read permission' } });
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchAdSpend(brand, '2026-09-01', '2026-09-30')).toEqual({ status: 'error', message: 'Token belum punya izin ads_read untuk ad account ini.' });
    vi.stubGlobal('fetch', respond(400, { error: { code: 190, message: 'expired' } }));
    expect(await fetchAdSpend(brand, '2026-09-01', '2026-09-30')).toMatchObject({ message: 'Access token Meta kedaluwarsa atau tidak valid.' });
  });
});

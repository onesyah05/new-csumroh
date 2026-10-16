import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  findFirst: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: { brand: { findUnique: mocks.findUnique, update: mocks.update }, prospect: { findFirst: mocks.findFirst } },
}));
vi.mock('../ads/ad-insights.js', () => ({ clearAdInsightsCache: vi.fn() }));
vi.mock('../reports/ad-spend.js', () => ({ clearAdSpendCache: vi.fn() }));
vi.mock('../ads/meta-ads.js', () => ({ adLabels: vi.fn(async () => new Map()) }));
vi.mock('./capi.service.js', () => ({ CAPI_MAX_EVENT_AGE_MS: 1, resendCapiLog: vi.fn() }));
vi.mock('./meta-token.js', () => ({
  decryptMetaToken: (value: string) => value,
  encryptMetaToken: (value: string) => `enc:${value}`,
  maskMetaToken: () => '••••',
  withAdsToken: <T>(brand: T) => brand,
}));

import { capiRouter } from './capi.routes.js';

const user = { id: 1, role: 'superadmin', brandId: 1, userBrands: [] };

function call(method: 'put' | 'post', path: string, body: Record<string, unknown>) {
  const layer = (capiRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  return new Promise<any>((resolve, reject) => {
    const res = { status: () => res, json: (payload: any) => resolve(payload.data) };
    layer.route.stack.at(-1).handle({ body, query: {}, user }, res, reject);
  });
}

const stored = { id: 1, metaAccessToken: 'enc:CAPI', metaAdsAccessToken: null, metaAdAccountId: '111', metaPixelId: '555' };
const form = { brandId: 1, pixelId: '555', facebookPageId: '1', whatsappBusinessAccountId: '', adAccountId: '111', testEventCode: '' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.findUnique.mockResolvedValue(stored);
  mocks.update.mockImplementation(async ({ data }: any) => ({ ...stored, name: 'Hana', ...data }));
});

describe('status verifikasi dataset Meta', () => {
  it('mengganti akun iklan tidak membatalkan verifikasi', async () => {
    await call('put', '/settings', { ...form, adAccountId: '222' });
    expect(mocks.update.mock.calls[0]![0].data).not.toHaveProperty('metaVerifiedAt');
  });

  it('menyimpan token iklan tidak membatalkan verifikasi', async () => {
    await call('put', '/settings', { ...form, adsAccessToken: 'ADS' });
    expect(mocks.update.mock.calls[0]![0].data).not.toHaveProperty('metaVerifiedAt');
  });

  it('mengganti Pixel/Dataset ID membatalkan verifikasi', async () => {
    await call('put', '/settings', { ...form, pixelId: '999' });
    expect(mocks.update.mock.calls[0]![0].data.metaVerifiedAt).toBeNull();
  });

  it('mengganti token CAPI membatalkan verifikasi', async () => {
    await call('put', '/settings', { ...form, accessToken: 'NEW' });
    expect(mocks.update.mock.calls[0]![0].data.metaVerifiedAt).toBeNull();
  });

  it('event uji yang diterima Meta menandai dataset terverifikasi', async () => {
    mocks.findUnique.mockResolvedValue({ ...stored, facebookPageId: '1', metaWabaId: null, metaTestEventCode: 'TEST1' });
    mocks.findFirst.mockResolvedValue({ id: 3, name: 'Syf', phone: '62811', city: null, metaReferralMarker: 'ctwa-abc' });
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{"events_received":1}' });
    const result = await call('post', '/test-event', { brandId: 1, eventName: 'Purchase' });
    expect(result.status).toBe('success');
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metaVerifiedAt: expect.any(Date) }) }));
  });

  it('event uji ditolak Meta tidak menandai terverifikasi', async () => {
    mocks.findUnique.mockResolvedValue({ ...stored, facebookPageId: '1', metaWabaId: null, metaTestEventCode: 'TEST1' });
    mocks.findFirst.mockResolvedValue({ id: 3, name: 'Syf', phone: '62811', city: null, metaReferralMarker: 'ctwa-abc' });
    mocks.fetch.mockResolvedValue({ ok: false, status: 400, text: async () => '{"error":{}}' });
    const result = await call('post', '/test-event', { brandId: 1, eventName: 'Purchase' });
    expect(result.status).toBe('failed');
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

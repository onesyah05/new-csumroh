import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), upsert: vi.fn(), brand: vi.fn() }));
vi.mock('../../db/prisma.js', () => ({
  prisma: { metaAd: { findMany: mocks.findMany, upsert: mocks.upsert }, brand: { findUnique: mocks.brand } },
}));
vi.mock('../capi/meta-token.js', () => ({
  decryptMetaToken: (v: string) => v,
  withAdsToken: (b: any) => ({ ...b, metaAccessToken: b.metaAdsAccessToken || b.metaAccessToken }),
}));

import { adLabels, ensureAdLabels, isMetaCdnUrl, withAdPreviews } from './meta-ads.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brand.mockResolvedValue({ metaAccessToken: 'capi', metaAdsAccessToken: 'ads' });
});

describe('Label iklan Meta', () => {
  it('membaca nama iklan tersimpan dan mengabaikan ID yang tidak valid', async () => {
    mocks.findMany.mockResolvedValue([{ adId: '120254', adName: 'H062 | VID', campaignName: 'Hana OCT26', thumbnailUrl: null }]);
    const labels = await adLabels(['120254', null, 'bukan-id']);
    expect(mocks.findMany.mock.calls[0]![0].where.adId.in).toEqual(['120254']);
    expect(labels.get('120254')?.adName).toBe('H062 | VID');
  });

  it('iklan yang belum tersimpan diambil dari Meta memakai token ads_read lalu disimpan', async () => {
    mocks.findMany.mockResolvedValue([]);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ '120255': { name: 'H064 | REG', campaign: { name: 'New Hana DES26' } } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const labels = await ensureAdLabels(1, ['120255']);
    expect(labels.get('120255')).toMatchObject({ adName: 'H064 | REG', campaignName: 'New Hana DES26' });
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ headers: { Authorization: 'Bearer ads' } });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it('pesan klik iklan mendapat kartu Ad; pesan biasa tidak, dan URL gambar non-Meta dibuang', async () => {
    mocks.findMany.mockResolvedValue([{ adId: '9120254', adName: 'H062 | VID', campaignName: null, thumbnailUrl: null }]);
    const [ad, plain, foreign] = await withAdPreviews([
      { metaReferralData: { ctwaClid: 'AR-1', adId: '9120254', headline: 'Umroh Desember', thumbnailUrl: 'https://scontent.xx.fbcdn.net/a.jpg' } },
      { metaReferralData: null },
      { metaReferralData: { ctwaClid: 'AR-2', thumbnailUrl: 'https://evil.example/a.jpg' } },
    ]);
    expect(ad!.adPreview).toMatchObject({ adId: '9120254', title: 'Umroh Desember', adName: 'H062 | VID', thumbnailUrl: 'https://scontent.xx.fbcdn.net/a.jpg' });
    expect(plain!.adPreview).toBeNull();
    expect(foreign!.adPreview?.thumbnailUrl).toBeNull();
    expect(isMetaCdnUrl('http://scontent.fbcdn.net/a.jpg')).toBe(false);
    expect(isMetaCdnUrl('https://fbcdn.net.evil.com/a.jpg')).toBe(false);
  });

  it('kegagalan Meta tidak menggagalkan halaman', async () => {
    mocks.findMany.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const labels = await ensureAdLabels(1, ['120256']);
    expect(labels.size).toBe(0);
  });
});

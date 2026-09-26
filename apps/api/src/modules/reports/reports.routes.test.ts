import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const mocks = vi.hoisted(() => ({
  prospectFindMany: vi.fn(),
  prospectGroupBy: vi.fn(),
  prospectCount: vi.fn(),
  paymentFindMany: vi.fn(),
  paymentCount: vi.fn(),
  rejectionCount: vi.fn(),
  logFindMany: vi.fn(),
  userFindMany: vi.fn(),
  queryRaw: vi.fn(),
  brandFindMany: vi.fn(),
  brandFindUniqueOrThrow: vi.fn(),
  fetchAdSpend: vi.fn(),
  fetchAdInsights: vi.fn(),
  syncSpamAudience: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    prospect: { findMany: mocks.prospectFindMany, groupBy: mocks.prospectGroupBy, count: mocks.prospectCount },
    payment: { findMany: mocks.paymentFindMany, count: mocks.paymentCount },
    paymentProofRejection: { count: mocks.rejectionCount },
    prospectLog: { findMany: mocks.logFindMany },
    user: { findMany: mocks.userFindMany },
    brand: { findMany: mocks.brandFindMany, findUniqueOrThrow: mocks.brandFindUniqueOrThrow },
    $queryRaw: mocks.queryRaw,
  },
}));
vi.mock('../../middleware/auth.js', () => ({
  authGuard: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  scopedBrandId: (_req: any, requested?: number) => requested ?? 1,
}));

vi.mock('./ad-spend.js', () => ({ fetchAdSpend: mocks.fetchAdSpend }));
vi.mock('../ads/ad-insights.js', () => ({ fetchAdInsights: mocks.fetchAdInsights }));
vi.mock('../ads/spam-audience.js', () => ({ syncSpamAudience: mocks.syncSpamAudience, SpamAudienceError: class extends Error {} }));

import { reportsRouter } from './reports.routes.js';

function get(path: string, query: Row = {}) {
  const layer = (reportsRouter as any).stack.find((l: any) => l.route?.path === path);
  return new Promise<any>((resolve, reject) => {
    const res: any = {
      headers: {} as Row,
      setHeader: (k: string, v: string) => { res.headers[k] = v; },
      json: (body: any) => resolve(body.data),
      send: (body: any) => resolve({ body, headers: res.headers }),
    };
    layer.route.stack.at(-1).handle({ query: { from: '2026-09-01', to: '2026-09-30', ...query }, user: { id: 1, role: 'admin' } }, res, reject);
  });
}

const deal = (overrides: Row = {}): Row => ({
  amount: 10_000_000, createdAt: new Date('2026-09-11T03:00:00.000Z'), bankName: 'BSI',
  prospect: {
    id: 1, createdAt: new Date('2026-09-01T03:00:00.000Z'), dealValue: 40_000_000, paymentStatus: 'partial_dp', userId: 7, leadSource: 'meta_ads',
    brand: { name: 'Hana Tours' }, package: { name: 'Umroh Syawal' }, user: { name: 'Aisyah' }, ...overrides,
  },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prospectCount.mockResolvedValue(0);
});

describe('Laporan penjualan', () => {
  it('lead periode per tahap, deal dari pembayaran terverifikasi, dan rentang tanggal WIB', async () => {
    mocks.prospectFindMany.mockResolvedValueOnce([{ status: 'new' }, { status: 'identifying' }, { status: 'closed_won' }, { status: 'lose' }]);
    mocks.prospectCount.mockResolvedValueOnce(6);
    mocks.paymentFindMany.mockResolvedValueOnce([deal(), deal({ package: null, dealValue: 60_000_000 })]);
    const data = await get('/sales', { brandId: '2' });
    expect(data.summary).toMatchObject({ leads: 4, spam: 6, deals: 2, lost: 1, conversion: 50, dealValue: 100_000_000, cashIn: 20_000_000, avgDaysToDeal: 10 });
    expect(data.stages.find((s: Row) => s.key === 'contact').count).toBe(1);
    expect(data.byPackage.map((p: Row) => p.label)).toEqual(['Layanan custom / tanpa paket', 'Umroh Syawal']);
    const where = mocks.prospectFindMany.mock.calls[0]![0].where;
    expect(where.brandId).toBe(2);
    expect(where.spamAt).toBeNull();
    expect(where.createdAt.gte.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(mocks.paymentFindMany.mock.calls[0]![0].where.status).toBe('verified');
  });

  it('CSV aman dari formula dan diawali BOM', async () => {
    mocks.prospectFindMany.mockResolvedValueOnce([]);
    mocks.paymentFindMany.mockResolvedValueOnce([deal({ package: { name: '=HYPERLINK("x")' } })]);
    const { body, headers } = await get('/sales', { format: 'csv' });
    expect(body.startsWith('﻿"Paket","Deal","Nilai deal"')).toBe(true);
    expect(body).toContain(`"'=HYPERLINK(""x"")"`);
    expect(headers['Content-Disposition']).toMatch(/laporan-penjualan-/);
  });

  it('menolak tanggal tidak valid', async () => {
    await expect(get('/sales', { from: '01-09-2026' })).rejects.toThrow();
  });
});

describe('Laporan kinerja CS', () => {
  it('lead, deal, balas pertama (median), diambil alih, dan follow-up terlambat per CS', async () => {
    mocks.userFindMany.mockResolvedValueOnce([{ id: 7, name: 'Aisyah', isActive: true }, { id: 8, name: 'Budi', isActive: false }]);
    mocks.prospectFindMany.mockResolvedValueOnce([{ id: 1, userId: 7 }, { id: 2, userId: 7 }]);
    mocks.paymentFindMany.mockResolvedValueOnce([deal()]);
    mocks.prospectGroupBy.mockResolvedValueOnce([{ userId: 7, _count: 5 }]).mockResolvedValueOnce([{ userId: 7, _count: 2 }]);
    mocks.logFindMany.mockResolvedValueOnce([{ title: 'PIC diambil alih oleh Citra dari Aisyah' }]);
    mocks.queryRaw.mockResolvedValueOnce([{ prospect_id: 1, first_in: 1000, first_out: 1600 }, { prospect_id: 2, first_in: 1000, first_out: null }]);
    const { rows } = await get('/cs');
    expect(rows).toEqual([expect.objectContaining({ name: 'Aisyah', leads: 2, deals: 1, conversion: 50, dealValue: 40_000_000, medianReplyMinutes: 10, takenOver: 1, openNow: 5, overdueFollowups: 2 })]);
  });
});

describe('Laporan sumber lead & alasan batal', () => {
  it('mengelompokkan per sumber dengan konversi', async () => {
    mocks.prospectFindMany.mockResolvedValueOnce([
      { leadSource: 'meta_ads', status: 'deal', dealValue: 30_000_000 },
      { leadSource: 'meta_ads', status: 'lose', dealValue: null },
      { leadSource: null, status: 'new', dealValue: null },
    ]);
    const data = await get('/sources');
    expect(data.rows[0]).toMatchObject({ label: 'Meta Ads', leads: 2, deals: 1, lost: 1, conversion: 50, dealValue: 30_000_000 });
    expect(data.rows[1]).toMatchObject({ label: 'WhatsApp', open: 1 });
  });

  it('alasan batal dihitung sekali per prospek yang masih batal; keberatan dengan tingkat tembus deal', async () => {
    mocks.logFindMany
      .mockResolvedValueOnce([
        { prospectId: 1, prospect: { lostReason: 'Harga terlalu tinggi', status: 'lose' } },
        { prospectId: 1, prospect: { lostReason: 'Harga terlalu tinggi', status: 'lose' } },
        { prospectId: 2, prospect: { lostReason: null, status: 'closed_lost' } },
        { prospectId: 3, prospect: { lostReason: 'Jadwal', status: 'followup' } },
      ])
      .mockResolvedValueOnce([
        { prospectId: 4, prospect: { objectionCategory: 'price', status: 'deal' } },
        { prospectId: 5, prospect: { objectionCategory: 'price', status: 'lose' } },
      ]);
    const data = await get('/lost');
    expect(data.totalLost).toBe(2);
    expect(data.reasons).toEqual([{ reason: 'Harga terlalu tinggi', count: 1, share: 50 }, { reason: 'Tanpa alasan', count: 1, share: 50 }]);
    expect(data.objections[0]).toMatchObject({ count: 2, won: 1, lost: 1, winRate: 50 });
  });
});

describe('Laporan pembayaran', () => {
  it('memisahkan DP & Lunas, per bank, dan invoice berjalan', async () => {
    mocks.paymentFindMany.mockResolvedValueOnce([deal(), deal({ paymentStatus: 'paid_full' })]);
    mocks.paymentCount.mockResolvedValueOnce(1);
    mocks.rejectionCount.mockResolvedValueOnce(3);
    mocks.prospectFindMany.mockResolvedValueOnce([
      { invoiceAmount: 5_000_000, invoiceDueAt: new Date('2020-01-01'), paymentProofUrl: null },
      { invoiceAmount: 7_000_000, invoiceDueAt: null, paymentProofUrl: '/p.jpg' },
    ]);
    const data = await get('/payments');
    expect(data.summary).toMatchObject({ count: 2, amount: 20_000_000, dpCount: 1, fullCount: 1, reversed: 1, rejected: 3, openInvoices: 2, openInvoiceAmount: 12_000_000, overdueInvoices: 1, waitingVerification: 1 });
    expect(data.byBank).toEqual([{ bankName: 'BSI', count: 2, amount: 20_000_000 }]);
  });
});

describe('Laporan iklan Meta', () => {
  it('ROAS dari nilai deal (bukan nominal pembayaran); brand tanpa ad account atau non-IDR tidak dihitung', async () => {
    mocks.brandFindMany.mockResolvedValueOnce([
      { id: 1, name: 'Hana', metaAdAccountId: '111', metaAccessToken: 'x' },
      { id: 2, name: 'Nava', metaAdAccountId: null, metaAccessToken: 'x' },
      { id: 3, name: 'Zam', metaAdAccountId: '333', metaAccessToken: 'x' },
    ]);
    mocks.prospectGroupBy.mockResolvedValueOnce([{ brandId: 1, _count: 50 }, { brandId: 2, _count: 9 }]);
    mocks.paymentFindMany.mockResolvedValueOnce([
      { brandId: 1, prospect: { dealValue: 40_000_000 } },
      { brandId: 1, prospect: { dealValue: 35_000_000 } },
    ]);
    mocks.fetchAdSpend
      .mockResolvedValueOnce({ status: 'ok', spend: 5_000_000, currency: 'IDR' })
      .mockResolvedValueOnce({ status: 'not_configured' })
      .mockResolvedValueOnce({ status: 'ok', spend: 300, currency: 'USD' });
    const data = await get('/ads');
    expect(mocks.fetchAdSpend.mock.calls[0]!.slice(1)).toEqual(['2026-09-01', '2026-09-30']);
    expect(data.rows[0]).toMatchObject({ spend: 5_000_000, leads: 50, deals: 2, purchaseValue: 75_000_000, cpl: 100_000, cac: 2_500_000, roas: 15 });
    expect(data.rows[1]).toMatchObject({ status: 'not_configured', spend: null, leads: 9, roas: null });
    expect(data.rows[2]).toMatchObject({ spend: null, message: 'Mata uang ad account USD, bukan IDR.' });
    expect(data.summary).toMatchObject({ spend: 5_000_000, leads: 50, deals: 2, roas: 15, measuredBrands: 1, brands: 3 });
    expect(mocks.paymentFindMany.mock.calls[0]![0].where.prospect).toEqual({ leadSource: 'meta_ads' });
  });
});

describe('Laporan kreatif iklan', () => {
  it('menggabungkan metrik Meta per iklan dengan lead, spam, terkualifikasi, deal, dan ROAS dari CRM', async () => {
    mocks.brandFindMany.mockResolvedValueOnce([{ id: 1, name: 'Hana', metaAdAccountId: '111', metaAccessToken: 'x' }]);
    mocks.fetchAdInsights.mockResolvedValueOnce({ status: 'ok', ads: [
      { adId: 'A1', adName: 'Video testimoni', campaignName: 'Ramadan', spend: 2_000_000, impressions: 50_000, clicks: 900, ctr: 1.8, conversations: 40, currency: 'IDR', thumbnailUrl: '/uploads/ad-creatives/A1.jpg' },
      { adId: 'A2', adName: 'Carousel harga', campaignName: 'Ramadan', spend: 1_000_000, impressions: 30_000, clicks: 300, ctr: 1, conversations: 25, currency: 'IDR', thumbnailUrl: null },
    ] });
    // Lead periode ini (pesan pertama berreferral), lalu prospek yang membayar.
    mocks.queryRaw
      .mockResolvedValueOnce([
        { prospect_id: 1, brand_id: 1, status: 'offer', spam: 0, ad_id: 'A1' },
        { prospect_id: 2, brand_id: 1, status: 'new', spam: 0, ad_id: 'A1' },
        { prospect_id: 3, brand_id: 1, status: 'new', spam: 1, ad_id: 'A2' },
        { prospect_id: 4, brand_id: 1, status: 'contact', spam: 0, ad_id: 'A2' },
      ])
      .mockResolvedValueOnce([{ prospect_id: 1, brand_id: 1, status: 'deal', spam: 0, ad_id: 'A1' }]);
    mocks.paymentFindMany.mockResolvedValueOnce([{ prospectId: 1, prospect: { dealValue: 40_000_000 } }]);
    const { rows, brands } = await get('/creatives');
    expect(brands).toEqual([{ brandId: 1, brand: 'Hana', status: 'ok', message: null }]);
    expect(rows[0]).toMatchObject({ adId: 'A1', leads: 2, spam: 0, qualified: 1, deals: 1, dealValue: 40_000_000, costPerLead: 1_000_000, costPerDeal: 2_000_000, roas: 20, thumbnailUrl: '/uploads/ad-creatives/A1.jpg' });
    expect(rows[1]).toMatchObject({ adId: 'A2', leads: 1, spam: 1, spamRate: 50, qualified: 0, deals: 0, roas: 0, costPerQualified: null });
  });
});

describe('Audiens spam', () => {
  it('ringkasan jumlah nomor spam dan CSV nomor untuk unggah manual', async () => {
    mocks.prospectCount.mockResolvedValueOnce(3);
    mocks.brandFindUniqueOrThrow.mockResolvedValueOnce({ metaSpamAudienceId: null, metaSpamSyncedAt: null, metaAdAccountId: '1', metaAccessToken: 'x' });
    expect(await get('/spam-audience', { brandId: '1' })).toEqual({ count: 3, audienceId: null, syncedAt: null, ready: true });
    mocks.prospectFindMany.mockResolvedValueOnce([{ phone: '0812-111' }, { phone: '62812111' }]);
    const { body } = await get('/spam-audience', { brandId: '1', format: 'csv' });
    expect(body).toBe('﻿"phone"\r\n"62812111"');
  });
});

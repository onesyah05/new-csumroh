import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prospect: null as Record<string, any> | null,
  logs: new Map<string, { status: string; createdAt: Date }>(),
  sent: [] as any[],
  retryLogs: [] as any[],
  backfillProspects: [] as any[],
  notified: 0,
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    prospect: { findUnique: async () => mocks.prospect, findMany: async () => mocks.backfillProspects },
    metaCapiLog: {
      findUnique: async ({ where }: any) => mocks.logs.get(where.brandId_eventId.eventId) ?? null,
      findMany: async () => mocks.retryLogs,
      upsert: async ({ where, create, update }: any) => {
        const prev = mocks.logs.get(where.brandId_eventId.eventId);
        mocks.logs.set(where.brandId_eventId.eventId, { status: prev ? update.status : create.status, createdAt: prev?.createdAt ?? new Date() });
      },
      update: async ({ where, data }: any) => {
        const prev = mocks.logs.get(where.brandId_eventId.eventId)!;
        mocks.logs.set(where.brandId_eventId.eventId, { ...prev, status: data.status });
      },
    },
  },
}));
vi.mock('./meta-token.js', () => ({ decryptMetaToken: () => 'TOKEN' }));
vi.mock('../notifications/notification.events.js', () => ({ dispatch: () => { mocks.notified += 1; }, notifyCapiFailed: async () => 0 }));

import { backfillCapiEvents, capiRetryDelayMs, capiSyncJob, dispatchCapiEvent, dispatchCapiForStatus, expectedCapiEvents, retryFailedCapiEvents } from './capi.service.js';

const brand = { metaPixelId: '1', metaAccessToken: 'enc', facebookPageId: '2', metaWabaId: '3', metaTestEventCode: 'TEST123' };
const base = {
  id: 5, brandId: 1, phone: '6281234', metaReferralMarker: 'AR-click', spamAt: null, closedWonCount: 0, dealValue: 0, invoiceAmount: 0,
  createdAt: new Date(), updatedAt: new Date(), offerSentAt: null, invoiceSentAt: null, dpPaidAt: null, brand, package: null,
};
const names = () => mocks.sent.map((body) => body.data[0].event_name);

beforeEach(() => {
  mocks.logs = new Map();
  mocks.sent = [];
  mocks.retryLogs = [];
  mocks.backfillProspects = [];
  mocks.notified = 0;
  mocks.prospect = { ...base };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    mocks.sent.push(JSON.parse(String(init.body)));
    return { ok: true, status: 200, text: async () => '{"events_received":1}', json: async () => ({ events_received: 1 }) };
  }));
});

describe('Aturan event CAPI', () => {
  it('QualifiedLead dikirim sekali saat prospek terkualifikasi atau tahap sesudahnya', async () => {
    await dispatchCapiForStatus(5, 'qualified');
    expect(names()).toEqual(['QualifiedLead']);
    mocks.prospect = { ...base, offerSentAt: new Date(), dealValue: 40_000_000 };
    await dispatchCapiForStatus(5, 'offer');
    expect(names()).toEqual(['QualifiedLead', 'AddToCart']);
  });

  it('chat pertama hanya LeadSubmitted, bukan QualifiedLead', async () => {
    await dispatchCapiForStatus(5, 'contact');
    expect(names()).toEqual(['LeadSubmitted']);
  });

  it('prospek spam tidak pernah dikirim ke Meta', async () => {
    mocks.prospect = { ...base, spamAt: new Date(), offerSentAt: new Date() };
    const result = await dispatchCapiForStatus(5, 'offer');
    expect(result).toMatchObject({ status: 'skipped', reason: 'SPAM' });
    expect(mocks.sent).toEqual([]);
  });

  it('Test Event Code brand tidak ikut di event sungguhan', async () => {
    await dispatchCapiEvent(5, 'LeadSubmitted');
    expect(mocks.sent[0].test_event_code).toBeUndefined();
  });

  it('kontak @lid tanpa nomor tetap dikirim (tanpa hash nomor)', async () => {
    mocks.prospect = { ...base, phone: null };
    expect(await dispatchCapiEvent(5, 'LeadSubmitted')).toMatchObject({ status: 'sent' });
    expect(mocks.sent[0].data[0].user_data.ph).toBeUndefined();
    expect(mocks.sent[0].data[0].user_data.ctwa_clid).toBe('AR-click');
  });

  it('kejadian lebih dari 7 hari tidak dikirim (Meta menolak)', async () => {
    mocks.prospect = { ...base, createdAt: new Date(Date.now() - 8 * 86_400_000) };
    expect(await dispatchCapiEvent(5, 'LeadSubmitted')).toMatchObject({ status: 'skipped', reason: 'TOO_OLD' });
    expect(mocks.sent).toEqual([]);
  });

  it('retry dan backfill tidak mengirim notifikasi', async () => {
    mocks.prospect = { ...base, brand: { ...brand, facebookPageId: null } };
    await dispatchCapiEvent(5, 'LeadSubmitted', { notify: false });
    expect(mocks.notified).toBe(0);
    await dispatchCapiEvent(5, 'QualifiedLead');
    expect(mocks.notified).toBe(1);
  });
});

describe('Retry & backfill CAPI', () => {
  it('job sinkron hanya jalan di produksi', async () => {
    mocks.retryLogs = [{ prospectId: 5, eventName: 'LeadSubmitted', attempts: 1, updatedAt: new Date(0), status: 'failed' }];
    const at = new Date('2026-09-30T03:05:00Z');
    expect(await capiSyncJob(at, 'development')).toEqual({ retried: 0, backfilled: 0 });
    expect(mocks.sent).toEqual([]);
    expect(await capiSyncJob(at, 'production')).toEqual({ retried: 1, backfilled: 0 });
  });

  it('jeda retry berlipat: 15 menit, 30 menit, 1 jam', () => {
    expect([1, 2, 3].map(capiRetryDelayMs)).toEqual([15 * 60_000, 30 * 60_000, 60 * 60_000]);
  });

  it('hanya mengirim ulang log yang jedanya sudah lewat', async () => {
    const now = new Date();
    mocks.logs.set('csumroh_prospect_5_contact', { status: 'failed', createdAt: now });
    mocks.retryLogs = [
      { prospectId: 5, eventName: 'LeadSubmitted', attempts: 1, updatedAt: new Date(now.getTime() - 20 * 60_000), status: 'failed' },
      { prospectId: 5, eventName: 'QualifiedLead', attempts: 2, updatedAt: new Date(now.getTime() - 20 * 60_000), status: 'failed' },
    ];
    expect(await retryFailedCapiEvents(now)).toBe(1);
    expect(names()).toEqual(['LeadSubmitted']);
  });

  it('backfill mengirim event tahap yang belum pernah tercatat', async () => {
    expect(expectedCapiEvents('offer')).toEqual(['LeadSubmitted', 'QualifiedLead', 'AddToCart']);
    mocks.prospect = { ...base, offerSentAt: new Date(), dealValue: 40_000_000 };
    mocks.backfillProspects = [{ id: 5, status: 'offer', createdAt: new Date(), capiLogs: [{ eventName: 'LeadSubmitted' }] }];
    expect(await backfillCapiEvents()).toBe(2);
    expect(names()).toEqual(['QualifiedLead', 'AddToCart']);
  });
});

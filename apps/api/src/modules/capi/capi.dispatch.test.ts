import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prospect: null as Record<string, any> | null,
  logs: new Map<string, { status: string }>(),
  sent: [] as string[],
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    prospect: { findUnique: async () => mocks.prospect },
    metaCapiLog: {
      findUnique: async ({ where }: any) => mocks.logs.get(where.brandId_eventId.eventId) ?? null,
      upsert: async ({ where, create }: any) => { mocks.logs.set(where.brandId_eventId.eventId, { status: create.status }); },
      update: async ({ where, data }: any) => { mocks.logs.set(where.brandId_eventId.eventId, { status: data.status }); },
    },
  },
}));
vi.mock('./meta-token.js', () => ({ decryptMetaToken: () => 'TOKEN' }));
vi.mock('../notifications/notification.events.js', () => ({ dispatch: () => undefined, notifyCapiFailed: async () => 0 }));

import { dispatchCapiForStatus } from './capi.service.js';

const brand = { metaPixelId: '1', metaAccessToken: 'enc', facebookPageId: '2', metaWabaId: '3', metaTestEventCode: null };
const base = {
  id: 5, brandId: 1, phone: '6281234', metaReferralMarker: 'AR-click', spamAt: null, closedWonCount: 0, dealValue: 0, invoiceAmount: 0,
  createdAt: new Date(), updatedAt: new Date(), offerSentAt: null, invoiceSentAt: null, dpPaidAt: null, brand, package: null,
};

beforeEach(() => {
  mocks.logs = new Map();
  mocks.sent = [];
  mocks.prospect = { ...base };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    mocks.sent.push(JSON.parse(String(init.body)).data[0].event_name);
    return { ok: true, status: 200, text: async () => '{"events_received":1}', json: async () => ({ events_received: 1 }) };
  }));
});

describe('Aturan event CAPI', () => {
  it('Lead dikirim sekali saat prospek terkualifikasi atau tahap sesudahnya', async () => {
    await dispatchCapiForStatus(5, 'qualified');
    expect(mocks.sent).toEqual(['Lead']);
    mocks.prospect = { ...base, offerSentAt: new Date(), dealValue: 40_000_000 };
    await dispatchCapiForStatus(5, 'offer');
    expect(mocks.sent).toEqual(['Lead', 'AddToCart']);
  });

  it('chat pertama hanya Contact, bukan Lead', async () => {
    await dispatchCapiForStatus(5, 'contact');
    expect(mocks.sent).toEqual(['Contact']);
  });

  it('prospek spam tidak pernah dikirim ke Meta', async () => {
    mocks.prospect = { ...base, spamAt: new Date() };
    mocks.prospect.offerSentAt = new Date();
    const result = await dispatchCapiForStatus(5, 'offer');
    expect(result).toMatchObject({ status: 'skipped', reason: 'SPAM' });
    expect(mocks.sent).toEqual([]);
  });
});

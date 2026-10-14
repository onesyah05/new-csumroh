import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  allowed: false,
  fetch: vi.fn(),
  prospect: null as null | Record<string, unknown>,
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('./send-guard.js', () => ({ isMetaSendingAllowed: () => mocks.allowed }));
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    prospect: { findUnique: async () => mocks.prospect },
    metaCapiLog: { findUnique: async () => null, upsert: mocks.upsert, update: mocks.update, updateMany: mocks.updateMany },
  },
}));
vi.mock('../notifications/notification.events.js', () => ({ dispatch: (task: () => unknown) => task(), notifyCapiFailed: vi.fn() }));
vi.mock('./meta-token.js', () => ({ decryptMetaToken: (value: string) => value }));

import { dispatchCapiEvent, resendCapiLog } from './capi.service.js';

const brand = { metaPixelId: '111', metaAccessToken: 'TOKEN', facebookPageId: '222', metaWabaId: null };
const now = Date.now();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
  mocks.allowed = false;
  mocks.prospect = {
    id: 7, brandId: 1, name: 'Ahmad', phone: '62811', city: 'Solo', status: 'qualified', spamAt: null, metaReferralMarker: 'ctwa-abc',
    createdAt: new Date(now - 5 * 86_400_000), offerSentAt: null, invoiceSentAt: null, dpPaidAt: null, closedWonCount: 0,
    dealValue: 0, invoiceAmount: 0, qualifiedAt: new Date(now - 2 * 86_400_000), brand, package: null,
  };
});

describe('CAPI di luar production', () => {
  it('event tidak dikirim dan tidak dicatat; log yang ada tidak ditutup', async () => {
    const result = await dispatchCapiEvent(7, 'QualifiedLead');
    expect(result).toMatchObject({ status: 'skipped', reason: 'NON_PRODUCTION' });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();

    await resendCapiLog({ brandId: 1, prospectId: 7, eventName: 'QualifiedLead', eventId: 'csumroh_prospect_7_lead' });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe('waktu kejadian QualifiedLead', () => {
  it('memakai qualifiedAt (bukan waktu kirim) sebagai event_time', async () => {
    mocks.allowed = true;
    const result = await dispatchCapiEvent(7, 'QualifiedLead');
    expect(result.status).toBe('sent');
    const body = JSON.parse((mocks.fetch.mock.calls[0]![1] as { body: string }).body);
    const qualifiedAt = (mocks.prospect!.qualifiedAt as Date).getTime();
    expect(body.data[0].event_time).toBe(Math.floor(qualifiedAt / 1000));
  });
});

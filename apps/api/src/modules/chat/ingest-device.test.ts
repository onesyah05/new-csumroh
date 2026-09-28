import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prospectFindMany: vi.fn(),
  prospectCreate: vi.fn(),
  prospectUpdate: vi.fn(),
  messageUpsert: vi.fn(),
  contactFindFirst: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    whatsappSession: { findUnique: async () => ({ brandId: 1, status: 'connected', phoneNumber: '628222' }) },
    brand: { findUnique: async () => ({ phone: null }) },
    prospect: { findMany: mocks.prospectFindMany, create: mocks.prospectCreate, update: mocks.prospectUpdate },
    chatMessage: { findUnique: async () => null, findFirst: async () => null, upsert: mocks.messageUpsert },
    whatsappContact: { findFirst: mocks.contactFindFirst },
  },
}));
vi.mock('./conversation-stats.js', () => ({ ensureConversationStats: vi.fn(), loadConversationWindows: vi.fn(), scheduleConversationStats: vi.fn(), summarizeMessages: vi.fn() }));
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: vi.fn() }));
vi.mock('../notifications/notification.events.js', () => ({
  dispatch: vi.fn(), notifyProspectsReleased: vi.fn(), onWhatsappStatus: vi.fn(), notifyPicChange: vi.fn(), resolveReplyNotifications: vi.fn(),
  notifyLeadAssigned: vi.fn(), notifyLeadUnassigned: vi.fn(), notifyInboundMessage: vi.fn(),
}));
vi.mock('../prospects/pic.js', () => ({ pickAutoAssignee: async () => null }));
vi.mock('../capi/capi.service.js', () => ({ dispatchCapiEvent: vi.fn(async () => undefined), queueCapiForStatus: vi.fn() }));
vi.mock('../prospects/referral.service.js', () => ({ attachReferralMarker: vi.fn(async () => false), normalizeReferralMarker: () => null }));

import { env } from '../../config/env.js';
import { internalRouter } from './chat.routes.js';
import { sendingDevicePhone } from './outbound.js';

function incoming(body: Record<string, unknown>) {
  const layer = (internalRouter as any).stack.find((l: any) => l.route?.path === '/messages/incoming');
  return new Promise<any>((resolve, reject) => {
    const res = { status: () => res, json: (payload: any) => resolve(payload.data) };
    layer.route.stack.at(-1).handle({ body, get: () => env.WA_GATEWAY_SECRET }, res, reject);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prospectFindMany.mockResolvedValue([]);
  mocks.prospectCreate.mockImplementation(async ({ data }: any) => ({ id: 9, userId: null, ...data }));
  mocks.messageUpsert.mockImplementation(async ({ create }: any) => ({ id: 1, ...create }));
  mocks.contactFindFirst.mockResolvedValue(null);
});

const base = { brandId: 1, messageId: 'M1', remoteJid: '62811@s.whatsapp.net', phone: '62811', text: 'halo', timestamp: 1_790_000_000 };

describe('Pesan WhatsApp masuk', () => {
  it('nama akun brand pada pesan keluar tidak menjadi nama kontak', async () => {
    await incoming({ ...base, isFromMe: true, senderName: 'Hana Tours Travel' });
    expect(mocks.prospectCreate.mock.calls[0]![0].data.name).toBe('+62811');
  });

  it('tanpa pushName, nama kontak WhatsApp tersimpan untuk device itu yang dipakai', async () => {
    mocks.contactFindFirst.mockResolvedValue({ name: 'Haikal Shahab' });
    await incoming({ ...base, isFromMe: true, senderName: 'Hana Tours Travel' });
    expect(mocks.contactFindFirst.mock.calls[0]![0].where.devicePhone).toBe('628222');
    expect(mocks.prospectCreate.mock.calls[0]![0].data.name).toBe('Haikal Shahab');
  });

  it('nomor device dari gateway lebih diutamakan daripada status sesi di database', async () => {
    await incoming({ ...base, senderName: 'Haikal', devicePhone: '628333:12@s.whatsapp.net' });
    expect(mocks.prospectFindMany.mock.calls[0]![0].where.devicePhone).toBe('628333');
    expect(mocks.messageUpsert.mock.calls[0]![0].create.devicePhone).toBe('628333');
  });

  it('nama pengirim pesan masuk dipakai sebagai nama kontak', async () => {
    await incoming({ ...base, senderName: 'Haikal' });
    expect(mocks.prospectCreate.mock.calls[0]![0].data.name).toBe('Haikal');
  });

  it('prospek dicocokkan hanya di device yang sedang tersambung, pesan dicatat dengan device-nya', async () => {
    await incoming({ ...base, senderName: 'Haikal' });
    expect(mocks.prospectFindMany.mock.calls[0]![0].where.devicePhone).toBe('628222');
    expect(mocks.prospectCreate.mock.calls[0]![0].data.devicePhone).toBe('628222');
    expect(mocks.messageUpsert.mock.calls[0]![0].create.devicePhone).toBe('628222');
  });
});

describe('Balas dari device aktif', () => {
  it('kontak milik nomor lain tidak bisa dibalas dari device aktif', () => {
    expect(() => sendingDevicePhone({ devicePhone: '628111' }, { phoneNumber: '628222' })).toThrow(/\+628111/);
    expect(sendingDevicePhone({ devicePhone: '628222' }, { phoneNumber: '628222' })).toBe('628222');
    expect(sendingDevicePhone({ devicePhone: null }, { phoneNumber: '628222' })).toBe('628222');
  });
});

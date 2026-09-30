import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prospectFindMany: vi.fn(),
  prospectCreate: vi.fn(),
  prospectUpdate: vi.fn(),
  messageUpsert: vi.fn(),
  contactFindFirst: vi.fn(),
  sessionUpdateMany: vi.fn(),
  prospectUpdateMany: vi.fn(),
  logCreate: vi.fn(),
  queueCapi: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    whatsappSession: { findUnique: async () => ({ brandId: 1, status: 'connected', phoneNumber: '628222' }), updateMany: mocks.sessionUpdateMany },
    brand: { findUnique: async () => ({ phone: null }) },
    prospect: { findMany: mocks.prospectFindMany, create: mocks.prospectCreate, update: mocks.prospectUpdate, updateMany: mocks.prospectUpdateMany },
    prospectLog: { create: mocks.logCreate },
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
vi.mock('../capi/capi.service.js', () => ({ dispatchCapiEvent: vi.fn(async () => undefined), queueCapiForStatus: mocks.queueCapi }));
vi.mock('../prospects/referral.service.js', () => ({ attachReferralMarker: vi.fn(async () => false), normalizeReferralMarker: () => null }));

import { env } from '../../config/env.js';
import { internalRouter } from './chat.routes.js';
import { gatewayFailure, prospectChatJid, sendingDevicePhone } from './outbound.js';

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
  mocks.prospectUpdateMany.mockResolvedValue({ count: 0 });
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

  it('kontak @lid tanpa nomor: nama dicari lewat ID @lid-nya', async () => {
    mocks.contactFindFirst.mockResolvedValue({ name: 'Dewi Maslakah' });
    await incoming({ ...base, remoteJid: '165803001380952@lid', phone: '', isFromMe: true });
    expect(mocks.contactFindFirst.mock.calls[0]![0].where.phone.in).toEqual(['165803001380952@lid']);
    expect(mocks.prospectCreate.mock.calls[0]![0].data.name).toBe('Dewi Maslakah');
  });

  it('nomor device dari gateway lebih diutamakan daripada status sesi di database', async () => {
    await incoming({ ...base, senderName: 'Haikal', devicePhone: '628333:12@s.whatsapp.net' });
    expect(mocks.prospectFindMany.mock.calls[0]![0].where.devicePhone).toBe('628333');
    expect(mocks.messageUpsert.mock.calls[0]![0].create.devicePhone).toBe('628333');
  });

  it('balasan dari HP menaikkan prospek Baru ke Terhubung dan mengantre event Meta', async () => {
    mocks.prospectUpdateMany.mockResolvedValue({ count: 1 });
    await incoming({ ...base, isFromMe: true });
    expect(mocks.prospectUpdateMany.mock.calls[0]![0]).toEqual({ where: { id: 9, status: 'new' }, data: { status: 'contact' } });
    expect(mocks.logCreate).toHaveBeenCalled();
    expect(mocks.queueCapi).toHaveBeenCalledWith(9, 'contact');
  });

  it('pesan masuk dari jamaah tidak mengubah status', async () => {
    await incoming({ ...base, senderName: 'Haikal' });
    expect(mocks.prospectUpdateMany).not.toHaveBeenCalled();
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

  it('kontak @lid tanpa nomor tetap punya tujuan kirim', () => {
    expect(prospectChatJid({ phone: null, remoteJid: '165803001380952@lid' })).toBe('165803001380952@lid');
    expect(prospectChatJid({ phone: '0811', remoteJid: '165803001380952@lid' })).toBe('62811@s.whatsapp.net');
    expect(prospectChatJid({ phone: null, remoteJid: '1203@g.us' })).toBe('1203@g.us');
    expect(prospectChatJid({ phone: null, remoteJid: null })).toBeNull();
  });

  it('pesan yang ditolak gateway tidak memutus sesi; gateway tak terjangkau atau 409 memutus', async () => {
    const rejected = await gatewayFailure(1, new Response('{}', { status: 500 }), 'ditolak');
    expect(rejected.message).toBe('ditolak');
    expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
    await gatewayFailure(1, new Response('{}', { status: 409 }), 'ditolak');
    await gatewayFailure(1, null, 'ditolak');
    expect(mocks.sessionUpdateMany).toHaveBeenCalledTimes(2);
  });
});

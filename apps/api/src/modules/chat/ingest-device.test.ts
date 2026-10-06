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
  stored: null as null | Record<string, unknown>,
  notifyInbound: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    whatsappSession: { findUnique: async () => ({ brandId: 1, status: 'connected', phoneNumber: '628222' }), updateMany: mocks.sessionUpdateMany },
    brand: { findUnique: async () => ({ phone: null }) },
    prospect: { findMany: mocks.prospectFindMany, create: mocks.prospectCreate, update: mocks.prospectUpdate, updateMany: mocks.prospectUpdateMany },
    prospectLog: { create: mocks.logCreate },
    chatMessage: { findUnique: async () => mocks.stored, findFirst: async () => null, upsert: mocks.messageUpsert },
    whatsappContact: { findFirst: mocks.contactFindFirst },
  },
}));
vi.mock('./conversation-stats.js', () => ({ ensureConversationStats: vi.fn(), loadConversationWindows: vi.fn(), scheduleConversationStats: vi.fn(), summarizeMessages: vi.fn() }));
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: vi.fn() }));
vi.mock('../notifications/notification.events.js', () => ({
  dispatch: (task: () => unknown) => task(), notifyProspectsReleased: vi.fn(), onWhatsappStatus: vi.fn(), notifyPicChange: vi.fn(), resolveReplyNotifications: vi.fn(),
  notifyLeadAssigned: vi.fn(), notifyLeadUnassigned: vi.fn(), notifyInboundMessage: mocks.notifyInbound,
}));
vi.mock('../capi/capi.service.js', () => ({ dispatchCapiEvent: vi.fn(async () => undefined), queueCapiForStatus: mocks.queueCapi }));
vi.mock('../prospects/referral.service.js', () => ({ attachReferralMarker: vi.fn(async () => false), normalizeReferralMarker: () => null, storedReferral: () => undefined }));

import { env } from '../../config/env.js';
import { internalRouter, laterMessageStatus } from './chat.routes.js';
import { gatewayFailure, prospectChatJid, sendingDevicePhone } from './outbound.js';

function incoming(body: Record<string, unknown>, path = '/messages/incoming') {
  const layer = (internalRouter as any).stack.find((l: any) => l.route?.path === path);
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

describe('Lead baru tanpa PIC otomatis', () => {
  it('lead baru dari jamaah tanpa PIC; semua CS brand diberi tahu (siapa cepat membalas menjadi PIC)', async () => {
    await incoming({ ...base });
    expect(mocks.prospectCreate.mock.calls[0]![0].data.userId).toBeNull();
    expect(mocks.notifyInbound).toHaveBeenCalledWith(expect.objectContaining({ userId: null }), expect.anything());
  });

  it('chat baru dari HP brand dan chat lama dari sinkron riwayat juga tanpa PIC', async () => {
    await incoming({ ...base, isFromMe: true });
    await incoming({ brandId: 1, messages: [{ ...base, messageId: 'H1' }] }, '/messages/history');
    for (const call of mocks.prospectCreate.mock.calls) expect(call[0].data.userId).toBeNull();
  });
});

describe('Batch riwayat dari gateway', () => {
  it('satu pesan rusak dilewati, pesan lain di batch tetap masuk; tipe pesan panjang dipotong', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await incoming({ brandId: 1, messages: [
      { ...base, messageId: 'BAD', timestamp: 'bukan angka' },
      { ...base, messageId: 'LONG', messageType: 'newsletterFollowerInviteMessageV2' },
    ] }, '/messages/history');
    const created = mocks.messageUpsert.mock.calls.map((call) => call[0].create);
    expect(created.map((item) => item.messageId)).toEqual(['LONG']);
    expect(created[0].messageType).toBe('newsletterFollowerInviteMessag');
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

  it('pesan ditolak atau sesi sedang menyambung ulang (409) tidak memutus sesi; hanya gateway tak terjangkau yang memutus', async () => {
    const rejected = await gatewayFailure(1, new Response('{}', { status: 500 }), 'ditolak');
    expect(rejected.message).toBe('ditolak');
    const reconnecting = await gatewayFailure(1, new Response('{}', { status: 409 }), 'ditolak');
    expect(reconnecting.message).toContain('menyambung ulang');
    expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
    await gatewayFailure(1, null, 'ditolak');
    expect(mocks.sessionUpdateMany).toHaveBeenCalledTimes(1);
  });
});

describe('Status dan isi pesan yang dikirim ulang', () => {
  it('status hanya maju; gagal hanya menggantikan pesan yang belum terkirim', () => {
    expect(laterMessageStatus('sent', 'pending')).toBe('sent');
    expect(laterMessageStatus('read', 'delivered')).toBe('read');
    expect(laterMessageStatus('sent', 'read')).toBe('read');
    expect(laterMessageStatus('pending', 'failed')).toBe('failed');
    expect(laterMessageStatus('delivered', 'failed')).toBe('delivered');
    expect(laterMessageStatus(undefined, 'pending')).toBe('pending');
  });

  it('gema kiriman CRM tidak menurunkan status dan tidak menimpa caption/media', async () => {
    mocks.stored = { prospectId: 9, status: 'sent', messageText: 'Brosur Umroh Desember', mediaUrl: '/uploads/media/a.jpg' };
    try {
      await incoming({ ...base, messageId: 'CRM1', isFromMe: true, status: 'pending', text: '[Gambar]', messageType: 'imageMessage', mediaUrl: '/uploads/media/b.jpg' });
      const update = mocks.messageUpsert.mock.calls.at(-1)![0].update;
      expect(update).toMatchObject({ status: 'sent', messageText: 'Brosur Umroh Desember' });
      expect(update.mediaUrl).toBeUndefined();
    } finally {
      mocks.stored = null;
    }
  });
});

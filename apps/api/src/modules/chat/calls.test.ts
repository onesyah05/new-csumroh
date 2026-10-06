import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stored: null as null | Record<string, unknown>,
  messageUpsert: vi.fn(),
  messageUpdate: vi.fn(),
  notifyIncomingCall: vi.fn(),
  notifyCallEnded: vi.fn(),
  notifyInboundMessage: vi.fn(),
  emitToBrand: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    whatsappSession: { findUnique: async () => ({ brandId: 1, status: 'connected', phoneNumber: '628222' }) },
    brand: { findUnique: async () => ({ phone: null }) },
    prospect: {
      findMany: async () => [{ id: 9, name: 'Pak Budi', phone: '62811', remoteJid: '62811@s.whatsapp.net', userId: 4 }],
      update: async ({ where }: any) => ({ id: where.id, name: 'Pak Budi', phone: '62811', remoteJid: '62811@s.whatsapp.net', userId: 4 }),
      findUnique: async ({ where }: any) => ({ id: where.id, brandId: 1, name: 'Pak Budi', userId: 4 }),
    },
    chatMessage: {
      findUnique: async () => mocks.stored,
      findFirst: async () => null,
      upsert: mocks.messageUpsert,
      update: mocks.messageUpdate,
    },
    whatsappContact: { findFirst: async () => null },
  },
}));
vi.mock('./conversation-stats.js', () => ({ ensureConversationStats: vi.fn(), loadConversationWindows: vi.fn(), scheduleConversationStats: vi.fn(), summarizeMessages: vi.fn() }));
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: mocks.emitToBrand }));
vi.mock('../notifications/notification.events.js', () => ({
  dispatch: (task: () => unknown) => task(), notifyProspectsReleased: vi.fn(), onWhatsappStatus: vi.fn(), notifyPicChange: vi.fn(), resolveReplyNotifications: vi.fn(),
  notifyLeadAssigned: vi.fn(), notifyInboundMessage: mocks.notifyInboundMessage, notifyIncomingCall: mocks.notifyIncomingCall, notifyCallEnded: mocks.notifyCallEnded,
}));
vi.mock('../capi/capi.service.js', () => ({ dispatchCapiEvent: vi.fn(async () => undefined), queueCapiForStatus: vi.fn() }));
vi.mock('../prospects/referral.service.js', () => ({ attachReferralMarker: vi.fn(async () => false), normalizeReferralMarker: () => null, storedReferral: () => undefined }));

import { env } from '../../config/env.js';
import { callLogText, internalRouter } from './chat.routes.js';

function callEvent(body: Record<string, unknown>, path = '/calls/event') {
  const layer = (internalRouter as any).stack.find((l: any) => l.route?.path === path);
  return new Promise<void>((resolve, reject) => {
    const res = { status: () => res, json: () => resolve() };
    layer.route.stack.at(-1).handle({ body, get: () => env.WA_GATEWAY_SECRET }, res, reject);
  });
}

const call = { brandId: 1, callId: 'C1', remoteJid: '62811@s.whatsapp.net', phone: '62811', timestamp: 1_790_000_000 };
const ringing = (isVideo = false) => ({ id: 5, prospectId: 9, messageId: 'call-C1', messageText: callLogText(isVideo, 'ringing') });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stored = null;
  mocks.messageUpsert.mockImplementation(async ({ create }: any) => ({ id: 5, ...create }));
  mocks.messageUpdate.mockImplementation(async ({ data }: any) => ({ id: 5, prospectId: 9, messageId: 'call-C1', ...data }));
});

describe('Telepon/video call WhatsApp dari jamaah', () => {
  it('berdering: dicatat di chat dan CS diberi peringatan, tanpa notifikasi pesan biasa', async () => {
    await callEvent({ ...call, status: 'offer', isVideo: true });
    const create = mocks.messageUpsert.mock.calls[0]![0].create;
    expect(create).toMatchObject({ messageId: 'call-C1', messageType: 'callLogMessage', messageText: 'Panggilan video masuk', isFromMe: false, prospectId: 9 });
    expect(mocks.notifyIncomingCall).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }), { callId: 'C1', isVideo: true });
    expect(mocks.notifyInboundMessage).not.toHaveBeenCalled();
  });

  it('panggilan saat gateway terputus langsung tercatat tak terjawab tanpa peringatan berdering', async () => {
    await callEvent({ ...call, status: 'offer', offline: true });
    expect(mocks.messageUpsert.mock.calls[0]![0].create.messageText).toBe('Panggilan suara tak terjawab');
    expect(mocks.notifyIncomingCall).not.toHaveBeenCalled();
    expect(mocks.notifyCallEnded).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }), { callId: 'C1', isVideo: false, missed: true });
  });

  it('penelepon menutup sebelum diangkat: tak terjawab dan pengingat hubungi balik', async () => {
    mocks.stored = ringing();
    await callEvent({ ...call, status: 'terminate' });
    expect(mocks.messageUpdate.mock.calls[0]![0].data.messageText).toBe('Panggilan suara tak terjawab');
    expect(mocks.emitToBrand).toHaveBeenCalledWith(1, 'message:edited', expect.objectContaining({ messageText: 'Panggilan suara tak terjawab' }));
    expect(mocks.notifyCallEnded).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ missed: true }));
  });

  it('diangkat di HP lalu ditutup: tetap "diangkat", tanpa pengingat tak terjawab', async () => {
    mocks.stored = ringing();
    await callEvent({ ...call, status: 'accept' });
    expect(mocks.messageUpdate.mock.calls[0]![0].data.messageText).toBe('Panggilan suara diangkat di HP');
    expect(mocks.notifyCallEnded).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ missed: false }));

    vi.clearAllMocks();
    mocks.stored = { ...ringing(), messageText: callLogText(false, 'answered') };
    await callEvent({ ...call, status: 'terminate' });
    expect(mocks.messageUpdate).not.toHaveBeenCalled();
    expect(mocks.notifyCallEnded).not.toHaveBeenCalled();
  });

  it('ditolak dari HP: dicatat ditolak tanpa pengingat tak terjawab', async () => {
    mocks.stored = ringing();
    await callEvent({ ...call, status: 'reject' });
    expect(mocks.messageUpdate.mock.calls[0]![0].data.messageText).toBe('Panggilan suara ditolak');
    expect(mocks.notifyCallEnded).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ missed: false }));
  });

  it('event akhir yang dikirim ulang tidak mengubah apa pun', async () => {
    mocks.stored = { ...ringing(), messageText: callLogText(false, 'missed') };
    await callEvent({ ...call, status: 'timeout' });
    expect(mocks.messageUpdate).not.toHaveBeenCalled();
    expect(mocks.notifyCallEnded).not.toHaveBeenCalled();
  });
});

describe('Pesan ditarik / diedit lewat protocolMessage', () => {
  const csReply = { id: 7, prospectId: 9, messageId: 'CS1', remoteJid: '62811@s.whatsapp.net', phone: '62811', isFromMe: true, isDeleted: false, messageText: 'Transfer ke BSI 111' };
  const fromContact = { brandId: 1, messageId: 'CS1', fromMe: false, chatJids: ['62811@s.whatsapp.net'], phone: '62811' };

  it('kontak tidak bisa mengedit atau menarik balasan CS', async () => {
    mocks.stored = csReply;
    await callEvent({ ...fromContact, text: 'Transfer ke BCA 999' }, '/messages/edited');
    await callEvent(fromContact, '/messages/revoked');
    expect(mocks.messageUpdate).not.toHaveBeenCalled();
    expect(mocks.emitToBrand).not.toHaveBeenCalled();
  });

  it('kontak tidak bisa mengubah pesan di chat lain', async () => {
    mocks.stored = { ...csReply, messageId: 'X1', remoteJid: '62899@s.whatsapp.net', phone: '62899', isFromMe: false };
    await callEvent({ ...fromContact, messageId: 'X1', text: 'palsu' }, '/messages/edited');
    expect(mocks.messageUpdate).not.toHaveBeenCalled();
  });

  it('anggota grup tidak bisa mengedit pesan anggota lain', async () => {
    mocks.stored = { ...csReply, messageId: 'G1', remoteJid: '120363@g.us', phone: '62833', isFromMe: false };
    await callEvent({ brandId: 1, messageId: 'G1', fromMe: false, chatJids: ['120363@g.us'], phone: '62844', text: 'palsu' }, '/messages/edited');
    expect(mocks.messageUpdate).not.toHaveBeenCalled();
  });

  it('riwayat panggilan tidak bisa diedit', async () => {
    mocks.stored = { ...ringing(), remoteJid: '62811@s.whatsapp.net', phone: '62811', isFromMe: false };
    await callEvent({ ...fromContact, messageId: 'call-C1', text: 'palsu' }, '/messages/edited');
    expect(mocks.messageUpdate).not.toHaveBeenCalled();
  });

  it('pengirim asli tetap bisa mengedit dan menarik pesannya, termasuk lewat alamat LID', async () => {
    mocks.stored = { ...csReply, messageId: 'K1', isFromMe: false };
    await callEvent({ ...fromContact, messageId: 'K1', chatJids: ['1234@lid'], text: 'jadi 3 orang' }, '/messages/edited');
    expect(mocks.messageUpdate.mock.calls[0]![0].data).toEqual({ messageText: 'jadi 3 orang' });

    vi.clearAllMocks();
    mocks.stored = csReply;
    await callEvent({ ...fromContact, fromMe: true }, '/messages/revoked');
    expect(mocks.messageUpdate.mock.calls[0]![0].data).toMatchObject({ isDeleted: true });
  });
});

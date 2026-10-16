import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prospectFindMany: vi.fn(),
  prospectCreate: vi.fn(),
  prospectUpdate: vi.fn(),
  messageUpsert: vi.fn(),
  sessionFind: vi.fn(),
  brandFind: vi.fn(),
  messageFind: vi.fn(),
  messageFindFirst: vi.fn(),
  notifyInbound: vi.fn(),
  notifyLeadAssigned: vi.fn(),
  createWithRoundRobin: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    whatsappSession: { findUnique: mocks.sessionFind, updateMany: vi.fn() },
    brand: { findUnique: mocks.brandFind },
    prospect: { findMany: mocks.prospectFindMany, create: mocks.prospectCreate, update: mocks.prospectUpdate, updateMany: vi.fn(async () => ({ count: 0 })) },
    prospectLog: { create: vi.fn() },
    chatMessage: { findUnique: mocks.messageFind, findFirst: mocks.messageFindFirst, upsert: mocks.messageUpsert },
    whatsappContact: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock('./conversation-stats.js', () => ({ ensureConversationStats: vi.fn(), loadConversationWindows: vi.fn(), scheduleConversationStats: vi.fn(), summarizeMessages: vi.fn() }));
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: vi.fn() }));
vi.mock('../notifications/notification.events.js', () => ({
  dispatch: (task: () => unknown) => task(), notifyProspectsReleased: vi.fn(), onWhatsappStatus: vi.fn(), notifyPicChange: vi.fn(), resolveReplyNotifications: vi.fn(),
  notifyLeadAssigned: mocks.notifyLeadAssigned, notifyLeadUnassigned: vi.fn(), notifyInboundMessage: mocks.notifyInbound,
}));
vi.mock('../capi/capi.service.js', () => ({ dispatchCapiEvent: vi.fn(async () => undefined), queueCapiForStatus: vi.fn() }));
vi.mock('../prospects/referral.service.js', () => ({ attachReferralMarker: vi.fn(async () => false), normalizeReferralMarker: () => null, storedReferral: () => undefined }));
vi.mock('../prospects/round-robin.js', () => ({ createProspectWithRoundRobin: mocks.createWithRoundRobin }));

import { env } from '../../config/env.js';
import { internalRouter } from './chat.routes.js';

function post(path: string, body: Record<string, unknown>) {
  const layer = (internalRouter as any).stack.find((l: any) => l.route?.path === path);
  return new Promise<any>((resolve, reject) => {
    const res = { status: () => res, json: (payload: any) => resolve(payload.data) };
    layer.route.stack.at(-1).handle({ body, get: () => env.WA_GATEWAY_SECRET }, res, reject);
  });
}

const base = { brandId: 1, messageId: 'M1', remoteJid: '62811@s.whatsapp.net', phone: '62811', text: 'Assalamualaikum, tanya paket', senderName: 'Bu Aisyah', timestamp: 1_790_000_000 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessionFind.mockResolvedValue({ brandId: 1, status: 'connected', phoneNumber: '628222' });
  mocks.brandFind.mockResolvedValue({ phone: null });
  mocks.messageFind.mockResolvedValue(null);
  mocks.messageFindFirst.mockResolvedValue(null);
  mocks.prospectFindMany.mockResolvedValue([]);
  mocks.prospectCreate.mockImplementation(async ({ data }: any) => ({ id: 9, ...data }));
  mocks.messageUpsert.mockImplementation(async ({ create }: any) => ({ id: 1, ...create }));
  mocks.createWithRoundRobin.mockImplementation(async (brandId: number, data: any) => ({ prospect: { id: 9, brandId, userId: 5, ...data }, assigned: { userId: 5, name: 'Nisa' } }));
});

describe('Round robin pada pesan masuk', () => {
  it('lead baru dari jamaah (realtime): PIC dibagi otomatis, hanya CS terpilih yang diberi tahu', async () => {
    await post('/messages/incoming', base);
    expect(mocks.createWithRoundRobin).toHaveBeenCalledTimes(1);
    expect(mocks.createWithRoundRobin.mock.calls[0]![0]).toBe(1);
    expect(mocks.createWithRoundRobin.mock.calls[0]![1]).toMatchObject({ name: 'Bu Aisyah', leadSource: 'whatsapp', devicePhone: '628222' });
    expect(mocks.createWithRoundRobin.mock.calls[0]![1]).not.toHaveProperty('userId');
    expect(mocks.prospectCreate).not.toHaveBeenCalled();
    expect(mocks.notifyLeadAssigned).toHaveBeenCalledWith(expect.objectContaining({ id: 9, brandId: 1, userId: 5 }), 5, { text: base.text, messageType: 'conversation' });
    expect(mocks.notifyInbound).not.toHaveBeenCalled();
  });

  it('round robin mati atau tak ada CS layak: semua CS brand diberi tahu seperti biasa', async () => {
    mocks.createWithRoundRobin.mockImplementation(async (brandId: number, data: any) => ({ prospect: { id: 9, brandId, userId: null, ...data }, assigned: null }));
    await post('/messages/incoming', base);
    expect(mocks.notifyLeadAssigned).not.toHaveBeenCalled();
    expect(mocks.notifyInbound).toHaveBeenCalledTimes(1);
  });

  it('pesan keluar dari HP brand membuat prospek tanpa PIC dan tidak ikut dibagi', async () => {
    await post('/messages/incoming', { ...base, isFromMe: true });
    expect(mocks.createWithRoundRobin).not.toHaveBeenCalled();
    expect(mocks.prospectCreate).toHaveBeenCalledTimes(1);
    expect(mocks.prospectCreate.mock.calls[0]![0].data.userId).toBeNull();
    expect(mocks.notifyLeadAssigned).not.toHaveBeenCalled();
  });

  it('sinkron riwayat tidak membagi prospek', async () => {
    await post('/messages/history', { brandId: 1, messages: [base] });
    expect(mocks.createWithRoundRobin).not.toHaveBeenCalled();
    expect(mocks.prospectCreate).toHaveBeenCalledTimes(1);
    expect(mocks.prospectCreate.mock.calls[0]![0].data.userId).toBeNull();
    expect(mocks.notifyLeadAssigned).not.toHaveBeenCalled();
  });

  it('prospek yang sudah ada tidak dibagi ulang; PIC lama tetap yang diberi tahu', async () => {
    mocks.prospectFindMany.mockResolvedValue([{ id: 9, name: 'Bu Aisyah', phone: '62811', remoteJid: '62811@s.whatsapp.net', packageId: null, userId: 7, notes: null, updatedAt: new Date() }]);
    mocks.prospectUpdate.mockImplementation(async () => ({ id: 9, name: 'Bu Aisyah', phone: '62811', remoteJid: '62811@s.whatsapp.net', packageId: null, userId: 7, notes: null, updatedAt: new Date() }));
    await post('/messages/incoming', base);
    expect(mocks.createWithRoundRobin).not.toHaveBeenCalled();
    expect(mocks.notifyLeadAssigned).not.toHaveBeenCalled();
    expect(mocks.notifyInbound).toHaveBeenCalledWith(expect.objectContaining({ id: 9, userId: 7 }), expect.anything());
  });
});

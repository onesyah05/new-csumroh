import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ conversationQuery: vi.fn(), rows: [] as any[] }));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    whatsappSession: { findUnique: async () => ({ brandId: 1, status: 'connected', phoneNumber: '62811000', sessionName: 'brand_1' }) },
    brand: { findUnique: async () => ({ id: 1, name: 'Hana', code: 'HANA', phone: '62811000' }) },
    chatMessage: { findMany: async () => [] },
    metaAd: { findMany: async () => [] },
    prospect: {
      findMany: async (args: any) => {
        // ensureConversationStats (ringkasan belum dihitung) dan pemindaian @lid bukan query daftar.
        if (args.where?.conversationStatsAt === null) return [];
        if (args.where?.remoteJid?.endsWith === '@lid') return [];
        mocks.conversationQuery(args);
        return mocks.rows;
      },
    },
  },
}));
vi.mock('../../middleware/auth.js', () => ({ authGuard: (_req: any, _res: any, next: any) => next(), requireRole: () => (_req: any, _res: any, next: any) => next(), scopedBrandId: (_req: any, requested?: number) => requested ?? 1 }));
vi.mock('../notifications/notification.events.js', () => ({ dispatch: vi.fn(), notifyProspectsReleased: vi.fn(), onWhatsappStatus: vi.fn(), notifyPicChange: vi.fn(), resolveReplyNotifications: vi.fn() }));
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: vi.fn() }));

import { getLivechatConversationListForBrand, getLivechatConversationsForBrand, getLivechatConversationsForPipeline } from './chat.routes.js';

/**
 * Field yang dibaca Inbox dari item daftar percakapan (apps/web: InboxPage, ConversationRow, MessageBubble,
 * conversationTags, inboxFilters, ChatSidePanel, lib/avatars) dan konsumen server yang memakai varian ringan.
 * Bila web mulai membaca field baru dari item daftar, tambahkan di sini DAN di conversationColumns.
 */
const INBOX_FIELDS = [
  'id', 'brandId', 'userId', 'packageId', 'name', 'phone', 'status', 'leadSource', 'spamAt', 'remoteJid',
  'adId', 'adHeadline', 'photoUrl', 'targetMonth', 'nextFollowupDate', 'paymentStatus', 'paymentProofUrl',
  'paymentProofMessageId', 'unreadCount', 'awaitingSince', 'messageCount', 'updatedAt', 'createdAt',
  'user', 'package', 'customRequests',
];

const row = (id: number, extra: Record<string, unknown> = {}) => ({
  id, brandId: 1, userId: null, packageId: null, name: `Jamaah ${id}`, phone: `62812${id}`, status: 'new', leadSource: 'whatsapp',
  spamAt: null, remoteJid: `62812${id}@s.whatsapp.net`, adId: null, adHeadline: null, photoUrl: null, targetMonth: null,
  nextFollowupDate: null, paymentStatus: 'unpaid', paymentProofUrl: null, paymentProofMessageId: null,
  paymentProofSubmittedAt: null, invoiceDueAt: null, createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-02'),
  unreadCount: 1, awaitingSince: 1_790_000_000, inboundSenderName: null, messageCount: 3, notes: 'catatan panjang',
  conversationStatsAt: new Date('2026-10-02'), user: null, package: null, customRequests: [],
  lastMessage: { id: id * 10, messageId: `m${id}`, prospectId: id, remoteJid: `62812${id}@s.whatsapp.net`, isFromMe: false, messageText: 'Halo', messageType: 'conversation', mediaUrl: null, status: 'delivered', timestamp: 1_790_000_000 + id, senderName: null },
  ...extra,
});

beforeEach(() => {
  mocks.conversationQuery.mockClear();
  mocks.rows = [row(1), row(2)];
});

describe('Daftar percakapan Inbox: kolom terbatas', () => {
  it('varian ringan memakai select (tanpa include) yang memuat semua field Inbox', async () => {
    await getLivechatConversationListForBrand(1);
    const args = mocks.conversationQuery.mock.calls[0]![0];
    expect(args.include).toBeUndefined();
    for (const field of INBOX_FIELDS) expect(Object.keys(args.select), field).toContain(field);
    // Kolom yang hanya dipakai Pipeline/Profil tidak boleh ikut terambil di daftar Inbox.
    for (const field of ['dealValue', 'paxQuad', 'budgetRange', 'objectionNotes', 'city']) expect(Object.keys(args.select), field).not.toContain(field);
  });

  it('respons ringan tidak membawa notes dan tetap memuat field turunan yang dibaca Inbox', async () => {
    const [first] = await getLivechatConversationListForBrand(1);
    expect(first).not.toHaveProperty('notes');
    expect(first).not.toHaveProperty('conversationStatsAt');
    for (const field of [...INBOX_FIELDS, 'isGroup', 'isOwn', 'duplicateIds', 'messages', 'brand', 'session']) expect(first, field).toHaveProperty(field);
    expect(first!.messages[0]).toMatchObject({ messageId: expect.any(String), status: 'delivered' });
  });

  it('varian lengkap (Pipeline, Kontak, Dashboard) tetap include seluruh kolom dan mempertahankan notes', async () => {
    const [first] = await getLivechatConversationsForBrand(1);
    const args = mocks.conversationQuery.mock.calls[0]![0];
    expect(args.select).toBeUndefined();
    expect(args.include).toBeDefined();
    expect(first).toHaveProperty('notes', 'catatan panjang');
    expect(first).not.toHaveProperty('conversationStatsAt');
  });

  it('kedua varian menghasilkan baris yang sama dengan urutan yang sama', async () => {
    const light = await getLivechatConversationListForBrand(1);
    const full = await getLivechatConversationsForBrand(1);
    expect(light.map((item) => item.id)).toEqual(full.map((item) => item.id));
    expect(light.length).toBe(2);
  });
});

describe('Daftar percakapan Pipeline: tanpa teks panjang yang tidak ditampilkan', () => {
  it('membuang kolom teks tak terpakai di DB dan notes dari respons, tetap membawa kolom modal panduan', async () => {
    await getLivechatConversationsForPipeline(1);
    const args = mocks.conversationQuery.mock.calls[0]![0];
    expect(args.omit).toMatchObject({ specialNeeds: true, adSourceUrl: true, metaReferralMarker: true, lostReasonDetail: true });
    // Dipakai modal panduan Pipeline (ObjectionModal) dan tidak boleh ikut dibuang.
    expect(args.omit).not.toHaveProperty('objectionNotes');
    expect(args.omit).not.toHaveProperty('notes');
    mocks.rows = [row(1)];
    const [item] = await getLivechatConversationsForPipeline(1);
    expect(item).not.toHaveProperty('notes');
    expect(item).toHaveProperty('status');
  });
});

describe('Chat baru dari nomor sosmed (belum ada pesan)', () => {
  const empty = (id: number, extra: Record<string, unknown> = {}) => row(id, { leadSource: 'sosmed_instagram', messageCount: 0, lastMessage: null, unreadCount: 0, awaitingSince: null, userId: 7, ...extra });

  it('query memuat prospek sosmed tanpa pesan di samping yang sudah punya pesan', async () => {
    await getLivechatConversationListForBrand(1);
    const where = mocks.conversationQuery.mock.calls[0]![0].where;
    expect(where.OR).toEqual([{ lastMessageAt: { not: null } }, { leadSource: { startsWith: 'sosmed_' }, messageCount: 0 }]);
  });

  it('percakapan kosong sosmed tampil di daftar, diurutkan menurut waktu dibuat', async () => {
    mocks.rows = [row(1), empty(2, { createdAt: new Date('2027-01-01') })];
    const list = await getLivechatConversationListForBrand(1);
    expect(list.map((item) => item.id)).toEqual([2, 1]);
    expect(list[0]!.messages).toEqual([]);
  });

  it('prospek biasa tanpa pesan tetap disembunyikan', async () => {
    mocks.rows = [row(1, { messageCount: 0, lastMessage: null })];
    expect(await getLivechatConversationListForBrand(1)).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Isolasi brand pada route chat: CS brand 1 tidak boleh membaca atau mengubah percakapan brand 2,
 * baik dengan ?brandId= eksplisit maupun lewat ID prospek/pesan. Memakai scopedBrandId asli (tidak di-mock).
 */
const db = vi.hoisted(() => ({
  writes: [] as string[],
  prospects: [{ id: 200, brandId: 2, userId: null, phone: '62899', remoteJid: '62899@s.whatsapp.net', devicePhone: '62822', name: 'Jamaah B' }],
  messages: [{ id: 900, brandId: 2, messageId: 'wa-900', prospectId: 200, isFromMe: true, isDeleted: false, prospect: { userId: null, user: null } }],
}));

vi.mock('../../db/prisma.js', () => {
  const pick = (rows: any[], where: any = {}) => rows.find((row) => Object.entries(where).every(([key, value]) => typeof value === 'object' || row[key] === value)) ?? null;
  const handle = (model: string, method: string, args: any) => {
    if (/^(create|update|delete|upsert)/.test(method)) db.writes.push(`${model}.${method}`);
    if (model === 'prospect' && /^find(First|Unique)/.test(method)) return pick(db.prospects, args?.where);
    if (model === 'chatMessage' && method === 'findUnique') return pick(db.messages, args?.where);
    if (model === 'whatsappSession' && method === 'findUnique') return { brandId: args?.where?.brandId, status: 'connected', phoneNumber: '62822', qrCode: null };
    if (model === 'brand' && method === 'findUnique') return { id: args?.where?.id, name: 'Brand', code: 'B', phone: '62822' };
    return /Many$/.test(method) ? [] : null;
  };
  const prisma = new Proxy({}, {
    get: (_t, model: string) => new Proxy({}, { get: (_m, method: string) => async (args: any) => handle(model, method, args) }),
  });
  return { prisma };
});
vi.mock('../notifications/notification.events.js', () => ({ dispatch: vi.fn(), notifyProspectsReleased: vi.fn(), onWhatsappStatus: vi.fn(), notifyPicChange: vi.fn(), resolveReplyNotifications: vi.fn() }));
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: vi.fn() }));

import { emitToBrand } from '../../realtime/socket.js';
import { chatRouter } from './chat.routes.js';

type User = { id: number; role: string; brandId: number | null; userBrands: { brand: { id: number } }[] };
const csBrand1: User = { id: 10, role: 'cs', brandId: 1, userBrands: [{ brand: { id: 1 } }] };
const csBrand1And2: User = { id: 11, role: 'cs', brandId: 1, userBrands: [{ brand: { id: 1 } }, { brand: { id: 2 } }] };
const superadmin: User = { id: 1, role: 'superadmin', brandId: null, userBrands: [] };

function call(method: 'get' | 'post' | 'delete', path: string, req: { user: User; params?: any; query?: any; body?: any }) {
  const layer = (chatRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route ${method} ${path} tidak ditemukan`);
  return new Promise<{ status?: number; error?: { status: number }; body?: any }>((resolve) => {
    let status: number | undefined;
    const res = { status: (code: number) => { status = code; return res; }, json: (body: any) => resolve({ status, body }) };
    layer.route.stack.at(-1).handle({ params: {}, query: {}, body: {}, ...req }, res, (error: any) => resolve({ error }));
  });
}

const gateway = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) }));

beforeEach(() => {
  db.writes.length = 0;
  vi.mocked(emitToBrand).mockClear();
  gateway.mockClear();
  vi.stubGlobal('fetch', gateway);
});

function expectBlocked(result: Awaited<ReturnType<typeof call>>, status: number) {
  expect(result.error?.status).toBe(status);
  expect(db.writes).toEqual([]);
  expect(gateway).not.toHaveBeenCalled();
  expect(emitToBrand).not.toHaveBeenCalled();
}

describe('CS brand 1 menembus ke brand 2 dengan ?brandId= eksplisit → 403', () => {
  const user = csBrand1;
  it.each([
    ['get', '/conversations', { params: {} }],
    ['get', '/prospects/:id/messages', { params: { id: '200' } }],
    ['get', '/prospects/:id/avatar', { params: { id: '200' } }],
    ['post', '/prospects/:id/read', { params: { id: '200' } }],
    ['get', '/wa/status', { params: {} }],
  ] as const)('%s %s', async (method, path, extra) => {
    expectBlocked(await call(method, path, { user, query: { brandId: '2' }, ...extra }), 403);
  });
});

describe('history-sync membaca brandId dari body', () => {
  it('brandId=2 di body → 403', async () => {
    expectBlocked(await call('post', '/prospects/:id/history-sync', { user: csBrand1, params: { id: '200' }, body: { brandId: 2 } }), 403);
  });

  it('tanpa brandId → dicari di brand sendiri → 404', async () => {
    expectBlocked(await call('post', '/prospects/:id/history-sync', { user: csBrand1, params: { id: '200' } }), 404);
  });
});

describe('ID prospek/pesan milik brand 2 tanpa ?brandId= tetap ditolak', () => {
  it('riwayat chat: dicari di brand sendiri → 404, bukan isi brand 2', async () => {
    expectBlocked(await call('get', '/prospects/:id/messages', { user: csBrand1, params: { id: '200' } }), 404);
  });

  it('kirim teks ke prospek brand 2 → 403', async () => {
    expectBlocked(await call('post', '/messages', { user: csBrand1, body: { prospectId: 200, text: 'halo' } }), 403);
  });

  it('kirim media ke prospek brand 2 → 403', async () => {
    expectBlocked(await call('post', '/messages/media', { user: csBrand1, body: { prospectId: 200, base64Data: 'AAAA' } }), 403);
  });

  it.each([
    ['post', '/messages/:id/react', { emoji: '👍' }],
    ['delete', '/messages/:id', undefined],
    ['post', '/messages/:id/star', undefined],
  ] as const)('%s %s pesan brand 2 → 403', async (method, path, body) => {
    expectBlocked(await call(method, path, { user: csBrand1, params: { id: '900' }, body }), 403);
  });
});

describe('Kontrol positif: akses yang sah tidak ikut terblokir', () => {
  it('CS yang ditugaskan ke brand 1 dan 2 membaca percakapan brand 2', async () => {
    const result = await call('get', '/conversations', { user: csBrand1And2, query: { brandId: '2' } });
    expect(result.error).toBeUndefined();
    expect(result.body.success).toBe(true);
  });

  it('Superadmin (holding) membaca brand mana pun', async () => {
    const result = await call('get', '/conversations', { user: superadmin, query: { brandId: '2' } });
    expect(result.error).toBeUndefined();
    expect(result.body.success).toBe(true);
  });

  it('CS brand 1 tetap bisa membaca brand sendiri', async () => {
    const result = await call('get', '/conversations', { user: csBrand1, query: { brandId: '1' } });
    expect(result.error).toBeUndefined();
  });
});

describe('Gerbang role route chat', () => {
  // Layer ke-2 pada chatRouter = requireRole (layer ke-1 = authGuard).
  const gate = (role: string) => new Promise<any>((resolve) => {
    const layer = (chatRouter as any).stack[1];
    layer.handle({ user: { id: 1, role, brandId: 1, userBrands: [{ brand: { id: 1 } }] } }, {}, (error?: any) => resolve(error ?? null));
  });

  it.each(['product', 'designer'])('%s ditolak 403 walau punya penugasan brand', async (role) => {
    expect(await gate(role)).toMatchObject({ status: 403 });
  });

  it.each(['superadmin', 'admin', 'cs', 'finance'])('%s lolos gerbang', async (role) => {
    expect(await gate(role)).toBeNull();
  });
});

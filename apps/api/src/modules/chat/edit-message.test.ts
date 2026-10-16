import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Edit pesan terkirim dari CRM (PATCH /chat/messages/:id) dan gema/edit dari WhatsApp (/internal/messages/edited). */
const db = vi.hoisted(() => ({
  message: null as Record<string, any> | null,
  updates: [] as Record<string, any>[],
  logs: [] as Record<string, any>[],
}));

vi.mock('../../db/prisma.js', () => {
  const handle = (model: string, method: string, args: any): any => {
    if (model === 'chatMessage' && method === 'findUnique') return db.message;
    if (model === 'chatMessage' && method === 'update') { db.updates.push(args.data); db.message = { ...db.message!, ...args.data }; return db.message; }
    if (model === 'prospectLog' && method === 'create') { db.logs.push(args.data); return args.data; }
    if (model === 'whatsappSession' && method === 'findUnique') return { brandId: args?.where?.brandId, status: 'connected', phoneNumber: '62822', qrCode: null };
    return /Many$/.test(method) ? [] : null;
  };
  const prisma: any = new Proxy({}, {
    get: (_t, model: string) => new Proxy({}, { get: (_m, method: string) => async (args: any) => handle(model, method, args) }),
  });
  return { prisma };
});
vi.mock('../notifications/notification.events.js', () => ({ dispatch: vi.fn(), notifyProspectsReleased: vi.fn(), onWhatsappStatus: vi.fn(), notifyPicChange: vi.fn(), resolveReplyNotifications: vi.fn() }));
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: vi.fn() }));

import { env } from '../../config/env.js';
import { emitToBrand } from '../../realtime/socket.js';
import { chatRouter, internalRouter } from './chat.routes.js';

type User = { id: number; name: string; role: string; brandId: number | null; userBrands: { brand: { id: number } }[] };
const pic: User = { id: 10, name: 'Aisyah', role: 'cs', brandId: 1, userBrands: [{ brand: { id: 1 } }] };
const otherCs: User = { id: 11, name: 'Budi', role: 'cs', brandId: 1, userBrands: [{ brand: { id: 1 } }] };
const admin: User = { id: 1, name: 'Admin', role: 'admin', brandId: 1, userBrands: [{ brand: { id: 1 } }] };
const csBrand2: User = { id: 12, name: 'Citra', role: 'cs', brandId: 2, userBrands: [{ brand: { id: 2 } }] };

function edit(user: User, text: unknown, id = 900) {
  const layer = (chatRouter as any).stack.find((l: any) => l.route?.path === '/messages/:id' && l.route.methods.patch);
  return new Promise<{ status?: number; error?: { status: number; message?: string }; body?: any }>((resolve) => {
    let status: number | undefined;
    const res = { status: (code: number) => { status = code; return res; }, json: (payload: any) => resolve({ status, body: payload }) };
    layer.route.stack.at(-1).handle({ params: { id: String(id) }, query: {}, body: { text }, user }, res, (error: any) => resolve({ error }));
  });
}

function inboundEdit(text: string, overrides: Record<string, unknown> = {}) {
  const layer = (internalRouter as any).stack.find((l: any) => l.route?.path === '/messages/edited');
  return new Promise<void>((resolve, reject) => {
    const res = { json: () => resolve() };
    layer.route.stack.at(-1).handle({
      body: { brandId: 1, messageId: 'WA900', fromMe: true, chatJids: ['62899@s.whatsapp.net'], phone: '62899', text, ...overrides },
      get: () => env.WA_GATEWAY_SECRET,
    }, res, reject);
  });
}

const baseMessage = () => ({
  id: 900, brandId: 1, prospectId: 200, messageId: 'WA900', remoteJid: '62899@s.whatsapp.net', phone: '62899', devicePhone: '62822',
  isFromMe: true, isDeleted: false, messageType: 'conversation', messageText: 'Harga paket 30 juta', timestamp: Math.floor(Date.now() / 1000) - 120,
  editedAt: null, prospect: { userId: 10 },
});

const gateway = vi.fn(async (_url: string, _init: { body: string }) => ({ ok: true, json: async () => ({ success: true }) }));

beforeEach(() => {
  db.message = baseMessage();
  db.updates.length = 0;
  db.logs.length = 0;
  gateway.mockClear();
  gateway.mockImplementation(async () => ({ ok: true, json: async () => ({ success: true }) }));
  vi.mocked(emitToBrand).mockClear();
  vi.stubGlobal('fetch', gateway);
});

describe('Edit pesan dari CRM', () => {
  it('PIC mengedit: WhatsApp diedit dulu, lalu CRM berubah dengan penanda diedit, log audit, dan siaran realtime', async () => {
    const result = await edit(pic, '  Harga paket 28 juta  ');
    expect(result.error).toBeUndefined();
    expect(gateway).toHaveBeenCalledTimes(1);
    const [url, init] = gateway.mock.calls[0]!;
    expect(url).toMatch(/\/sessions\/1\/edit$/);
    expect(JSON.parse(init.body)).toEqual({ jid: '62899@s.whatsapp.net', messageId: 'WA900', text: 'Harga paket 28 juta' });
    expect(db.updates[0]).toMatchObject({ messageText: 'Harga paket 28 juta' });
    expect(db.updates[0]!.editedAt).toBeInstanceOf(Date);
    expect(db.logs[0]).toMatchObject({ prospectId: 200, userId: 10, actionType: 'message_edited', title: 'Pesan diedit oleh Aisyah' });
    expect(db.logs[0]!.description).toBe('Sebelum: Harga paket 30 juta\nSesudah: Harga paket 28 juta');
    expect(emitToBrand).toHaveBeenCalledWith(1, 'message:edited', expect.objectContaining({ messageId: 'WA900', messageText: 'Harga paket 28 juta', editedAt: expect.any(Date) }));
  });

  it('Admin boleh mengedit pesan CS lain; CS yang bukan PIC ditolak 403 tanpa menyentuh WhatsApp', async () => {
    expect((await edit(admin, 'Harga paket 28 juta')).error).toBeUndefined();
    db.updates.length = 0;
    gateway.mockClear();
    db.message = baseMessage();
    const denied = await edit(otherCs, 'Harga paket 28 juta');
    expect(denied.error?.status).toBe(403);
    expect(gateway).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it('CS brand lain tidak bisa mengedit pesan brand ini', async () => {
    const result = await edit(csBrand2, 'Harga paket 28 juta');
    expect(result.error?.status).toBeGreaterThanOrEqual(400);
    expect(gateway).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it.each([
    ['lewat 15 menit', { timestamp: Math.floor(Date.now() / 1000) - 16 * 60 }, 422],
    ['pesan jamaah', { isFromMe: false }, 400],
    ['pesan terhapus', { isDeleted: true }, 409],
    ['foto/video/dokumen', { messageType: 'imageMessage' }, 400],
    ['pesan lokal (tidak tercatat di WhatsApp)', { messageId: 'local-abc' }, 422],
  ])('ditolak: %s', async (_name, overrides, status) => {
    db.message = { ...baseMessage(), ...overrides };
    const result = await edit(pic, 'Harga paket 28 juta');
    expect(result.error?.status).toBe(status);
    expect(gateway).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
    expect(db.logs).toEqual([]);
  });

  it.each([
    ['kosong', '   ', 400],
    ['tidak berubah', ' Harga paket 30 juta ', 409],
    ['terlalu panjang', 'a'.repeat(4001), 400],
  ])('teks %s ditolak sebelum menyentuh WhatsApp', async (_name, text, status) => {
    const result = await edit(pic, text);
    expect(result.error?.status).toBe(status);
    expect(gateway).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it('WhatsApp menolak: CRM tidak berubah dan tidak ada log', async () => {
    gateway.mockImplementation(async () => ({ ok: false, status: 502, json: async () => ({ success: false, error: 'edit gagal' }) }) as any);
    const result = await edit(pic, 'Harga paket 28 juta');
    expect(result.error).toBeDefined();
    expect(db.updates).toEqual([]);
    expect(db.logs).toEqual([]);
    expect(emitToBrand).not.toHaveBeenCalled();
  });
});

describe('Edit dari WhatsApp (HP brand atau jamaah)', () => {
  it('teks berbeda: CRM ikut berubah dengan penanda diedit', async () => {
    await inboundEdit('Harga paket 27 juta');
    expect(db.updates[0]).toMatchObject({ messageText: 'Harga paket 27 juta' });
    expect(db.updates[0]!.editedAt).toBeInstanceOf(Date);
    expect(emitToBrand).toHaveBeenCalledWith(1, 'message:edited', expect.objectContaining({ editedAt: expect.any(Date) }));
  });

  it('gema edit yang kita lakukan sendiri (teks sudah sama) tidak diproses ulang', async () => {
    db.message = { ...baseMessage(), messageText: 'Harga paket 28 juta', editedAt: new Date() };
    await inboundEdit('Harga paket 28 juta');
    expect(db.updates).toEqual([]);
    expect(emitToBrand).not.toHaveBeenCalled();
  });

  it('pengirim yang tidak sesuai (bukan pemilik pesan) diabaikan', async () => {
    await inboundEdit('Teks palsu', { fromMe: false });
    expect(db.updates).toEqual([]);
  });
});

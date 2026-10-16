import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdempotency } from '../../utils/idempotency.js';

/** Kirim media dari galeri: server membaca berkas galeri brand percakapan sendiri (tanpa unggahan base64 dari browser). */
const db = vi.hoisted(() => ({
  prospect: { id: 200, brandId: 1, userId: null, status: 'contact', phone: '62899', remoteJid: '62899@s.whatsapp.net', devicePhone: '62822', name: 'Jamaah', packageId: null, user: null, package: null } as Record<string, unknown>,
  assets: [] as Record<string, any>[],
  messages: 0,
}));

vi.mock('../../db/prisma.js', () => {
  const pick = (rows: any[], where: any = {}) => rows.find((row) => Object.entries(where).every(([key, value]) => typeof value === 'object' || row[key] === value)) ?? null;
  const handle = (model: string, method: string, args: any, root: any): any => {
    if (model === '$transaction') return args(root);
    if (model === 'prospect' && /^find(First|Unique)/.test(method)) return pick([db.prospect], args?.where);
    if (model === 'mediaAsset' && method === 'findFirst') return pick(db.assets, args?.where);
    if (model === 'whatsappSession' && method === 'findUnique') return { brandId: args?.where?.brandId, status: 'connected', phoneNumber: '62822', qrCode: null };
    if (model === 'chatMessage' && method === 'upsert') { db.messages += 1; return { id: db.messages, ...args.create }; }
    return /Many$/.test(method) ? [] : null;
  };
  const prisma: any = new Proxy({}, {
    get: (_t, model: string) => (model === '$transaction' ? (callback: any) => handle(model, '', callback, prisma) : new Proxy({}, { get: (_m, method: string) => async (args: any) => handle(model, method, args, prisma) })),
  });
  return { prisma };
});
vi.mock('../notifications/notification.events.js', () => ({ dispatch: vi.fn(), notifyProspectsReleased: vi.fn(), onWhatsappStatus: vi.fn(), notifyPicChange: vi.fn(), resolveReplyNotifications: vi.fn() }));
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: vi.fn() }));

import { chatRouter } from './chat.routes.js';

const cs = { id: 10, name: 'Aisyah', role: 'cs', brandId: 1, userBrands: [{ brand: { id: 1 } }] };

function send(body: Record<string, unknown>) {
  const layer = (chatRouter as any).stack.find((l: any) => l.route?.path === '/messages/media' && l.route.methods.post);
  return new Promise<{ status?: number; error?: { status: number; message?: string }; body?: any }>((resolve) => {
    let status: number | undefined;
    const res = { status: (code: number) => { status = code; return res; }, json: (payload: any) => resolve({ status, body: payload }) };
    layer.route.stack.at(-1).handle({ params: {}, query: {}, body, user: cs }, res, (error: any) => resolve({ error }));
  });
}

const galleryDir = path.resolve(process.cwd(), 'uploads', 'gallery');
const mediaDir = path.resolve(process.cwd(), 'uploads', 'media');
const existingMedia = new Set<string>();
const created: string[] = [];
function galleryFile(content: string) {
  const name = `test-${randomUUID()}.mp4`;
  fs.mkdirSync(galleryDir, { recursive: true });
  fs.writeFileSync(path.join(galleryDir, name), content);
  created.push(name);
  return `/uploads/gallery/${name}`;
}

const gateway = vi.fn(async (_url: string, _init: { body: string }) => ({ ok: true, json: async () => ({ data: { messageId: `wa-${randomUUID()}` } }) }));

beforeEach(() => {
  // Route menyimpan salinan ke uploads/media: catat isi awal agar hanya berkas hasil tes yang dibersihkan.
  existingMedia.clear();
  for (const name of fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : []) existingMedia.add(name);
  db.messages = 0;
  db.assets = [];
  gateway.mockClear();
  resetIdempotency();
  vi.stubGlobal('fetch', gateway);
});
afterEach(() => {
  for (const name of created.splice(0)) fs.rmSync(path.join(galleryDir, name), { force: true });
  for (const name of fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : []) if (!existingMedia.has(name)) fs.rmSync(path.join(mediaDir, name), { force: true });
});

describe('Kirim media dari galeri (galleryAssetId)', () => {
  it('server membaca berkas galeri brand percakapan dan mengirimnya; jenis pesan mengikuti berkas, bukan klien', async () => {
    db.assets = [{ id: 5, brandId: 1, name: 'Video hotel', url: galleryFile('isi-video'), mimeType: 'video/mp4' }];
    const result = await send({ prospectId: 200, galleryAssetId: 5, mediaType: 'imageMessage', caption: '' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(201);
    const payload = JSON.parse(gateway.mock.calls[0]![1].body);
    expect(payload.mediaType).toBe('videoMessage');
    expect(payload.mimeType).toBe('video/mp4');
    expect(Buffer.from(payload.base64Data, 'base64').toString()).toBe('isi-video');
    expect(result.body.data.messageType).toBe('videoMessage');
  });

  it('media galeri milik brand lain ditolak 404 dan tidak dikirim', async () => {
    db.assets = [{ id: 6, brandId: 2, name: 'Foto brand lain', url: galleryFile('rahasia'), mimeType: 'video/mp4' }];
    const result = await send({ prospectId: 200, galleryAssetId: 6 });
    expect(result.error?.status).toBe(404);
    expect(gateway).not.toHaveBeenCalled();
  });

  it('berkas galeri hilang dari disk: 404, tidak ada pesan terkirim', async () => {
    db.assets = [{ id: 7, brandId: 1, name: 'Hilang', url: '/uploads/gallery/tidak-ada.mp4', mimeType: 'video/mp4' }];
    const result = await send({ prospectId: 200, galleryAssetId: 7 });
    expect(result.error?.status).toBe(404);
    expect(gateway).not.toHaveBeenCalled();
  });

  it('nama berkas di database tidak bisa keluar dari folder galeri (path traversal)', async () => {
    db.assets = [{ id: 8, brandId: 1, name: 'Jahat', url: '/uploads/gallery/../../../.env', mimeType: 'video/mp4' }];
    const result = await send({ prospectId: 200, galleryAssetId: 8 });
    expect(result.error?.status).toBe(404);
    expect(gateway).not.toHaveBeenCalled();
  });

  it('clientId yang sama (coba ulang setelah habis waktu) hanya mengirim sekali ke WhatsApp', async () => {
    db.assets = [{ id: 9, brandId: 1, name: 'Video', url: galleryFile('v'), mimeType: 'video/mp4' }];
    const first = await send({ prospectId: 200, galleryAssetId: 9, clientId: 'client-id-abc123' });
    const retry = await send({ prospectId: 200, galleryAssetId: 9, clientId: 'client-id-abc123' });
    expect(gateway).toHaveBeenCalledTimes(1);
    expect(retry.body.data.id).toBe(first.body.data.id);
    // Tanpa clientId (atau id baru) tetap dikirim lagi: pengiriman ulang yang disengaja.
    await send({ prospectId: 200, galleryAssetId: 9, clientId: 'client-id-lain99' });
    expect(gateway).toHaveBeenCalledTimes(2);
  });
});

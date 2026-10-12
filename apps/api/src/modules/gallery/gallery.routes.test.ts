import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  folderFind: vi.fn(), folderCreate: vi.fn(), folderDelete: vi.fn(), folderUnique: vi.fn(),
  assetFind: vi.fn(), assetDelete: vi.fn(), assetCreate: vi.fn(), assetUpdate: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    mediaFolder: { findUnique: mocks.folderFind, create: mocks.folderCreate, delete: mocks.folderDelete },
    mediaAsset: { findUnique: mocks.assetFind, delete: mocks.assetDelete, create: mocks.assetCreate, update: mocks.assetUpdate },
  },
}));
vi.mock('../../middleware/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../../middleware/auth.js')>('../../middleware/auth.js');
  return { ...actual, authGuard: (_req: unknown, _res: unknown, next: () => void) => next() };
});

import { galleryRouter, sniffMedia } from './gallery.routes.js';

type Actor = { id: number; role: string; brandId: number | null; name?: string };
const cs = (id = 7): Actor => ({ id, role: 'cs', brandId: 1, name: 'CS' });
const admin: Actor = { id: 1, role: 'admin', brandId: 1, name: 'Admin' };

function call(method: 'post' | 'patch' | 'delete', path: string, user: Actor, opts: { body?: unknown; params?: Record<string, string> } = {}) {
  const layer = (galleryRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  return new Promise<{ status: number; body?: any; error?: any }>((resolve) => {
    const res: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(body: any) { resolve({ status: this.statusCode, body }); } };
    layer.route.stack.at(-1).handle(
      { params: opts.params ?? {}, body: opts.body ?? {}, query: {}, user },
      res,
      (error: any) => resolve({ status: error?.status ?? 500, error }),
    );
  });
}

beforeEach(() => vi.clearAllMocks());

describe('sniffMedia', () => {
  it('mengenali gambar dan video dari magic bytes, menolak yang lain', () => {
    expect(sniffMedia(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image');
    expect(sniffMedia(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(4)]))).toBe('video');
    expect(sniffMedia(Buffer.from('%PDF-1.7 bukan media di galeri'))).toBeNull();
    // HEIC/AVIF/M4A memakai kotak ftyp juga tetapi bukan video web.
    expect(sniffMedia(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(4)]))).toBeNull();
    expect(sniffMedia(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(4)]))).toBeNull();
  });
});

describe('Galeri media', () => {
  it('menolak berkas yang bukan gambar atau video MP4', async () => {
    const data = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.7 dokumen').toString('base64');
    const result = await call('post', '/assets', cs(), { body: { brandId: 1, name: 'x.pdf', data } });
    expect(result.status).toBe(400);
    expect(mocks.assetCreate).not.toHaveBeenCalled();
  });

  it('folder dengan nama sama di brand yang sama ditolak', async () => {
    mocks.folderFind.mockResolvedValue({ id: 3, brandId: 1, name: 'Flyer' });
    const result = await call('post', '/folders', cs(), { body: { brandId: 1, name: 'Flyer' } });
    expect(result.status).toBe(409);
    expect(mocks.folderCreate).not.toHaveBeenCalled();
  });

  it('media hanya dihapus pengunggahnya atau Admin', async () => {
    mocks.assetFind.mockResolvedValue({ id: 9, brandId: 1, uploadedById: 7, url: '/uploads/gallery/g1-1-a.webp' });
    mocks.assetDelete.mockResolvedValue({});
    expect((await call('delete', '/assets/:id', cs(8), { params: { id: '9' } })).status).toBe(403);
    expect(mocks.assetDelete).not.toHaveBeenCalled();
    expect((await call('delete', '/assets/:id', cs(7), { params: { id: '9' } })).status).toBe(200);
    expect((await call('delete', '/assets/:id', admin, { params: { id: '9' } })).status).toBe(200);
    expect(mocks.assetDelete).toHaveBeenCalledTimes(2);
  });

  it('ganti nama: pengunggah atau Admin; nama kosong ditolak', async () => {
    mocks.assetFind.mockResolvedValue({ id: 9, brandId: 1, uploadedById: 7, url: '/uploads/gallery/g1-1-a.webp' });
    mocks.assetUpdate.mockImplementation(async ({ data }: any) => ({
      id: 9, brandId: 1, folderId: null, name: data.name, url: '/uploads/gallery/g1-1-a.webp', mimeType: 'image/webp',
      size: 10, width: 1, height: 1, createdAt: new Date(), uploadedBy: { id: 7, name: 'CS' },
    }));
    expect((await call('patch', '/assets/:id', cs(8), { params: { id: '9' }, body: { name: 'Baru' } })).status).toBe(403);
    expect((await call('patch', '/assets/:id', cs(7), { params: { id: '9' }, body: { name: '   ' } })).error?.name).toBe('ZodError');
    const ok = await call('patch', '/assets/:id', cs(7), { params: { id: '9' }, body: { name: '  Flyer Desember  ' } });
    expect(ok.status).toBe(200);
    expect(mocks.assetUpdate.mock.calls[0][0].data).toEqual({ name: 'Flyer Desember' });
    expect((await call('patch', '/assets/:id', admin, { params: { id: '9' }, body: { name: 'Oleh Admin' } })).status).toBe(200);
  });

  it('pindah folder: hanya folder brand yang sama; null mengembalikan ke Unggahan terbaru', async () => {
    mocks.assetFind.mockResolvedValue({ id: 9, brandId: 1, uploadedById: 7, url: '/uploads/gallery/g1-1-a.webp' });
    mocks.assetUpdate.mockImplementation(async ({ data }: any) => ({ id: 9, brandId: 1, folderId: data.folderId ?? null, name: 'a', url: '/u', mimeType: 'image/webp', size: 1, width: 1, height: 1, createdAt: new Date(), uploadedBy: { id: 7, name: 'CS' } }));
    mocks.folderFind.mockResolvedValue({ id: 3, brandId: 2, name: 'Brand lain' });
    expect((await call('patch', '/assets/:id', cs(7), { params: { id: '9' }, body: { folderId: 3 } })).status).toBe(400);
    mocks.folderFind.mockResolvedValue({ id: 4, brandId: 1, name: 'Flyer' });
    expect((await call('patch', '/assets/:id', cs(7), { params: { id: '9' }, body: { folderId: 4 } })).status).toBe(200);
    expect(mocks.assetUpdate.mock.calls.at(-1)![0].data).toEqual({ folderId: 4 });
    expect((await call('patch', '/assets/:id', cs(7), { params: { id: '9' }, body: { folderId: null } })).status).toBe(200);
    expect(mocks.assetUpdate.mock.calls.at(-1)![0].data).toEqual({ folderId: null });
  });

  it('media brand lain tidak ditemukan bagi CS', async () => {
    mocks.assetFind.mockResolvedValue({ id: 9, brandId: 2, uploadedById: 7, url: '/uploads/gallery/g2-1-a.webp' });
    expect((await call('delete', '/assets/:id', cs(7), { params: { id: '9' } })).status).toBe(404);
  });
});

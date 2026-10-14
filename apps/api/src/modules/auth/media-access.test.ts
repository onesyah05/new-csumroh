import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ userFind: vi.fn(), messageFind: vi.fn(), prospectFind: vi.fn() }));
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    user: { findUnique: mocks.userFind },
    chatMessage: { findFirst: mocks.messageFind },
    prospect: { findUnique: mocks.prospectFind },
  },
}));
vi.mock('./sessions.js', () => ({ isTokenRevoked: (id: number) => id === 99 }));

import { env } from '../../config/env.js';
import { MEDIA_COOKIE, protectUploads } from './media-access.js';

const media = (sub: number, type = 'media') => jwt.sign({ sub: String(sub), type }, env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
const staff = (over: Record<string, unknown> = {}) => ({ isActive: true, role: 'cs', brandId: 1, userBrands: [{ brandId: 1 }], ...over });

function run(path: string, cookie?: string) {
  const headers: Record<string, string> = {};
  let status = 200;
  const res: any = {
    setHeader: (k: string, v: string) => { headers[k] = v; },
    status: (code: number) => { status = code; return res; },
    json: () => res,
  };
  return new Promise<{ status: number; headers: Record<string, string>; passed: boolean }>((resolve) => {
    const done = (passed: boolean) => resolve({ status, headers, passed });
    res.json = () => { done(false); return res; };
    void protectUploads({ path, cookies: cookie ? { [MEDIA_COOKIE]: cookie } : {} } as any, res, () => done(true));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFind.mockResolvedValue(staff());
  mocks.messageFind.mockResolvedValue({ brandId: 1 });
  mocks.prospectFind.mockResolvedValue({ brandId: 1 });
});

describe('Akses berkas /uploads', () => {
  it('flyer paket & logo brand tetap publik', async () => {
    expect((await run('/packages/flyer-1.webp')).passed).toBe(true);
    expect((await run('/brands/logo-1.webp')).passed).toBe(true);
  });

  it('media chat & foto profil jamaah butuh cookie media yang sah', async () => {
    expect(await run('/media/1_abc.jpg')).toMatchObject({ status: 401, passed: false });
    expect(await run('/avatars/p1-1-x.jpg', 'bukan-token')).toMatchObject({ status: 401, passed: false });
    expect(await run('/media/1_abc.jpg', media(5, 'access'))).toMatchObject({ status: 401, passed: false });
    expect(await run('/chat/1_in_x.jpg', media(99))).toMatchObject({ status: 401, passed: false });
    const ok = await run('/media/1_abc.jpg', media(5));
    expect(ok.passed).toBe(true);
    expect(ok.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(ok.headers['Content-Disposition']).toBeUndefined();
  });

  it('akun nonaktif atau designer ditolak; berkas non-media dipaksa unduh dan disandbox', async () => {
    mocks.userFind.mockResolvedValueOnce(staff({ isActive: false }));
    expect((await run('/media/x.jpg', media(6))).status).toBe(401);
    mocks.userFind.mockResolvedValueOnce(staff({ role: 'designer' }));
    expect((await run('/media/x.jpg', media(16))).status).toBe(401);
    const doc = await run('/media/1_x.bin', media(7));
    expect(doc.headers['Content-Disposition']).toBe('attachment');
    expect(doc.headers['Content-Security-Policy']).toContain('sandbox');
    const pdf = await run('/media/1_x.pdf', media(8));
    expect(pdf.headers['Content-Disposition']).toBeUndefined();
    expect(pdf.headers['Content-Security-Policy']).toBeUndefined();
  });
});

describe('Akses berkas per brand', () => {
  it('media chat milik brand lain tidak dibuka; brand sendiri dan brand penugasan dibuka', async () => {
    mocks.userFind.mockResolvedValue(staff({ brandId: 1, userBrands: [{ brandId: 1 }, { brandId: 3 }] }));
    mocks.messageFind.mockResolvedValueOnce({ brandId: 2 });
    expect(await run('/media/own-brand-2.jpg', media(21))).toMatchObject({ status: 404, passed: false });
    mocks.messageFind.mockResolvedValueOnce({ brandId: 1 });
    expect((await run('/media/own-brand-1.jpg', media(21))).passed).toBe(true);
    mocks.messageFind.mockResolvedValueOnce({ brandId: 3 });
    expect((await run('/media/own-brand-3.jpg', media(21))).passed).toBe(true);
    expect(mocks.messageFind).toHaveBeenLastCalledWith(expect.objectContaining({ where: { mediaUrl: '/uploads/media/own-brand-3.jpg' } }));
  });

  it('berkas tanpa pemilik yang dikenal hanya dibuka pengawas holding', async () => {
    mocks.messageFind.mockResolvedValue(null);
    mocks.userFind.mockResolvedValueOnce(staff());
    expect((await run('/media/orphan-a.jpg', media(22))).status).toBe(404);
    mocks.userFind.mockResolvedValueOnce(staff({ role: 'superadmin', brandId: null, userBrands: [] }));
    expect((await run('/media/orphan-b.jpg', media(23))).passed).toBe(true);
    mocks.userFind.mockResolvedValueOnce(staff({ role: 'finance', brandId: null, userBrands: [] }));
    expect((await run('/media/orphan-c.jpg', media(24))).passed).toBe(true);
  });

  it('avatar dan gallery memakai petunjuk di nama berkas', async () => {
    mocks.userFind.mockResolvedValue(staff({ brandId: 1, userBrands: [{ brandId: 1 }] }));
    mocks.prospectFind.mockResolvedValueOnce({ brandId: 2 });
    expect((await run('/avatars/p77-1790000000000-abc.webp', media(25))).status).toBe(404);
    mocks.prospectFind.mockResolvedValueOnce({ brandId: 1 });
    expect((await run('/avatars/p78-1790000000000-abc.webp', media(25))).passed).toBe(true);
    expect((await run('/gallery/g2-1790000000000-aaaa.webp', media(25))).status).toBe(404);
    expect((await run('/gallery/g1-1790000000000-aaaa.webp', media(25))).passed).toBe(true);
    // Gallery tidak menyentuh DB pemilik: brand dibaca dari nama berkas.
    expect(mocks.messageFind).not.toHaveBeenCalled();
  });

  it('thumbnail iklan cukup login (bukan data jamaah)', async () => {
    expect((await run('/ad-creatives/120.jpg', media(26))).passed).toBe(true);
    expect(mocks.messageFind).not.toHaveBeenCalled();
  });
});

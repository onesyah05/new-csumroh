import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../../db/prisma.js', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
vi.mock('./sessions.js', () => ({ isTokenRevoked: (id: number) => id === 99 }));

import { env } from '../../config/env.js';
import { MEDIA_COOKIE, protectUploads } from './media-access.js';

const media = (sub: number, type = 'media') => jwt.sign({ sub: String(sub), type }, env.JWT_ACCESS_SECRET, { expiresIn: '1h' });

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
  mocks.findUnique.mockResolvedValue({ isActive: true });
});

describe('Akses berkas /uploads', () => {
  it('flyer paket & logo brand tetap publik', async () => {
    expect((await run('/packages/flyer-1.webp')).passed).toBe(true);
    expect((await run('/brands/logo-1.webp')).passed).toBe(true);
  });

  it('media chat & foto profil jamaah butuh cookie media yang sah', async () => {
    expect(await run('/media/1_abc.jpg')).toMatchObject({ status: 401, passed: false });
    expect(await run('/avatars/p1.jpg', 'bukan-token')).toMatchObject({ status: 401, passed: false });
    expect(await run('/media/1_abc.jpg', media(5, 'access'))).toMatchObject({ status: 401, passed: false });
    expect(await run('/chat/1_in_x.jpg', media(99))).toMatchObject({ status: 401, passed: false });
    const ok = await run('/media/1_abc.jpg', media(5));
    expect(ok.passed).toBe(true);
    expect(ok.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(ok.headers['Content-Disposition']).toBeUndefined();
  });

  it('akun nonaktif ditolak; berkas non-media dipaksa unduh dan disandbox', async () => {
    mocks.findUnique.mockResolvedValueOnce({ isActive: false });
    expect((await run('/media/x.jpg', media(6))).status).toBe(401);
    const doc = await run('/media/1_x.bin', media(7));
    expect(doc.headers['Content-Disposition']).toBe('attachment');
    expect(doc.headers['Content-Security-Policy']).toContain('sandbox');
    const pdf = await run('/media/1_x.pdf', media(8));
    expect(pdf.headers['Content-Disposition']).toBeUndefined();
    expect(pdf.headers['Content-Security-Policy']).toBeUndefined();
  });
});

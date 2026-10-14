import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../../db/prisma.js', () => ({ prisma: { user: { findUnique: mocks.findUnique }, refreshToken: { create: vi.fn() } } }));

import { authRouter } from './auth.routes.js';

function login(body: unknown) {
  const layer = (authRouter as any).stack.find((l: any) => l.route?.path === '/login' && l.route.methods.post);
  return new Promise<any>((resolve) => {
    const res: any = { status() { return res; }, json: (data: any) => resolve({ ok: true, data }), cookie() {} };
    layer.route.stack.at(-1).handle({ body, get: () => undefined, ip: '127.0.0.1' }, res, (error: any) => resolve({ ok: false, error }));
  });
}

beforeEach(() => vi.restoreAllMocks());

describe('Login: waktu respons tidak membedakan email terdaftar', () => {
  it('email tidak ada tetap menjalankan bcrypt (hash pembanding) lalu 401', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const compare = vi.spyOn(bcrypt, 'compare');
    const result = await login({ email: 'tidak.ada@x.id', password: 'rahasia-panjang' });
    expect(result.ok).toBe(false);
    expect(result.error.status).toBe(401);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(String(compare.mock.calls[0]![1])).toMatch(/^\$2[aby]\$12\$/);
  });

  it('akun nonaktif juga menjalankan bcrypt dan ditolak dengan pesan yang sama', async () => {
    const hash = await bcrypt.hash('benar-sekali', 4);
    mocks.findUnique.mockResolvedValue({ id: 1, isActive: false, password: hash, email: 'a@x.id' });
    const compare = vi.spyOn(bcrypt, 'compare');
    const result = await login({ email: 'a@x.id', password: 'benar-sekali' });
    expect(result.error.status).toBe(401);
    expect(result.error.message).toBe('Email atau kata sandi tidak sesuai.');
    expect(compare).toHaveBeenCalledTimes(1);
  });
});

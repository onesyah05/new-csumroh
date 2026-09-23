import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: number; userId: number; tokenHash: string; revokedAt: Date | null; expiresAt: Date };
const store = vi.hoisted(() => ({ rows: [] as Row[], nextId: 1 }));

vi.mock('../../db/prisma.js', () => {
  const matches = (row: Row, where: any) => Object.entries(where).every(([key, cond]: [string, any]) => {
    const value = (row as any)[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && 'gt' in cond) return value > cond.gt;
    return value === cond;
  });
  return {
    prisma: {
      refreshToken: {
        findFirst: async ({ where }: any) => store.rows.find((r) => matches(r, where)) ?? null,
        findUnique: async ({ where }: any) => store.rows.find((r) => r.id === where.id) ?? null,
        updateMany: async ({ where, data }: any) => {
          const hits = store.rows.filter((r) => matches(r, where));
          hits.forEach((r) => Object.assign(r, data));
          return { count: hits.length };
        },
        create: async ({ data }: any) => {
          const row = { id: store.nextId++, revokedAt: null, ...data };
          store.rows.push(row);
          return row;
        },
      },
      user: {
        findUnique: async () => ({ id: 10, name: 'SA', email: 'sa@x.id', role: 'superadmin', brandId: null, brand: null, userBrands: [], isActive: true }),
      },
    },
  };
});

import { env } from '../../config/env.js';
import { authRouter, REFRESH_ROTATION_GRACE_MS } from './auth.routes.js';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

function seedToken(overrides: Partial<Row> = {}) {
  const token = jwt.sign({ sub: '10', jti: `t${store.nextId}`, type: 'refresh' }, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
  store.rows.push({ id: store.nextId++, userId: 10, tokenHash: hash(token), revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000), ...overrides });
  return token;
}

function call(path: '/refresh' | '/logout', cookie?: string) {
  const layer = (authRouter as any).stack.find((l: any) => l.route?.path === path);
  return new Promise<{ status: number; cookie?: string; body: any }>((resolve) => {
    let status = 200;
    let setCookie: string | undefined;
    const res: any = {
      status: (s: number) => { status = s; return res; },
      cookie: (_name: string, value: string) => { setCookie = value; },
      clearCookie: () => undefined,
      json: (body: any) => resolve({ status, cookie: setCookie, body }),
      setHeader: () => undefined,
      getHeader: () => undefined,
    };
    const req: any = { cookies: cookie ? { refresh_token: cookie } : {}, get: () => 'test-agent', ip: '::1', headers: {}, app: { get: () => undefined } };
    // Lewati rate limiter; jalankan handler bisnis terakhir.
    layer.route.stack.at(-1).handle(req, res, (error: any) => resolve({ status: error.status ?? 500, body: { error: error.message } }));
  });
}

beforeEach(() => {
  store.rows = [];
  store.nextId = 1;
});

describe('Rotasi refresh token', () => {
  it('rotasi normal: token lama dicabut, token baru diterbitkan', async () => {
    const token = seedToken();
    const result = await call('/refresh', token);
    expect(result.status).toBe(200);
    expect(result.cookie).toBeTruthy();
    expect(store.rows[0]!.revokedAt).toBeInstanceOf(Date);
  });

  it('dua tab me-refresh bersamaan dengan token yang sama: keduanya tetap login', async () => {
    const token = seedToken();
    const [a, b] = await Promise.all([call('/refresh', token), call('/refresh', token)]);
    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it('respons rotasi hilang (reload di tengah request): token lama masih diterima dalam masa tenggang', async () => {
    const token = seedToken({ revokedAt: new Date(Date.now() - 5_000) });
    expect((await call('/refresh', token)).status).toBe(200);
  });

  it('token yang dirotasi lama berselang tetap ditolak', async () => {
    const token = seedToken({ revokedAt: new Date(Date.now() - REFRESH_ROTATION_GRACE_MS - 1_000) });
    expect((await call('/refresh', token)).status).toBe(401);
  });

  it('setelah logout, token tidak diterima lagi walau masih dalam masa tenggang', async () => {
    const token = seedToken();
    expect((await call('/refresh', token)).status).toBe(200); // dirotasi barusan
    await call('/logout', token);
    expect((await call('/refresh', token)).status).toBe(401);
  });
});

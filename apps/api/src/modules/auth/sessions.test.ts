import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updateMany: vi.fn(), disconnect: vi.fn() }));
vi.mock('../../db/prisma.js', () => ({ prisma: { refreshToken: { updateMany: mocks.updateMany } } }));
vi.mock('../../realtime/socket.js', () => ({ disconnectUser: mocks.disconnect }));

import { env } from '../../config/env.js';
import { authGuard } from '../../middleware/auth.js';
import { isTokenRevoked, revokeUserSessions } from './sessions.js';

const tokenFor = (id: number, iat: number) =>
  jwt.sign({ id, name: 'X', email: 'x@test', role: 'cs', brandId: 1, type: 'access', iat }, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });

function guard(token: string) {
  return new Promise<unknown>((resolve) => authGuard({ headers: { authorization: `Bearer ${token}` } } as any, {} as any, (error?: unknown) => resolve(error)));
}

beforeEach(() => vi.clearAllMocks());

describe('Pencabutan sesi', () => {
  it('mencabut refresh token, memutus realtime, dan menolak access token yang terbit sebelumnya', async () => {
    const before = Math.floor(Date.now() / 1000) - 60;
    expect(await guard(tokenFor(42, before))).toBeUndefined();

    await revokeUserSessions(42);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { userId: 42, expiresAt: { gt: expect.any(Date) } },
      data: { revokedAt: expect.any(Date), expiresAt: expect.any(Date) },
    });
    expect(mocks.disconnect).toHaveBeenCalledWith(42);
    expect(isTokenRevoked(42, before)).toBe(true);
    expect(await guard(tokenFor(42, before))).toMatchObject({ status: 401 });

    // Login ulang setelah pencabutan tetap diterima; user lain tidak terdampak.
    expect(await guard(tokenFor(42, Math.floor(Date.now() / 1000) + 1))).toBeUndefined();
    expect(await guard(tokenFor(7, before))).toBeUndefined();
  });

  it('token dengan algoritma selain HS256 ditolak', async () => {
    const none = jwt.sign({ id: 1, type: 'access' }, '', { algorithm: 'none' as any });
    expect(await guard(none)).toMatchObject({ status: 401 });
  });
});

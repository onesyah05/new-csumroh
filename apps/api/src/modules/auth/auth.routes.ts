import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { loginSchema, roleSchema, type SessionUser } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { authGuard } from '../../middleware/auth.js';
import { clearMediaCookie, setMediaCookie } from './media-access.js';

export const authRouter = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'production' ? 10 : 1000,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
// Per akun: menahan tebak kata sandi terdistribusi (banyak IP ke satu email). Hanya percobaan gagal yang dihitung.
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'production' ? 10 : 1000,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `login:${String(req.body?.email ?? '').trim().toLowerCase()}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: 'Terlalu banyak percobaan login untuk akun ini. Coba lagi dalam 15 menit.' },
});
const refreshLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'production' ? 60 : 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function sessionFromUser(user: {
  id: number;
  name: string;
  email: string;
  role: string;
  brandId: number | null;
  brand: { id: number; name: string; code: string } | null;
  userBrands?: { brand: { id: number; name: string; code: string } }[];
}): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: roleSchema.parse(user.role),
    brandId: user.brandId,
    brand: user.brand,
    userBrands: user.userBrands,
  };
}

async function issueTokens(user: SessionUser, req: Parameters<typeof getClientMeta>[0]) {
  const accessToken = jwt.sign({ ...user, type: 'access' }, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  const tokenId = randomUUID();
  const refreshToken = jwt.sign({ sub: String(user.id), jti: tokenId, type: 'refresh' }, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: hashToken(refreshToken), ...getClientMeta(req), expiresAt: new Date(Date.now() + 30 * 86400_000) } });
  return { accessToken, refreshToken };
}

function getClientMeta(req: { get(name: string): string | undefined; ip?: string }) {
  return { userAgent: req.get('user-agent')?.slice(0, 255), ipAddress: req.ip?.slice(0, 45) };
}

function setRefreshCookie(res: import('express').Response, token: string) {
  res.cookie('refresh_token', token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1/auth', maxAge: 30 * 86400_000 });
}

authRouter.post('/login', loginLimiter, loginAccountLimiter, asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: {
      brand: { select: { id: true, name: true, code: true } },
      userBrands: { select: { brand: { select: { id: true, name: true, code: true } } } },
    },
  });
  if (!user || !user.isActive || !(await bcrypt.compare(input.password, user.password))) throw new HttpError(401, 'Email atau kata sandi tidak sesuai.');
  const session = sessionFromUser(user);
  const tokens = await issueTokens(session, req);
  setRefreshCookie(res, tokens.refreshToken);
  setMediaCookie(res, session.id);
  res.json({ success: true, data: { accessToken: tokens.accessToken, user: session } });
}));

/**
 * Masa tenggang rotasi. Refresh token dirotasi setiap dipakai, tetapi respons yang membawa cookie baru
 * bisa tidak pernah sampai ke browser (halaman di-reload/ditutup saat request berjalan, atau dua tab
 * me-refresh bersamaan). Tanpa tenggang, browser tertinggal memegang token yang sudah dicabut dan
 * pengguna ter-logout permanen. Token yang dicabut KARENA ROTASI tetap diterima sebentar; token yang
 * dicabut karena logout ditandai kedaluwarsa sehingga tidak pernah diterima lagi.
 */
export const REFRESH_ROTATION_GRACE_MS = 30_000;

authRouter.post('/refresh', refreshLimiter, asyncHandler(async (req, res) => {
  const oldToken = req.cookies.refresh_token as string | undefined;
  if (!oldToken) throw new HttpError(401, 'Refresh token tidak tersedia.');
  let payload: jwt.JwtPayload;
  try { payload = jwt.verify(oldToken, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload; } catch { throw new HttpError(401, 'Refresh token tidak valid.'); }
  const now = new Date();
  const stored = await prisma.refreshToken.findFirst({ where: { tokenHash: hashToken(oldToken), expiresAt: { gt: now } } });
  if (!stored || stored.userId !== Number(payload.sub)) throw new HttpError(401, 'Refresh token sudah tidak aktif.');

  const withinGrace = (revokedAt: Date | null) => Boolean(revokedAt) && now.getTime() - revokedAt!.getTime() <= REFRESH_ROTATION_GRACE_MS;
  if (stored.revokedAt) {
    if (!withinGrace(stored.revokedAt)) throw new HttpError(401, 'Refresh token sudah tidak aktif.');
  } else {
    // Pencabutan atomik: dari dua request paralel dengan token yang sama, hanya satu yang mencabut;
    // yang lain masuk jalur masa tenggang (tidak ditolak, tidak membuat logout).
    const claimed = await prisma.refreshToken.updateMany({ where: { id: stored.id, revokedAt: null }, data: { revokedAt: now } });
    if (claimed.count === 0) {
      const current = await prisma.refreshToken.findUnique({ where: { id: stored.id }, select: { revokedAt: true, expiresAt: true } });
      if (!current || current.expiresAt <= now || !withinGrace(current.revokedAt)) throw new HttpError(401, 'Refresh token sudah tidak aktif.');
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    include: {
      brand: { select: { id: true, name: true, code: true } },
      userBrands: { select: { brand: { select: { id: true, name: true, code: true } } } },
    },
  });
  if (!user?.isActive) throw new HttpError(401, 'Akun tidak aktif.');
  const session = sessionFromUser(user);
  const tokens = await issueTokens(session, req);
  setRefreshCookie(res, tokens.refreshToken);
  setMediaCookie(res, session.id);
  res.json({ success: true, data: { accessToken: tokens.accessToken, user: session } });
}));

authRouter.post('/logout', asyncHandler(async (req, res) => {
  const token = req.cookies.refresh_token as string | undefined;
  if (token) {
    const now = new Date();
    // Kedaluwarsakan juga token yang baru dirotasi, agar masa tenggang tidak berlaku setelah logout.
    await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token) }, data: { expiresAt: now } });
    await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: now } });
  }
  res.clearCookie('refresh_token', { path: '/api/v1/auth' });
  clearMediaCookie(res);
  res.json({ success: true, data: null });
}));

authRouter.get('/me', authGuard, (req, res) => res.json({ success: true, data: req.user }));

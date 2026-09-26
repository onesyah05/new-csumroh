import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { isTokenRevoked } from './sessions.js';

/**
 * Media percakapan (kiriman jamaah: foto, KTP/paspor, dokumen) dan foto profil WhatsApp bukan berkas publik.
 * `<img>`/`<video>` tidak membawa header Authorization, jadi akses memakai cookie httpOnly khusus path
 * `/uploads` yang diterbitkan bersama sesi (login/refresh) dan dihapus saat logout. Flyer paket dan logo brand
 * tetap publik (dikirim ke jamaah / tampil di materi).
 */
export const MEDIA_COOKIE = 'media_token';
const MEDIA_TTL_MS = 12 * 3_600_000;
const PROTECTED_DIRS = ['media', 'chat', 'avatars'];
/** Tipe yang boleh tampil langsung di browser; lainnya dipaksa diunduh. */
const INLINE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.3gp', '.mov', '.mp3', '.ogg', '.opus', '.m4a', '.aac', '.wav', '.pdf']);

export function setMediaCookie(res: Response, userId: number) {
  const token = jwt.sign({ sub: String(userId), type: 'media' }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: MEDIA_TTL_MS / 1000 });
  res.cookie(MEDIA_COOKIE, token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/uploads', maxAge: MEDIA_TTL_MS });
}

export function clearMediaCookie(res: Response) {
  res.clearCookie(MEDIA_COOKIE, { path: '/uploads' });
}

/** Status aktif per user di-cache sebentar agar tiap gambar tidak memicu query. */
const activeCache = new Map<number, { active: boolean; at: number }>();
const ACTIVE_CACHE_MS = 60_000;
async function isActiveUser(userId: number) {
  const cached = activeCache.get(userId);
  if (cached && Date.now() - cached.at < ACTIVE_CACHE_MS) return cached.active;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  const active = Boolean(user?.isActive);
  activeCache.set(userId, { active, at: Date.now() });
  return active;
}

/** Dipasang sebelum `express.static('/uploads')`. Direktori publik diteruskan tanpa pemeriksaan. */
export async function protectUploads(req: Request, res: Response, next: NextFunction) {
  const dir = req.path.split('/')[1] ?? '';
  if (!PROTECTED_DIRS.includes(dir)) return next();
  try {
    const token = req.cookies?.[MEDIA_COOKIE] as string | undefined;
    if (!token) throw new Error('missing');
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    const userId = Number(payload.sub);
    if (payload.type !== 'media' || !userId || isTokenRevoked(userId, payload.iat) || !(await isActiveUser(userId))) throw new Error('denied');
  } catch {
    res.status(401).json({ success: false, error: 'Berkas hanya dapat dibuka oleh staf yang masuk.' });
    return;
  }
  // Berkas kiriman pihak luar: jangan pernah dijalankan sebagai konten aktif, dan jangan disimpan cache bersama.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // PDF dikecualikan dari sandbox agar penampil PDF bawaan browser tetap bisa membukanya.
  if (path.extname(req.path).toLowerCase() !== '.pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (!INLINE_EXTENSIONS.has(path.extname(req.path).toLowerCase())) res.setHeader('Content-Disposition', 'attachment');
  next();
}

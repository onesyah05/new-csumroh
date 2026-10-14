import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { visibleBrandIds } from '../../middleware/auth.js';
import { isTokenRevoked } from './sessions.js';

/**
 * Media percakapan (kiriman jamaah: foto, KTP/paspor, dokumen), foto profil WhatsApp, dan gallery bukan berkas publik.
 * `<img>`/`<video>` tidak membawa header Authorization, jadi akses memakai cookie httpOnly khusus path
 * `/uploads` yang diterbitkan bersama sesi (login/refresh) dan dihapus saat logout. Selain login, berkas hanya
 * dibuka oleh staf yang boleh melihat brand pemiliknya. Flyer paket dan logo brand tetap publik (dikirim ke
 * jamaah / tampil di materi).
 */
export const MEDIA_COOKIE = 'media_token';
const MEDIA_TTL_MS = 12 * 3_600_000;
const PROTECTED_DIRS = ['media', 'chat', 'avatars', 'ad-creatives', 'gallery'];
/** Thumbnail iklan bersifat materi pemasaran per iklan, bukan data jamaah: cukup login. */
const LOGIN_ONLY_DIRS = new Set(['ad-creatives']);
/** Tipe yang boleh tampil langsung di browser; lainnya dipaksa diunduh. */
const INLINE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.3gp', '.mov', '.mp3', '.ogg', '.opus', '.m4a', '.aac', '.wav', '.pdf']);

export function setMediaCookie(res: Response, userId: number) {
  const token = jwt.sign({ sub: String(userId), type: 'media' }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: MEDIA_TTL_MS / 1000 });
  res.cookie(MEDIA_COOKIE, token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/uploads', maxAge: MEDIA_TTL_MS });
}

export function clearMediaCookie(res: Response) {
  res.clearCookie(MEDIA_COOKIE, { path: '/uploads' });
}

type MediaUser = { role: string; brandId: number | null; userBrands: { brand: { id: number } }[] };

/** Status dan akses brand per user di-cache sebentar agar tiap gambar tidak memicu query. */
const userCache = new Map<number, { user: MediaUser | null; at: number }>();
const USER_CACHE_MS = 60_000;
/** Aktif dan berhak membuka media percakapan. Designer hanya mengurus flyer/template: tidak melihat media jamaah. */
async function loadMediaUser(userId: number): Promise<MediaUser | null> {
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.at < USER_CACHE_MS) return cached.user;
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true, brandId: true, userBrands: { select: { brandId: true } } } });
  const allowed = Boolean(row?.isActive) && row?.role !== 'designer';
  const user: MediaUser | null = allowed && row
    ? { role: row.role, brandId: row.brandId, userBrands: (row.userBrands ?? []).map((item) => ({ brand: { id: item.brandId } })) }
    : null;
  userCache.set(userId, { user, at: Date.now() });
  return user;
}

/** Pemilik brand per berkas di-cache (pemilik tidak berubah); dibatasi agar memori tidak tumbuh tanpa batas. */
const ownerCache = new Map<string, number | null>();
const OWNER_CACHE_MAX = 5_000;

/**
 * Brand pemilik berkas. Gallery dan avatar membawa petunjuk di nama berkas (`g<brand>-…`, `p<prospek>-…`); media
 * chat dicari dari pesan yang memuat URL-nya. null = tidak diketahui (hanya pengawas holding yang boleh membuka).
 */
async function ownerBrandOf(dir: string, requestPath: string): Promise<number | null> {
  const cached = ownerCache.get(requestPath);
  if (cached !== undefined) return cached;
  let brandId: number | null = null;
  const file = requestPath.split('/').pop() ?? '';
  if (dir === 'gallery') {
    const match = /^g(\d+)-/.exec(file);
    brandId = match ? Number(match[1]) : null;
  } else if (dir === 'avatars') {
    const match = /^p(\d+)-/.exec(file);
    if (match) brandId = (await prisma.prospect.findUnique({ where: { id: Number(match[1]) }, select: { brandId: true } }))?.brandId ?? null;
  } else {
    brandId = (await prisma.chatMessage.findFirst({ where: { mediaUrl: `/uploads${requestPath}` }, select: { brandId: true } }))?.brandId ?? null;
  }
  // Hasil "tidak ketahuan" tidak di-cache: pesan bisa baru tersimpan beberapa saat setelah berkasnya.
  if (brandId !== null) {
    if (ownerCache.size >= OWNER_CACHE_MAX) ownerCache.clear();
    ownerCache.set(requestPath, brandId);
  }
  return brandId;
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
    if (payload.type !== 'media' || !userId || isTokenRevoked(userId, payload.iat)) throw new Error('denied');
    const user = await loadMediaUser(userId);
    if (!user) throw new Error('denied');
    if (!LOGIN_ONLY_DIRS.has(dir)) {
      const visible = visibleBrandIds(user);
      if (visible !== null) {
        const owner = await ownerBrandOf(dir, req.path);
        if (owner === null || !visible.includes(owner)) {
          res.status(404).json({ success: false, error: 'Berkas tidak ditemukan.' });
          return;
        }
      }
    }
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

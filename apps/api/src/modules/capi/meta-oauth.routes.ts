import { Router } from 'express';
import { allowedOrigins } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { asyncHandler } from '../../utils/http.js';
import { consumeState, exchangeCodeForLongLivedToken, metaOauthConfigured, safeReturnPath, saveOauthToken } from './meta-oauth.js';

/**
 * Callback dari Meta (browser diarahkan ke sini, tanpa header Authorization), jadi tidak memakai authGuard.
 * Keamanan: state bertanda tangan, berumur 10 menit, sekali pakai, dan memuat brand + pengguna yang memulai.
 */
export const metaOauthCallbackRouter = Router();

/** Kode alasan tetap (bukan teks bebas): frontend memetakannya ke pesan, jadi tautan buatan tidak dapat menampilkan teks sembarang. */
export type OauthFailure = 'denied' | 'expired' | 'unavailable' | 'failed';

const redirectBack = (path: string, outcome: 'connected' | 'error', reason?: OauthFailure) => {
  const base = allowedOrigins[0] ?? '';
  const url = new URL(`${base}${safeReturnPath(path)}`, base || 'http://localhost');
  url.searchParams.set('meta', outcome);
  if (reason) url.searchParams.set('reason', reason);
  return base ? url.toString() : `${url.pathname}${url.search}`;
};

metaOauthCallbackRouter.get('/', asyncHandler(async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!metaOauthConfigured()) return res.redirect(redirectBack('/brands', 'error', 'unavailable'));

  let parsed: Awaited<ReturnType<typeof consumeState>>;
  try {
    parsed = await consumeState(state);
  } catch {
    // State kedaluwarsa, terpakai, atau palsu: tidak ada konteks brand, kembali ke daftar Brand.
    return res.redirect(redirectBack('/brands', 'error', 'expired'));
  }

  // Pengguna menolak izin di dialog Meta.
  if (!code) return res.redirect(redirectBack(parsed.returnTo, 'error', 'denied'));

  try {
    const brand = await prisma.brand.findUnique({ where: { id: parsed.brandId }, select: { id: true } });
    if (!brand) throw new Error('Brand tidak ditemukan.');
    const user = await prisma.user.findUnique({ where: { id: parsed.userId }, select: { isActive: true, role: true } });
    if (!user?.isActive || !['superadmin', 'admin'].includes(user.role)) throw new Error('Pengguna tidak berhak menghubungkan Meta.');
    await saveOauthToken(parsed.brandId, await exchangeCodeForLongLivedToken(code));
    res.redirect(redirectBack(parsed.returnTo, 'connected'));
  } catch (error) {
    const message = (error as Error).message;
    console.error('Meta OAuth callback gagal', message);
    // Detail dari Meta tampil di kartu "Error terakhir dari Meta" milik brand (hanya terlihat admin), bukan di URL.
    await prisma.brand.update({ where: { id: parsed.brandId }, data: { metaLastError: `Hubungkan Meta gagal: ${message}`.slice(0, 5000) } }).catch(() => undefined);
    res.redirect(redirectBack(parsed.returnTo, 'error', 'failed'));
  }
}));

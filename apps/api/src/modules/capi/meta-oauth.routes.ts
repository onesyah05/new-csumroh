import { Router } from 'express';
import { allowedOrigins } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { consumeState, exchangeCodeForLongLivedToken, metaOauthConfigured, safeReturnPath, saveOauthToken } from './meta-oauth.js';

/**
 * Callback dari Meta (browser diarahkan ke sini, tanpa header Authorization), jadi tidak memakai authGuard.
 * Keamanan: state bertanda tangan, berumur 10 menit, sekali pakai, dan memuat brand + pengguna yang memulai.
 */
export const metaOauthCallbackRouter = Router();

const redirectBack = (path: string, outcome: 'connected' | 'error', reason?: string) => {
  const base = allowedOrigins[0] ?? '';
  const url = new URL(`${base}${safeReturnPath(path)}`, base || 'http://localhost');
  url.searchParams.set('meta', outcome);
  if (reason) url.searchParams.set('reason', reason.slice(0, 200));
  return base ? url.toString() : `${url.pathname}${url.search}`;
};

metaOauthCallbackRouter.get('/', asyncHandler(async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!metaOauthConfigured()) throw new HttpError(503, 'Meta App belum dikonfigurasi di server.');
  const parsed = await consumeState(state);

  // Pengguna menolak izin di dialog Meta.
  if (!code) {
    const reason = typeof req.query.error_description === 'string' ? req.query.error_description : 'Izin Meta tidak diberikan.';
    return res.redirect(redirectBack(parsed.returnTo, 'error', reason));
  }

  try {
    const brand = await prisma.brand.findUnique({ where: { id: parsed.brandId }, select: { id: true } });
    if (!brand) throw new Error('Brand tidak ditemukan.');
    const user = await prisma.user.findUnique({ where: { id: parsed.userId }, select: { isActive: true, role: true } });
    if (!user?.isActive || !['superadmin', 'admin'].includes(user.role)) throw new Error('Pengguna tidak berhak menghubungkan Meta.');
    await saveOauthToken(parsed.brandId, await exchangeCodeForLongLivedToken(code));
    res.redirect(redirectBack(parsed.returnTo, 'connected'));
  } catch (error) {
    console.error('Meta OAuth callback gagal', (error as Error).message);
    res.redirect(redirectBack(parsed.returnTo, 'error', (error as Error).message));
  }
}));

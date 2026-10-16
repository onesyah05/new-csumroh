import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../utils/http.js';
import { claimOnce } from '../notifications/jobs.js';
import { clearAdInsightsCache } from '../ads/ad-insights.js';
import { clearAdSpendCache } from '../reports/ad-spend.js';
import { decryptMetaToken, encryptMetaToken } from './meta-token.js';
import { isMetaSendingAllowed } from './send-guard.js';

/** ads_read untuk Laporan & nama iklan; ads_management karena sinkron audiens spam membuat/mengubah Custom Audience. */
export const META_OAUTH_SCOPES = ['ads_read', 'ads_management'];
const STATE_TTL_SECONDS = 10 * 60;
const DEFAULT_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const REFRESH_WINDOW_MS = 20 * 24 * 60 * 60 * 1000;
const GRAPH = () => `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}`;

export const metaOauthConfigured = () => Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_OAUTH_REDIRECT_URI);

function requireConfig() {
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_OAUTH_REDIRECT_URI) {
    throw new HttpError(503, 'Meta App belum dikonfigurasi di server (META_APP_ID, META_APP_SECRET, META_OAUTH_REDIRECT_URI).');
  }
  return { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, redirectUri: env.META_OAUTH_REDIRECT_URI };
}

/** Hanya path internal: state yang dipalsukan tidak boleh mengalihkan pengguna ke situs lain. */
export const safeReturnPath = (value: unknown) =>
  typeof value === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(value) && !value.includes('\\') ? value : '/brands';

export function buildAuthorizeUrl(input: { brandId: number; userId: number; returnTo: string }) {
  const { appId, redirectUri } = requireConfig();
  const state = jwt.sign(
    { type: 'meta-oauth', brandId: input.brandId, sub: String(input.userId), returnTo: safeReturnPath(input.returnTo), jti: randomUUID() },
    env.JWT_ACCESS_SECRET,
    { algorithm: 'HS256', expiresIn: STATE_TTL_SECONDS },
  );
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: META_OAUTH_SCOPES.join(','),
  });
  return `https://www.facebook.com/${env.META_GRAPH_API_VERSION}/dialog/oauth?${params}`;
}

export type OauthState = { brandId: number; userId: number; returnTo: string };

/** Verifikasi state dan pakai sekali: callback yang diputar ulang ditolak. */
export async function consumeState(state: string): Promise<OauthState> {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(state, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  } catch {
    throw new HttpError(400, 'Sesi hubungkan Meta kedaluwarsa. Ulangi dari halaman Brand.');
  }
  if (payload.type !== 'meta-oauth' || !payload.jti || !Number.isInteger(payload.brandId) || !payload.sub) {
    throw new HttpError(400, 'State OAuth tidak valid.');
  }
  if (!(await claimOnce(`meta-oauth:${payload.jti}`))) throw new HttpError(400, 'Sesi hubungkan Meta sudah dipakai. Ulangi dari halaman Brand.');
  return { brandId: payload.brandId as number, userId: Number(payload.sub), returnTo: safeReturnPath(payload.returnTo) };
}

type TokenResponse = { access_token?: string; expires_in?: number; error?: { message?: string } };

async function graphToken(body: Record<string, string>): Promise<{ token: string; expiresAt: Date | null }> {
  // POST agar app secret tidak masuk URL/log proxy.
  const response = await fetch(`${GRAPH()}/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !data.access_token) throw new Error(data.error?.message ?? `Meta menolak permintaan token (${response.status}).`);
  return { token: data.access_token, expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null };
}

/** Kode otorisasi -> token pendek -> token panjang (±60 hari). */
export async function exchangeCodeForLongLivedToken(code: string) {
  const { appId, appSecret, redirectUri } = requireConfig();
  const short = await graphToken({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
  return graphToken({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: short.token });
}

export function refreshLongLivedToken(currentToken: string) {
  const { appId, appSecret } = requireConfig();
  return graphToken({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: currentToken });
}

export type MetaAdAccount = { id: string; name: string; status: number | null; businessName: string | null };

/** Akun iklan yang dapat diakses token (untuk dipilih, tanpa mengetik ID). */
export async function listAdAccounts(token: string): Promise<MetaAdAccount[]> {
  const params = new URLSearchParams({ fields: 'account_id,name,account_status,business{name}', limit: '100' });
  const response = await fetch(`${GRAPH()}/me/adaccounts?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    data?: { account_id?: string; name?: string; account_status?: number; business?: { name?: string } }[];
    error?: { message?: string };
  };
  if (!response.ok) throw new HttpError(422, data.error?.message ?? `Meta menolak daftar akun iklan (${response.status}).`);
  return (data.data ?? [])
    .filter((row) => row.account_id)
    .map((row) => ({ id: row.account_id!, name: row.name ?? row.account_id!, status: row.account_status ?? null, businessName: row.business?.name ?? null }));
}

export async function saveOauthToken(brandId: number, result: { token: string; expiresAt: Date | null }) {
  await prisma.brand.update({
    where: { id: brandId },
    // Meta kadang tidak mengirim expires_in untuk token panjang: anggap 60 hari agar tetap masuk jadwal perpanjangan.
    data: {
      metaAdsAccessToken: encryptMetaToken(result.token),
      metaAdsTokenSource: 'oauth',
      metaAdsTokenExpiresAt: result.expiresAt ?? new Date(Date.now() + DEFAULT_TOKEN_TTL_MS),
      metaLastError: null,
    },
  });
  clearAdInsightsCache();
  clearAdSpendCache();
}

/** Perbarui token OAuth yang akan kedaluwarsa dalam 20 hari. Kegagalan satu brand tidak menghentikan brand lain. */
export async function refreshOauthTokensJob(now = new Date()) {
  if (!metaOauthConfigured() || !isMetaSendingAllowed()) return { refreshed: 0, failed: 0 };
  const brands = await prisma.brand.findMany({
    where: { metaAdsTokenSource: 'oauth', metaAdsAccessToken: { not: null }, metaAdsTokenExpiresAt: { lt: new Date(now.getTime() + REFRESH_WINDOW_MS) } },
    select: { id: true, metaAdsAccessToken: true },
  });
  let refreshed = 0;
  let failed = 0;
  for (const brand of brands) {
    try {
      await saveOauthToken(brand.id, await refreshLongLivedToken(decryptMetaToken(brand.metaAdsAccessToken!)));
      refreshed += 1;
    } catch (error) {
      failed += 1;
      const message = (error as Error).message;
      console.error(`Perpanjang token Meta brand ${brand.id} gagal`, message);
      // Tampil di kartu "Error terakhir dari Meta" agar admin tahu harus menghubungkan ulang sebelum token mati.
      await prisma.brand.update({
        where: { id: brand.id },
        data: { metaLastError: `Token iklan gagal diperpanjang otomatis, klik "Hubungkan ulang": ${message}`.slice(0, 5000) },
      }).catch(() => undefined);
    }
  }
  // Dilempar agar scheduler melepas klaim harian dan mencoba lagi (maks. 3 kali).
  if (failed > 0) throw new Error(`${failed} token Meta gagal diperpanjang`);
  return { refreshed, failed };
}

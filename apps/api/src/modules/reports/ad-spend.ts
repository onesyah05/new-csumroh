import { env } from '../../config/env.js';
import { decryptMetaToken } from '../capi/meta-token.js';

export type AdSpend =
  | { status: 'ok'; spend: number; currency: string }
  | { status: 'not_configured' }
  | { status: 'error'; message: string };

type BrandAdConfig = { id: number; metaAdAccountId: string | null; metaAccessToken: string | null };

// Insights dibatasi rate limit per ad account; laporan yang dibuka berulang cukup memakai hasil 10 menit terakhir.
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: AdSpend }>();

export function clearAdSpendCache() {
  cache.clear();
}

function metaErrorMessage(error: { code?: number; message?: string } | undefined) {
  if (error?.code === 190) return 'Access token Meta kedaluwarsa atau tidak valid.';
  if (error?.code === 200 || error?.code === 10 || (error?.code === 100 && /permission|ads_read/i.test(error.message ?? ''))) {
    return 'Token belum punya izin ads_read untuk ad account ini.';
  }
  if (error?.code === 4 || error?.code === 17 || error?.code === 613) return 'Batas permintaan Meta tercapai. Coba lagi beberapa menit lagi.';
  return error?.message ? `Meta: ${error.message}` : 'Gagal mengambil biaya iklan dari Meta.';
}

/**
 * Total biaya iklan (spend) ad account brand untuk rentang tanggal, dari Marketing API Insights (level akun).
 * Tanggal mengikuti zona waktu ad account di Meta. Memakai access token Meta CAPI brand (perlu izin ads_read).
 */
export async function fetchAdSpend(brand: BrandAdConfig, from: string, to: string): Promise<AdSpend> {
  if (!brand.metaAdAccountId || !brand.metaAccessToken) return { status: 'not_configured' };
  const key = `${brand.id}:${brand.metaAdAccountId}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value: AdSpend;
  try {
    const params = new URLSearchParams({
      fields: 'spend,account_currency',
      level: 'account',
      time_range: JSON.stringify({ since: from, until: to }),
    });
    const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/act_${encodeURIComponent(brand.metaAdAccountId)}/insights?${params}`, {
      headers: { Authorization: `Bearer ${decryptMetaToken(brand.metaAccessToken)}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({})) as { data?: { spend?: string; account_currency?: string }[]; error?: { code?: number; message?: string } };
    if (!response.ok || body.error) {
      value = { status: 'error', message: metaErrorMessage(body.error) };
    } else {
      // Tanpa tayangan pada rentang itu Meta mengembalikan data kosong: biaya 0.
      const row = body.data?.[0];
      value = { status: 'ok', spend: Number(row?.spend ?? 0) || 0, currency: row?.account_currency ?? 'IDR' };
    }
  } catch (error) {
    value = { status: 'error', message: (error as Error).name === 'TimeoutError' ? 'Meta tidak merespons. Coba lagi.' : 'Gagal menghubungi Meta.' };
  }
  // Galat tidak di-cache lama agar perbaikan token langsung terlihat.
  if (value.status === 'ok') cache.set(key, { at: Date.now(), value });
  return value;
}

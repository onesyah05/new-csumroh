import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';
import { decryptMetaToken } from '../capi/meta-token.js';

/** Metrik per iklan dari Meta Insights (level ad) untuk rentang tanggal, ditambah thumbnail kreatif yang disalin lokal. */
export type AdInsight = {
  adId: string;
  adName: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversations: number;
  currency: string;
  thumbnailUrl: string | null;
};

export type AdInsightsResult = { status: 'ok'; ads: AdInsight[] } | { status: 'not_configured' } | { status: 'error'; message: string };

type BrandAdConfig = { id: number; metaAdAccountId: string | null; metaAccessToken: string | null };
type MetaError = { code?: number; message?: string };

const CACHE_MS = 15 * 60_000;
const cache = new Map<string, { at: number; value: AdInsightsResult }>();
export const clearAdInsightsCache = () => cache.clear();

// "Percakapan dimulai" untuk iklan Click-to-WhatsApp/Messenger (jendela 7 hari, standar Ads Manager).
const CONVERSATION_ACTION = 'onsite_conversion.messaging_conversation_started_7d';
const THUMB_DIR = path.resolve(process.cwd(), 'uploads', 'ad-creatives');

function explain(error: MetaError | undefined) {
  if (error?.code === 190) return 'Access token Meta kedaluwarsa atau tidak valid.';
  if (error?.code === 200 || error?.code === 10 || /permission|ads_read/i.test(error?.message ?? '')) return 'Token belum punya izin ads_read untuk ad account ini.';
  if (error?.code === 4 || error?.code === 17 || error?.code === 613) return 'Batas permintaan Meta tercapai. Coba lagi beberapa menit lagi.';
  return error?.message ? `Meta: ${error.message}` : 'Gagal mengambil data iklan dari Meta.';
}

async function getJson(url: string, token: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok || body.error) throw new Error(explain(body.error));
  return body;
}

const safeId = (id: string) => /^\d+$/.test(id);

/** Salin thumbnail ke /uploads/ad-creatives/{adId}.jpg (URL CDN Meta kedaluwarsa dalam hitungan hari). */
async function localThumbnails(adIds: string[], token: string) {
  const result = new Map<string, string>();
  await fs.promises.mkdir(THUMB_DIR, { recursive: true });
  const missing: string[] = [];
  for (const id of adIds.filter(safeId)) {
    if (fs.existsSync(path.join(THUMB_DIR, `${id}.jpg`))) result.set(id, `/uploads/ad-creatives/${id}.jpg`);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 50) {
    const ids = missing.slice(i, i + 50);
    try {
      const params = new URLSearchParams({ ids: ids.join(','), fields: 'creative.thumbnail_width(480).thumbnail_height(480){thumbnail_url,image_url}' });
      const body = await getJson(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/?${params}`, token);
      await Promise.all(ids.map(async (id) => {
        const creative = body[id]?.creative;
        const source = creative?.image_url ?? creative?.thumbnail_url;
        if (!source) return;
        const image = await fetch(source, { signal: AbortSignal.timeout(15_000) });
        const type = image.headers.get('content-type') ?? '';
        if (!image.ok || !type.startsWith('image/')) return;
        await fs.promises.writeFile(path.join(THUMB_DIR, `${id}.jpg`), Buffer.from(await image.arrayBuffer()));
        result.set(id, `/uploads/ad-creatives/${id}.jpg`);
      }));
    } catch (error) {
      // Thumbnail pelengkap: kegagalan tidak menggagalkan laporan.
      console.error('Ad thumbnail fetch failed', (error as Error).message);
    }
  }
  return result;
}

export async function fetchAdInsights(brand: BrandAdConfig, from: string, to: string): Promise<AdInsightsResult> {
  if (!brand.metaAdAccountId || !brand.metaAccessToken) return { status: 'not_configured' };
  const key = `${brand.id}:${brand.metaAdAccountId}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value: AdInsightsResult;
  try {
    const token = decryptMetaToken(brand.metaAccessToken);
    const params = new URLSearchParams({
      level: 'ad',
      fields: 'ad_id,ad_name,campaign_name,spend,impressions,clicks,ctr,actions,account_currency',
      time_range: JSON.stringify({ since: from, until: to }),
      limit: '500',
    });
    let url: string | undefined = `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/act_${encodeURIComponent(brand.metaAdAccountId)}/insights?${params}`;
    const rows: Record<string, any>[] = [];
    for (let page = 0; url && page < 20; page += 1) {
      const body = await getJson(url, token);
      rows.push(...(body.data ?? []));
      url = body.paging?.next;
    }
    const thumbs = await localThumbnails(rows.map((r) => String(r.ad_id)), token);
    value = {
      status: 'ok',
      ads: rows.map((r) => ({
        adId: String(r.ad_id),
        adName: String(r.ad_name ?? r.ad_id),
        campaignName: String(r.campaign_name ?? ''),
        spend: Number(r.spend ?? 0) || 0,
        impressions: Number(r.impressions ?? 0) || 0,
        clicks: Number(r.clicks ?? 0) || 0,
        ctr: Math.round((Number(r.ctr ?? 0) || 0) * 100) / 100,
        conversations: Number((r.actions as { action_type: string; value: string }[] | undefined)?.find((a) => a.action_type === CONVERSATION_ACTION)?.value ?? 0) || 0,
        currency: String(r.account_currency ?? 'IDR'),
        thumbnailUrl: thumbs.get(String(r.ad_id)) ?? null,
      })),
    };
    cache.set(key, { at: Date.now(), value });
  } catch (error) {
    value = { status: 'error', message: (error as Error).name === 'TimeoutError' ? 'Meta tidak merespons. Coba lagi.' : (error as Error).message };
  }
  return value;
}

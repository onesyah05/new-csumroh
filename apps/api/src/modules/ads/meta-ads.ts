import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { decryptMetaToken, withAdsToken } from '../capi/meta-token.js';
import { isHttpUrl } from '../prospects/referral.service.js';

export type AdLabel = { adId: string; adName: string; campaignName: string | null; thumbnailUrl: string | null };

const isAdId = (id: string) => /^\d{5,30}$/.test(id);

/** Simpan nama iklan hasil Insights agar profil, Inbox, dan log bisa menampilkannya tanpa memanggil Meta. */
export async function rememberAds(brandId: number, ads: AdLabel[]) {
  for (const ad of ads.filter((item) => isAdId(item.adId))) {
    const data = {
      adName: ad.adName.slice(0, 255),
      campaignName: ad.campaignName?.slice(0, 255) || null,
      ...(ad.thumbnailUrl ? { thumbnailUrl: ad.thumbnailUrl } : {}),
    };
    await prisma.metaAd.upsert({
      where: { brandId_adId: { brandId, adId: ad.adId } },
      update: data,
      create: { brandId, adId: ad.adId, ...data },
    });
  }
}

/** Label iklan tersimpan untuk sekumpulan ID iklan (ID iklan Meta unik global). */
export async function adLabels(adIds: (string | null | undefined)[]) {
  const ids = [...new Set(adIds.filter((id): id is string => Boolean(id && isAdId(id))))];
  const rows = ids.length
    ? await prisma.metaAd.findMany({ where: { adId: { in: ids } }, select: { adId: true, adName: true, campaignName: true, thumbnailUrl: true } })
    : [];
  return new Map<string, AdLabel>(rows.map((row) => [row.adId, row]));
}

const THUMB_DIR = path.resolve(process.cwd(), 'uploads', 'ad-creatives');
// {adId}.jpg = gambar penuh (Insights / URL iklan); {adId}-wa.jpg = thumbnail kecil dari pesan, hanya cadangan.
const localThumbnail = (adId: string, includeEmbedded = true) => {
  if (fs.existsSync(path.join(THUMB_DIR, `${adId}.jpg`))) return `/uploads/ad-creatives/${adId}.jpg`;
  return includeEmbedded && fs.existsSync(path.join(THUMB_DIR, `${adId}-wa.jpg`)) ? `/uploads/ad-creatives/${adId}-wa.jpg` : null;
};

/** Hanya CDN Meta: URL gambar datang dari isi pesan WhatsApp, jadi server tidak boleh mengambil host sembarang. */
export function isMetaCdnUrl(value?: string | null) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)(fbcdn\.net|facebook\.com|whatsapp\.net|cdninstagram\.com)$/.test(url.hostname);
  } catch {
    return false;
  }
}

const isJpeg = (data: Buffer) => data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;

/**
 * Salin gambar iklan dari pesan klik iklan ke /uploads/ad-creatives/{adId}.jpg selagi URL CDN-nya belum kedaluwarsa.
 * Bila URL tidak ada atau gagal diunduh, thumbnail JPEG kecil yang tertanam di pesan dipakai (buram, tetapi lebih
 * baik daripada kosong).
 */
export async function cacheAdThumbnail(adId?: string, url?: string, embeddedBase64?: string) {
  if (!adId || !isAdId(adId) || localThumbnail(adId, false)) return;
  try {
    await fs.promises.mkdir(THUMB_DIR, { recursive: true });
    if (isMetaCdnUrl(url)) {
      const image = await fetch(url!, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (image?.ok && (image.headers.get('content-type') ?? '').startsWith('image/')) {
        await fs.promises.writeFile(path.join(THUMB_DIR, `${adId}.jpg`), Buffer.from(await image.arrayBuffer()));
        return;
      }
    }
    const data = embeddedBase64 ? Buffer.from(embeddedBase64, 'base64') : null;
    if (data && isJpeg(data) && !localThumbnail(adId)) await fs.promises.writeFile(path.join(THUMB_DIR, `${adId}-wa.jpg`), data);
  } catch (error) {
    console.error('Ad thumbnail cache failed', (error as Error).message);
  }
}

type StoredReferral = { adId?: string; headline?: string; body?: string; thumbnailUrl?: string; sourceUrl?: string };
export type AdPreview = { adId: string | null; title: string | null; body: string | null; adName: string | null; thumbnailUrl: string | null; sourceUrl: string | null };

/** Tambahkan adPreview ke pesan yang berasal dari klik iklan (kartu "Ad" di chat), memakai label iklan tersimpan. */
export async function withAdPreviews<T extends { metaReferralData?: unknown }>(messages: T[]): Promise<(T & { adPreview: AdPreview | null })[]> {
  const referrals = messages.map((message) => (message.metaReferralData && typeof message.metaReferralData === 'object' ? message.metaReferralData as StoredReferral : null));
  const labels = referrals.some(Boolean) ? await adLabels(referrals.map((referral) => referral?.adId)) : new Map<string, AdLabel>();
  return messages.map((message, index) => {
    const referral = referrals[index];
    if (!referral) return { ...message, adPreview: null };
    const adId = referral.adId && isAdId(referral.adId) ? referral.adId : null;
    const label = adId ? labels.get(adId) : undefined;
    return {
      ...message,
      adPreview: {
        adId,
        title: referral.headline ?? label?.adName ?? null,
        body: referral.body ?? null,
        adName: label?.adName ?? null,
        thumbnailUrl: (adId && localThumbnail(adId)) || label?.thumbnailUrl || (isMetaCdnUrl(referral.thumbnailUrl) ? referral.thumbnailUrl! : null),
        // Data lama tersimpan sebelum validasi http(s) di referral.service.
        sourceUrl: isHttpUrl(referral.sourceUrl) ? referral.sourceUrl! : null,
      },
    };
  });
}

/**
 * Seperti adLabels, tetapi ID yang belum tersimpan diambil langsung dari Meta (butuh token ads_read brand).
 * Dipakai di halaman yang memuat sedikit iklan (profil, daftar prospek per iklan); kegagalan Meta diabaikan.
 */
export async function ensureAdLabels(brandId: number, adIds: (string | null | undefined)[]) {
  const labels = await adLabels(adIds);
  const missing = [...new Set(adIds.filter((id): id is string => Boolean(id && isAdId(id) && !labels.has(id))))].slice(0, 50);
  if (!missing.length) return labels;
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { metaAccessToken: true, metaAdsAccessToken: true } });
  const token = brand ? withAdsToken(brand).metaAccessToken : null;
  if (!token) return labels;
  try {
    const params = new URLSearchParams({ ids: missing.join(','), fields: 'name,campaign{name}' });
    const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/?${params}`, {
      headers: { Authorization: `Bearer ${decryptMetaToken(token)}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return labels;
    const body = await response.json() as Record<string, { name?: string; campaign?: { name?: string } }>;
    const fetched = missing
      .filter((id) => body[id]?.name)
      .map((id) => ({ adId: id, adName: body[id]!.name!, campaignName: body[id]!.campaign?.name ?? null, thumbnailUrl: null }));
    await rememberAds(brandId, fetched);
    for (const ad of fetched) labels.set(ad.adId, ad);
  } catch (error) {
    console.error('Ad label lookup failed', (error as Error).message);
  }
  return labels;
}

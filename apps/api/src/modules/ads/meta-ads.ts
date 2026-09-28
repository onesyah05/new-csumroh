import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { decryptMetaToken, withAdsToken } from '../capi/meta-token.js';

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

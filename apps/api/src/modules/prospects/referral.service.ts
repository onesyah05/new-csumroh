import { z } from 'zod';
import { prisma } from '../../db/prisma.js';

const referralSchema = z.object({
  // Tidak selalu ada (mis. iklan diklik admin akun iklan); tanpa ctwaClid pesan tetap ditandai dari iklan, tanpa CAPI.
  ctwaClid: z.string().trim().min(8).max(500).optional().catch(undefined),
  adId: z.string().trim().max(100).optional(),
  campaignId: z.string().trim().max(100).optional(),
  headline: z.string().trim().max(255).optional(),
  // Kartu "Ad" di chat. Teks panjang dipotong, bukan ditolak, agar penanda klik iklan tetap tersimpan.
  body: z.string().trim().transform((value) => value.slice(0, 500)).optional(),
  thumbnailUrl: z.string().trim().url().max(2000).optional().catch(undefined),
  // Thumbnail JPEG tertanam (base64) bila iklan tanpa URL gambar; disimpan sebagai file, tidak masuk database.
  thumbnailBase64: z.string().max(300_000).regex(/^[A-Za-z0-9+/=]+$/).optional().catch(undefined),
  sourceUrl: z.string().trim().url().max(2000).optional(),
});

export type ReferralMarker = z.infer<typeof referralSchema>;

export function normalizeReferralMarker(value: unknown): ReferralMarker | null {
  const parsed = referralSchema.safeParse(value);
  if (!parsed.success) return null;
  const { ctwaClid, adId, headline, sourceUrl } = parsed.data;
  return ctwaClid || adId || headline || sourceUrl ? parsed.data : null;
}

/** Data referral untuk kolom meta_referral_data: tanpa thumbnail base64 (gambar disimpan sebagai file). */
export function storedReferral(marker: ReferralMarker | null) {
  if (!marker) return undefined;
  const { thumbnailBase64: _thumbnail, ...rest } = marker;
  return rest;
}

type ReferralStore = Pick<typeof prisma, 'prospect'>;

/** true hanya bila ctwaClid baru tersimpan (pemicu CAPI LeadSubmitted). */
export async function attachReferralMarker(prospectId: number, marker: ReferralMarker | null, store: ReferralStore = prisma) {
  if (!marker) return false;
  if (!marker.ctwaClid) {
    // Tanpa ID klik: catat asal iklan saja untuk prospek yang belum punya data iklan.
    await store.prospect.updateMany({
      where: { id: prospectId, metaReferralMarker: null, adId: null },
      data: { adId: marker.adId, campaignId: marker.campaignId, adHeadline: marker.headline, adSourceUrl: marker.sourceUrl, leadSource: 'meta_ads' },
    });
    return false;
  }
  const result = await store.prospect.updateMany({
    where: { id: prospectId, metaReferralMarker: null },
    data: {
      metaReferralMarker: marker.ctwaClid,
      adId: marker.adId,
      campaignId: marker.campaignId,
      adHeadline: marker.headline,
      adSourceUrl: marker.sourceUrl,
      leadSource: 'meta_ads',
    },
  });
  return result.count > 0;
}

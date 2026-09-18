import { z } from 'zod';
import { prisma } from '../../db/prisma.js';

const referralSchema = z.object({
  ctwaClid: z.string().trim().min(8).max(500),
  adId: z.string().trim().max(100).optional(),
  campaignId: z.string().trim().max(100).optional(),
  headline: z.string().trim().max(255).optional(),
  sourceUrl: z.string().trim().url().max(2000).optional(),
});

export type ReferralMarker = z.infer<typeof referralSchema>;

export function normalizeReferralMarker(value: unknown): ReferralMarker | null {
  const parsed = referralSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

type ReferralStore = Pick<typeof prisma, 'prospect'>;

export async function attachReferralMarker(prospectId: number, marker: ReferralMarker | null, store: ReferralStore = prisma) {
  if (!marker?.ctwaClid) return false;
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

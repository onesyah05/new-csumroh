import { extractMessageContent, type proto, type WAMessage } from '@whiskeysockets/baileys';

export type MetaReferral = {
  ctwaClid?: string;
  adId?: string;
  headline?: string;
  /** Teks iklan dan gambar kreatif untuk kartu "Ad" di chat CRM, seperti pratinjau di WhatsApp. */
  body?: string;
  thumbnailUrl?: string;
  /** Thumbnail JPEG kecil yang tertanam di pesan; cadangan bila iklan tidak membawa URL gambar. */
  thumbnailBase64?: string;
  sourceUrl?: string;
};

const MAX_THUMBNAIL_BYTES = 200_000;

const clean = (value: string | null | undefined) => value?.trim() || undefined;

export function extractMetaReferral(message: WAMessage): MetaReferral | undefined {
  const body = extractMessageContent(message.message);
  if (!body) return undefined;
  // Klik iklan bisa datang di tipe pesan apa pun (teks, gambar, template, …): cari contextInfo pembawa iklan di semua tipe.
  const contexts = Object.values(body as Record<string, unknown>)
    .map((part) => (part && typeof part === 'object' ? (part as { contextInfo?: proto.IContextInfo | null }).contextInfo : undefined))
    .filter((context): context is proto.IContextInfo => Boolean(context));
  const context = contexts.find((item) => item.externalAdReply) ?? contexts[0];
  const ad = context?.externalAdReply;
  if (!ad) {
    if (context?.conversionSource || context?.ctwaPayload) {
      console.info('[referral] pesan iklan tanpa externalAdReply', { id: message.key?.id, conversionSource: context.conversionSource, keys: Object.keys(context) });
    }
    return undefined;
  }
  if (!ad.ctwaClid) console.info('[referral] externalAdReply tanpa ctwaClid', { id: message.key?.id, keys: Object.keys(ad) });

  const referral: MetaReferral = {
    ctwaClid: clean(ad.ctwaClid),
    adId: clean(ad.sourceId),
    headline: clean(ad.title ?? ad.body),
    body: ad.title ? clean(ad.body) : undefined,
    thumbnailUrl: clean(ad.originalImageUrl ?? ad.thumbnailUrl),
    sourceUrl: clean(ad.sourceUrl),
  };
  const thumbnail = ad.thumbnail;
  // Ikut dikirim walau ada URL: cadangan bila URL gagal diunduh.
  if (thumbnail?.length && thumbnail.length <= MAX_THUMBNAIL_BYTES) {
    referral.thumbnailBase64 = Buffer.from(thumbnail).toString('base64');
  }
  return Object.values(referral).some(Boolean) ? referral : undefined;
}

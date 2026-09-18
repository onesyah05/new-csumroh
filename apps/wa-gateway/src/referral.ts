import { extractMessageContent, type WAMessage } from '@whiskeysockets/baileys';

export type MetaReferral = {
  ctwaClid?: string;
  adId?: string;
  headline?: string;
  sourceUrl?: string;
};

const clean = (value: string | null | undefined) => value?.trim() || undefined;

export function extractMetaReferral(message: WAMessage): MetaReferral | undefined {
  const body = extractMessageContent(message.message);
  if (!body) return undefined;
  const context = body.extendedTextMessage?.contextInfo
    ?? body.imageMessage?.contextInfo
    ?? body.videoMessage?.contextInfo
    ?? body.documentMessage?.contextInfo
    ?? body.buttonsResponseMessage?.contextInfo
    ?? body.listResponseMessage?.contextInfo;
  const ad = context?.externalAdReply;
  if (!ad) return undefined;

  const referral: MetaReferral = {
    ctwaClid: clean(ad.ctwaClid),
    adId: clean(ad.sourceId),
    headline: clean(ad.title ?? ad.body),
    sourceUrl: clean(ad.sourceUrl),
  };
  return Object.values(referral).some(Boolean) ? referral : undefined;
}

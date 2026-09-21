import { getContentType, type WAMessage } from '@whiskeysockets/baileys';
import { extractMetaReferral } from './referral.js';

export type HistoryContact = {
  id?: string;
  lid?: string;
  phoneNumber?: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
};

export type LidPnMapping = {
  lid: string;
  pn: string;
};

export type GatewayMessagePayload = {
  brandId: number;
  messageId: string;
  remoteJid: string;
  phone: string;
  senderName?: string;
  text: string;
  timestamp: number;
  messageType: string;
  isFromMe: boolean;
  referral: ReturnType<typeof extractMetaReferral>;
};

export type GatewayContactPayload = {
  brandId: number;
  remoteJid: string;
  phone: string;
  name?: string;
};

export function normalizePhone(value?: string | null) {
  if (!value || value.endsWith('@lid') || value.endsWith('@g.us')) return '';
  const digits = value.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? '';
  if (!digits || digits === '0') return '';
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

export function addLidMappings(
  target: Map<string, string>,
  mappings: LidPnMapping[] = [],
  contacts: HistoryContact[] = [],
) {
  for (const mapping of mappings) {
    if (mapping.lid && mapping.pn) target.set(mapping.lid, mapping.pn);
  }
  for (const contact of contacts) {
    const lid = contact.lid ?? (contact.id?.endsWith('@lid') ? contact.id : undefined);
    if (lid && contact.phoneNumber) target.set(lid, contact.phoneNumber);
  }
}

export function toGatewayContact(
  brandId: number,
  contact: HistoryContact,
  lidPnMap: Map<string, string>,
): GatewayContactPayload | null {
  if (!contact.id || contact.id === 'status@broadcast' || contact.id.endsWith('@g.us')) return null;
  const remoteJid = contact.lid ?? contact.id;
  const phone = [contact.phoneNumber, contact.id, lidPnMap.get(remoteJid), lidPnMap.get(contact.id)]
    .map(normalizePhone)
    .find(Boolean) ?? '';
  if (!phone) return null;
  const name = [contact.name, contact.notify, contact.verifiedName]
    .map((value) => value?.trim())
    .find(Boolean);
  return { brandId, remoteJid, phone, ...(name ? { name } : {}) };
}

function textFromMessage(message: WAMessage) {
  const body = message.message;
  if (!body) return '';
  if (body.conversation) return body.conversation;
  if (body.extendedTextMessage?.text) return body.extendedTextMessage.text;
  if (body.imageMessage) return body.imageMessage.caption || '[Gambar]';
  if (body.videoMessage) return body.videoMessage.caption || '[Video]';
  if (body.documentMessage) return body.documentMessage.fileName || body.documentMessage.title || '[Dokumen]';
  if (body.audioMessage) return body.audioMessage.ptt ? '[Voice Note]' : '[Audio]';
  if (body.stickerMessage) return '[Stiker]';
  if (body.contactMessage) return body.contactMessage.displayName || '[Kontak]';
  if (body.locationMessage) return '[Lokasi]';
  return '';
}

function timestampFromMessage(message: WAMessage) {
  const timestamp = message.messageTimestamp;
  if (typeof timestamp === 'number') return timestamp;
  if (typeof timestamp === 'bigint') return Number(timestamp);
  if (timestamp && typeof timestamp === 'object' && 'toNumber' in timestamp && typeof timestamp.toNumber === 'function') {
    return timestamp.toNumber();
  }
  return Math.floor(Date.now() / 1000);
}

export function toGatewayMessage(
  brandId: number,
  message: WAMessage,
  lidPnMap: Map<string, string>,
): GatewayMessagePayload | null {
  const remoteJid = message.key.remoteJid;
  const messageId = message.key.id;
  if (!remoteJid || !messageId || remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us')) return null;

  const key = message.key as typeof message.key & {
    senderPn?: string;
    participantPn?: string;
    remoteJidAlt?: string;
    participantAlt?: string;
  };
  const phoneCandidates = [
    remoteJid,
    key.remoteJidAlt,
    key.senderPn,
    key.participantPn,
    key.participantAlt,
    lidPnMap.get(remoteJid),
  ];
  const phone = phoneCandidates.map(normalizePhone).find(Boolean) ?? '';
  if (!phone) return null;

  return {
    brandId,
    messageId,
    remoteJid,
    phone,
    senderName: message.pushName ?? undefined,
    text: textFromMessage(message),
    timestamp: timestampFromMessage(message),
    messageType: getContentType(message.message ?? undefined) ?? 'conversation',
    isFromMe: Boolean(message.key.fromMe),
    referral: extractMetaReferral(message),
  };
}

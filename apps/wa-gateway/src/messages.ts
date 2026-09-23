import { getContentType, isRealMessage, normalizeMessageContent, type WAMessage } from '@whiskeysockets/baileys';
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
  mediaUrl?: string | null;
  isFromMe: boolean;
  status?: string;
  referral: ReturnType<typeof extractMetaReferral>;
};

export type GatewayContactPayload = {
  brandId: number;
  remoteJid: string;
  phone: string;
  name?: string;
};

export function normalizePhone(value?: string | null) {
  if (!value) return '';
  if (
    value.endsWith('@lid') ||
    value.endsWith('@g.us') ||
    value.endsWith('@newsletter') ||
    value.endsWith('@broadcast')
  ) {
    return '';
  }
  const digits = value.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? '';
  // Standard phone numbers must have 8 to 15 digits (E.164 max 15 digits).
  // Channel / newsletter raw IDs are usually 18+ digits and must be rejected.
  if (!digits || digits === '0' || digits.length < 8 || digits.length > 15) return '';
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
  if (
    !contact.id ||
    contact.id === 'status@broadcast' ||
    contact.id === '0@s.whatsapp.net' ||
    contact.id.startsWith('0@') ||
    contact.id.endsWith('@newsletter') ||
    contact.id.endsWith('@broadcast')
  ) {
    return null;
  }
  const remoteJid = contact.lid ?? contact.id;
  if (
    remoteJid === '0@s.whatsapp.net' ||
    remoteJid.startsWith('0@') ||
    remoteJid.endsWith('@newsletter') ||
    remoteJid.endsWith('@broadcast')
  ) {
    return null;
  }

  const isGroup = remoteJid.endsWith('@g.us');
  const phone = isGroup
    ? ''
    : [contact.phoneNumber, contact.id, lidPnMap.get(remoteJid), lidPnMap.get(contact.id)]
        .map(normalizePhone)
        .find(Boolean) ?? '';
  const isGeneric = (str?: string) => !str || /^\+?[\d\s\-\(\)]+$/.test(str.trim());
  const name = [
    contact.name && !isGeneric(contact.name) ? contact.name : undefined,
    contact.notify,
    contact.verifiedName,
    contact.name,
  ]
    .map((value) => value?.trim())
    .find(Boolean);
  if (!phone && !name && !isGroup) return null;
  return { brandId, remoteJid, phone, ...(name ? { name } : isGroup ? { name: 'Grup WhatsApp' } : {}) };
}

function textFromMessage(message: WAMessage) {
  const body = normalizeMessageContent(message.message);
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
  const anyBody = body as any;
  if (anyBody.templateMessage?.hydratedTemplate?.hydratedContentText) {
    return anyBody.templateMessage.hydratedTemplate.hydratedContentText;
  }
  if (anyBody.templateMessage?.hydratedFourRowTemplate?.hydratedContentText) {
    return anyBody.templateMessage.hydratedFourRowTemplate.hydratedContentText;
  }
  if (anyBody.buttonsResponseMessage?.selectedDisplayText) {
    return anyBody.buttonsResponseMessage.selectedDisplayText;
  }
  if (anyBody.interactiveResponseMessage?.body?.text) {
    return anyBody.interactiveResponseMessage.body.text;
  }
  if (anyBody.interactiveMessage?.body?.text) {
    return anyBody.interactiveMessage.body.text;
  }
  if (anyBody.listResponseMessage?.title) {
    return anyBody.listResponseMessage.title;
  }
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
  options?: { isHistory?: boolean; isChatRead?: boolean },
): GatewayMessagePayload | null {
  const remoteJid = message.key.remoteJid;
  const messageId = message.key.id;
  if (
    !remoteJid ||
    !messageId ||
    remoteJid === 'status@broadcast' ||
    remoteJid === '0@s.whatsapp.net' ||
    remoteJid.startsWith('0@') ||
    remoteJid.endsWith('@newsletter') ||
    remoteJid.endsWith('@broadcast')
  ) {
    return null;
  }

  // Filter out system control packets (protocolMessage, reactionMessage, poll updates)
  if (!isRealMessage(message)) return null;

  const content = normalizeMessageContent(message.message);
  if (!content) return null;

  const messageType = getContentType(content) ?? 'conversation';
  if (messageType === 'protocolMessage' || messageType === 'reactionMessage') return null;

  const isFromMe = Boolean(message.key.fromMe);
  const isGroup = remoteJid.endsWith('@g.us');
  const key = message.key as typeof message.key & {
    senderPn?: string;
    participant?: string;
    participantPn?: string;
    remoteJidAlt?: string;
    participantAlt?: string;
  };

  // For group messages, participant is the sender. For 1-on-1, remoteJid is the other party.
  const phoneCandidates = isGroup
    ? [key.participantPn, key.participant, key.participantAlt, isFromMe ? '' : key.senderPn]
    : [
        remoteJid,
        key.remoteJidAlt,
        ...(isFromMe ? [] : [key.senderPn, key.participantPn, key.participantAlt]),
        lidPnMap.get(remoteJid),
      ];
  const phone = phoneCandidates.map(normalizePhone).find(Boolean) ?? '';

  let status = options?.isHistory && options.isChatRead !== false ? 'read' : 'delivered';
  const rawStatus = (message as any).status;
  if (rawStatus === 4 || rawStatus === 5 || rawStatus === 'READ' || rawStatus === 'PLAYED') {
    status = 'read';
  } else if (rawStatus === 3 || rawStatus === 'DELIVERY_ACK') {
    status = 'delivered';
  } else if (rawStatus === 2 || rawStatus === 'SERVER_ACK') {
    status = 'sent';
  } else if (rawStatus === 1 || rawStatus === 'PENDING') {
    status = 'pending';
  }

  return {
    brandId,
    messageId,
    remoteJid,
    phone,
    senderName: message.pushName ?? undefined,
    text: textFromMessage(message),
    timestamp: timestampFromMessage(message),
    messageType,
    isFromMe,
    status,
    referral: extractMetaReferral(message),
  };
}

import { prisma } from '../../db/prisma.js';
import { activeDevicePhone } from './device-scope.js';

export const MESSAGE_SEARCH_MIN_LENGTH = 2;
const MESSAGE_SEARCH_SCAN_LIMIT = 3000;
const SNIPPET_BEFORE = 30;
const SNIPPET_LENGTH = 110;

export interface MessageSearchMatch {
  prospectId: number;
  messageId: string;
  isFromMe: boolean;
  timestamp: number;
  snippet: string;
  count: number;
}

/** Potongan teks di sekitar kata yang cocok, supaya CS tahu alasan percakapan muncul. */
export function messageSnippet(text: string, term: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(term.toLowerCase());
  if (at <= SNIPPET_BEFORE) return flat.length > SNIPPET_LENGTH ? `${flat.slice(0, SNIPPET_LENGTH)}…` : flat;
  const start = at - SNIPPET_BEFORE;
  const body = flat.slice(start, start + SNIPPET_LENGTH);
  return `…${body}${start + SNIPPET_LENGTH < flat.length ? '…' : ''}`;
}

/**
 * Cari kata di seluruh riwayat chat brand (pesan jamaah dan PIC) pada device aktif. Satu hasil per prospek: pesan
 * cocok terbaru beserta jumlah pesan yang cocok. Pesan terhapus tidak dicari.
 */
export async function searchConversationMessages(brandId: number, rawTerm: string): Promise<MessageSearchMatch[]> {
  const term = rawTerm.trim();
  if (term.length < MESSAGE_SEARCH_MIN_LENGTH) return [];
  const devicePhone = await activeDevicePhone(brandId);
  if (!devicePhone) return [];

  const rows = await prisma.chatMessage.findMany({
    where: { brandId, devicePhone, isDeleted: false, prospectId: { not: null }, messageText: { contains: term } },
    select: { prospectId: true, messageId: true, isFromMe: true, timestamp: true, messageText: true },
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: MESSAGE_SEARCH_SCAN_LIMIT,
  });

  const byProspect = new Map<number, MessageSearchMatch>();
  for (const row of rows) {
    const found = byProspect.get(row.prospectId!);
    if (found) {
      found.count += 1;
      continue;
    }
    byProspect.set(row.prospectId!, {
      prospectId: row.prospectId!,
      messageId: row.messageId,
      isFromMe: row.isFromMe,
      timestamp: row.timestamp,
      snippet: messageSnippet(row.messageText ?? '', term),
      count: 1,
    });
  }
  return [...byProspect.values()];
}

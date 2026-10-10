import { dateOnlyKey, isLostStatus, isWonStatus, parseTargetMonth, targetMonthLabel } from '@csumroh/shared-types';

export type ConversationTagTone = 'urgent' | 'warn' | 'ok' | 'info' | 'muted';
export interface ConversationTag { key: string; label: string; tone: ConversationTagTone; title?: string }

export interface TaggableConversation {
  isGroup?: boolean;
  isOwn?: boolean;
  remoteJid?: string | null;
  userId?: number | null;
  status?: string;
  paymentStatus?: string | null;
  paymentProofUrl?: string | null;
  nextFollowupDate?: string | null;
  spamAt?: string | null;
  targetMonth?: string | null;
  package?: { name?: string | null } | null;
}

const STAGE_LABEL: Record<string, string> = {
  new: 'Baru',
  contact: 'Terhubung', identifying: 'Terhubung',
  qualified: 'Kualifikasi',
  offer: 'Penawaran', offered: 'Penawaran',
  objection: 'Keberatan',
  followup: 'Follow-up', nurture: 'Nurture',
  closing: 'Verifikasi',
};

export const MAX_CONVERSATION_TAGS = 3;

/**
 * Tag kondisi lead di baris daftar percakapan, terurut dari yang paling perlu ditindak.
 * Grup, chat sendiri, dan kontak sistem tidak punya kondisi lead.
 */
export function conversationTags(
  item: TaggableConversation,
  today: string,
  custom?: { text: string; urgent: boolean } | null,
): ConversationTag[] {
  if (item.isGroup || item.isOwn || item.remoteJid?.endsWith('@g.us') || item.remoteJid === '0@s.whatsapp.net') return [];
  if (item.spamAt) return [{ key: 'spam', label: 'Spam', tone: 'urgent' }];

  const won = isWonStatus(item.status);
  const lost = isLostStatus(item.status);
  const proofPending = !won && !lost && item.status === 'closing' && Boolean(item.paymentProofUrl);
  const tags: ConversationTag[] = [];

  if (proofPending) {
    tags.push({ key: 'proof', label: 'Verifikasi', tone: 'warn', title: 'Bukti transfer menunggu Finance' });
  }
  const due = dateOnlyKey(item.nextFollowupDate);
  if (!lost && due) {
    if (due < today) tags.push({ key: 'followup', label: 'Telat', tone: 'urgent', title: 'Follow-up terlambat' });
    else if (due === today) tags.push({ key: 'followup', label: 'Hari ini', tone: 'warn', title: 'Follow-up hari ini' });
  }
  if (!won && !lost && !item.userId) tags.push({ key: 'nopic', label: 'Tanpa PIC', tone: 'warn' });

  if (won) {
    tags.push({ key: 'stage', label: item.paymentStatus === 'paid_full' ? 'Lunas' : item.paymentStatus === 'partial_dp' ? 'DP' : 'Deal', tone: 'ok' });
  } else if (lost) {
    tags.push({ key: 'stage', label: 'Batal', tone: 'muted' });
  } else if (item.status && STAGE_LABEL[item.status] && !proofPending) {
    tags.push({ key: 'stage', label: STAGE_LABEL[item.status]!, tone: item.status === 'new' ? 'muted' : 'info' });
  }

  if (custom) tags.push({ key: 'custom', label: 'Custom', tone: custom.urgent ? 'warn' : 'info', title: custom.text });

  return tags.slice(0, MAX_CONVERSATION_TAGS);
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * Tujuan lead: nama paket terpilih, atau bulan berangkat dari kualifikasi bila paket belum dipilih.
 * Label dipendekkan; teks lengkap ada di title.
 */
export function conversationTrip(item: TaggableConversation): { label: string; title: string } | null {
  if (item.isGroup || item.isOwn || item.remoteJid?.endsWith('@g.us') || item.remoteJid === '0@s.whatsapp.net') return null;
  const name = item.package?.name?.trim();
  if (name) return { label: name.replace(/^(paket\s+)?umroh\s+/i, ''), title: name };
  const parsed = parseTargetMonth(item.targetMonth);
  if (parsed.key) {
    const [year, month] = parsed.key.split('-').map(Number);
    return { label: `${SHORT_MONTHS[(month ?? 1) - 1]} ${year}`, title: `Target berangkat ${targetMonthLabel(item.targetMonth)}` };
  }
  if (parsed.legacy) return { label: parsed.legacy, title: `Target berangkat ${parsed.legacy}` };
  return null;
}

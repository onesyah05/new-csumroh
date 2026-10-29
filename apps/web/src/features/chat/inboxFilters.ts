import { canonicalStatus, dateOnlyKey, isLostStatus, isWonStatus, pipelineStatuses, PROSPECT_STATUS_LABELS } from '@csumroh/shared-types';

export type InboxStageFilter = `stage:${(typeof pipelineStatuses)[number]}`;
export type InboxWorkFilter = 'all' | 'needs_reply' | 'followup' | InboxStageFilter;

export const inboxWorkFilters = [
  { id: 'all', label: 'Semua', description: 'Semua percakapan sesuai pencarian dan PIC yang dipilih.' },
  { id: 'needs_reply', label: 'Perlu dibalas', description: 'Pesan terakhir dari jamaah, termasuk pesan yang sudah dibaca.' },
  { id: 'followup', label: 'Follow-up', description: 'Jadwal hari ini dan yang terlambat; urutan paling lama terlebih dahulu.' },
] as const;

/** Satu filter per tahap pipeline (status lama dipetakan ke tahap kanonik). Hanya yang punya prospek yang ditampilkan. */
export const inboxStageFilters = pipelineStatuses.map((status) => {
  const label = PROSPECT_STATUS_LABELS[status] ?? status;
  return { id: `stage:${status}` as InboxStageFilter, label, description: `Jamaah di tahap ${label}.` };
});

export const inboxFilters: ReadonlyArray<{ id: InboxWorkFilter; label: string; description: string }> = [...inboxWorkFilters, ...inboxStageFilters];

/** Antrean kerja selalu tampil; filter tahap hanya bila ada prospeknya, atau sedang dipilih (agar pilihan tetap terlihat). */
export function visibleInboxFilters(counts: Record<string, number>, active: InboxWorkFilter) {
  const isWork = (id: string) => inboxWorkFilters.some((filter) => filter.id === id);
  return inboxFilters.filter((filter) => isWork(filter.id) || (counts[filter.id] ?? 0) > 0 || filter.id === active);
}

export interface InboxConversation {
  id: number;
  name?: string | null;
  phone?: string | null;
  remoteJid?: string | null;
  /** Id semua prospek yang digabung dalam satu percakapan. */
  duplicateIds?: number[];
  isGroup?: boolean;
  isOwn?: boolean;
  userId?: number | null;
  status?: string;
  spamAt?: string | null;
  nextFollowupDate?: string | null;
  messages?: Array<{ isFromMe?: boolean; messageText?: string | null; timestamp?: number }>;
}

function isJamaahConversation(item: InboxConversation) {
  return !item.isGroup && !item.remoteJid?.endsWith('@g.us') && !item.isOwn && item.remoteJid !== '0@s.whatsapp.net';
}

function matchesWork(item: InboxConversation, work: InboxWorkFilter, today: string) {
  if (work === 'all') return true;
  // Chat spam tetap terlihat di Semua, tetapi tidak masuk antrean kerja.
  if (!isJamaahConversation(item) || item.spamAt) return false;
  if (work === 'needs_reply') return item.messages?.[0]?.isFromMe === false;
  if (work.startsWith('stage:')) return canonicalStatus(item.status ?? '') === work.slice('stage:'.length);
  if (work === 'followup') {
    const due = dateOnlyKey(item.nextFollowupDate);
    // Scheduled post-booking follow-ups remain actionable, even after Deal.
    return due !== null && due <= today;
  }
  return false;
}

/** Nilai filter dari sesi lama atau sumber luar bisa tidak dikenal: diperlakukan sebagai "Semua". */
const isKnownFilter = (id: string): id is InboxWorkFilter => inboxFilters.some((filter) => filter.id === id);

/**
 * Kata kunci yang berbentuk nomor telepon (08xx, +62 8xx-xxx, 62 8xx) → digit saja berawalan 62; selain itu null.
 * Nomor di daftar disimpan sebagai 62xxx, jadi "0812…" harus dipetakan ke "62812…" agar ketemu.
 */
export function phoneSearchDigits(search: string) {
  const trimmed = search.trim();
  if (!/^[\d\s+\-().]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 3) return null;
  return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
}

function matchesSearch(item: InboxConversation, term: string, phoneDigits: string | null, messageMatches?: ReadonlySet<number>) {
  if (messageMatches?.size && (item.duplicateIds ?? [item.id]).some((id) => messageMatches.has(id))) return true;
  if (`${item.name ?? ''} ${item.phone ?? ''} ${item.messages?.[0]?.messageText ?? ''}`.toLowerCase().includes(term)) return true;
  return phoneDigits !== null && (item.phone ?? '').replace(/\D/g, '').includes(phoneDigits);
}

export function getInboxQueue<T extends InboxConversation>(items: T[], options: {
  work: InboxWorkFilter;
  owner: string;
  userId?: number;
  search: string;
  today: string;
  /** Id prospek yang punya pesan berisi kata kunci (hasil pencarian riwayat chat di server). */
  messageMatches?: ReadonlySet<number>;
}) {
  const { owner, userId, today, messageMatches } = options;
  const work: InboxWorkFilter = isKnownFilter(options.work) ? options.work : 'all';
  const search = options.search.trim().toLowerCase();
  const phoneDigits = phoneSearchDigits(search);
  const scoped = items.filter((item) => {
    if (search && !matchesSearch(item, search, phoneDigits, messageMatches)) return false;
    if (owner === 'all') return true;
    if (!isJamaahConversation(item)) return false;
    if (owner === 'mine') return userId !== undefined && item.userId === userId;
    if (owner === 'unassigned') return !item.userId && !item.spamAt && !isWonStatus(item.status) && !isLostStatus(item.status);
    return /^user:\d+$/.test(owner) && item.userId === Number(owner.slice(5));
  });
  const counts: Record<string, number> = {
    all: scoped.length,
    needs_reply: scoped.filter((item) => matchesWork(item, 'needs_reply', today)).length,
    followup: scoped.filter((item) => matchesWork(item, 'followup', today)).length,
  };
  for (const filter of inboxStageFilters) counts[filter.id] = scoped.filter((item) => matchesWork(item, filter.id, today)).length;
  const conversations = scoped.filter((item) => matchesWork(item, work, today));
  if (work === 'followup') {
    conversations.sort((a, b) => dateOnlyKey(a.nextFollowupDate)!.localeCompare(dateOnlyKey(b.nextFollowupDate)!));
  }
  return { conversations, counts };
}

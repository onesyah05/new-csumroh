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
  const due = dateOnlyKey(item.nextFollowupDate);
  // Scheduled post-booking follow-ups remain actionable, even after Deal.
  return due !== null && due <= today;
}

export function getInboxQueue<T extends InboxConversation>(items: T[], options: {
  work: InboxWorkFilter;
  owner: string;
  userId?: number;
  search: string;
  today: string;
}) {
  const { work, owner, userId, today } = options;
  const search = options.search.trim().toLowerCase();
  const scoped = items.filter((item) => {
    if (search && !`${item.name ?? ''} ${item.phone ?? ''} ${item.messages?.[0]?.messageText ?? ''}`.toLowerCase().includes(search)) return false;
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

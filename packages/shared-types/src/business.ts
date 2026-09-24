import type { ProspectStatus } from './contracts.js';

export const wonStatuses = ['deal', 'closed_won'] as const;
export const lostStatuses = ['lose', 'closed_lost'] as const;

export function isWonStatus(status?: string | null) {
  return status === 'deal' || status === 'closed_won';
}

export function isLostStatus(status?: string | null) {
  return status === 'lose' || status === 'closed_lost';
}

const legacyToCanonical: Record<string, ProspectStatus> = {
  identifying: 'contact',
  offered: 'offer',
  closed_won: 'deal',
  closed_lost: 'lose',
  nurture: 'followup',
};

/** Status lama (sebelum pipeline 9 tahap) dipetakan ke kolom kanonik agar tidak hilang dari Kanban. */
export function canonicalStatus(status: string): ProspectStatus {
  return legacyToCanonical[status] ?? (status as ProspectStatus);
}

export function canTransitionStatus(from: ProspectStatus, to: ProspectStatus) {
  // Pipeline is an operational board: agents may correct, skip, or move a
  // prospect backwards when the real conversation changes direction —
  // except a booking that Finance already verified. A Deal can only be
  // cancelled (lose), which releases its seats; it never falls back to offer/closing.
  if (from === to) return true;
  if (isWonStatus(from)) return isLostStatus(to);
  return true;
}

/** Seat paket yang dipakai satu booking (infant tidak memakai seat). */
export function seatCountFor(pax: { paxQuad?: number | null; paxTriple?: number | null; paxDouble?: number | null }) {
  const seats = Math.max(0, pax.paxQuad ?? 0) + Math.max(0, pax.paxTriple ?? 0) + Math.max(0, pax.paxDouble ?? 0);
  return seats > 0 ? seats : 1;
}

/** Harga paket disimpan sebagai teks ("Rp 30.000.000"); ambil digitnya saja. */
export function parseRupiah(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

export const BUSINESS_TIME_ZONE = 'Asia/Jakarta';

/** Tanggal bisnis (YYYY-MM-DD) di zona WIB untuk suatu instant. */
export function businessDateKey(at: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/**
 * Kunci YYYY-MM-DD untuk kolom DATE (mis. nextFollowupDate). Prisma mengembalikan
 * kolom DATE sebagai Date pada UTC midnight, jadi tanggalnya dibaca dari komponen UTC;
 * string ISO/YYYY-MM-DD dibaca apa adanya.
 */
export function dateOnlyKey(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

export type RoomPrices = { quad?: number; triple?: number; double?: number; infant?: number };
export type PaxCounts = { quad?: number; triple?: number; double?: number; infant?: number };

/**
 * Nilai booking resmi dari katalog: harga per tipe kamar × pax. Tipe kamar tanpa harga
 * khusus memakai harga dasar paket; infant hanya dihitung bila harga infant ditetapkan.
 */
export function packageBookingValue(
  pkg: { price?: unknown; priceQuad?: unknown; priceTriple?: unknown; priceDouble?: unknown; priceInfant?: unknown },
  pax: { paxQuad?: number | null; paxTriple?: number | null; paxDouble?: number | null; paxInfant?: number | null },
) {
  const base = parseRupiah(pkg.price);
  return calculateDealValue(
    {
      quad: parseRupiah(pkg.priceQuad) || base,
      triple: parseRupiah(pkg.priceTriple) || base,
      double: parseRupiah(pkg.priceDouble) || base,
      infant: parseRupiah(pkg.priceInfant),
    },
    { quad: pax.paxQuad ?? 0, triple: pax.paxTriple ?? 0, double: pax.paxDouble ?? 0, infant: pax.paxInfant ?? 0 },
  );
}

export function calculateDealValue(prices: RoomPrices, pax: PaxCounts) {
  return (['quad', 'triple', 'double', 'infant'] as const).reduce((total, room) => {
    const price = Math.max(0, prices[room] ?? 0);
    const count = Math.max(0, Math.trunc(pax[room] ?? 0));
    return total + price * count;
  }, 0);
}

/** Label singkat kategori keberatan untuk tampilan (lencana, tabel). Kode tersimpan tetap enum `objectionInputSchema`. */
export const objectionCategoryLabels: Record<string, string> = {
  price: 'Harga',
  competitor: 'Bandingkan travel lain',
  schedule_leave: 'Jadwal / cuti',
  passport: 'Paspor',
  family_decision: 'Keputusan keluarga',
  facility_distance: 'Fasilitas / jarak hotel',
  other: 'Keberatan lain',
};

/** Label keberatan yang aman ditampilkan: kode dikenal → label; teks bebas lama → apa adanya; kosong → "Keberatan". */
export function objectionLabel(category?: string | null) {
  if (!category) return 'Keberatan';
  return objectionCategoryLabels[category] ?? category;
}

/**
 * Foto profil WhatsApp disalin ke server sebagai `/uploads/avatars/p<prospectId>-<epochMs>-<acak>.<ext>`.
 * URL CDN WhatsApp bertanda tangan dan kedaluwarsa, jadi tidak disimpan/ditampilkan langsung.
 */
export const AVATAR_URL_PATTERN = /^\/uploads\/avatars\/p(\d+)-(\d+)-[a-f0-9]+\.(?:jpg|png|webp)$/;
export const AVATAR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** True bila foto belum disalin ke server, berasal dari URL eksternal lama, atau sudah lebih dari 7 hari. */
export function avatarNeedsRefresh(photoUrl: string | null | undefined, now = Date.now()) {
  const match = photoUrl ? AVATAR_URL_PATTERN.exec(photoUrl) : null;
  if (!match) return true;
  return now - Number(match[2]) > AVATAR_MAX_AGE_MS;
}

/**
 * Aturan ambil alih PIC: CS lain boleh mengambil prospek bila jamaah sudah menunggu balasan lebih dari
 * 15 menit. Waktu tunggu dihitung dari pesan jamaah pertama yang belum dibalas (detik Unix, seperti
 * `ChatMessage.timestamp`), sehingga pesan beruntun dari jamaah tidak mengulang hitungan.
 */
export const PIC_TAKEOVER_AFTER_MINUTES = 15;

/** Waktu (ms) prospek mulai boleh diambil alih; null bila jamaah tidak sedang menunggu balasan. */
export function takeoverOpensAt(awaitingSince: number | null | undefined) {
  return awaitingSince ? awaitingSince * 1000 + PIC_TAKEOVER_AFTER_MINUTES * 60_000 : null;
}

export function isTakeoverOpen(awaitingSince: number | null | undefined, now = Date.now()) {
  const opensAt = takeoverOpensAt(awaitingSince);
  return opensAt !== null && now >= opensAt;
}

/** Pesan jamaah pertama setelah balasan CS terakhir; `messages` boleh dalam urutan apa pun. */
export function firstUnansweredAt(messages: Array<{ timestamp: number; isFromMe: boolean }>) {
  let lastReply = 0;
  for (const m of messages) if (m.isFromMe && m.timestamp > lastReply) lastReply = m.timestamp;
  let first: number | null = null;
  for (const m of messages) {
    if (!m.isFromMe && m.timestamp > lastReply && (first === null || m.timestamp < first)) first = m.timestamp;
  }
  return first;
}

export const tgjpSteps = ['terima', 'gali', 'jawab', 'pastikan'] as const;
export type TgjpStep = (typeof tgjpSteps)[number];

export function nextTgjpStep(current: TgjpStep): TgjpStep | null {
  const index = tgjpSteps.indexOf(current);
  return tgjpSteps[index + 1] ?? null;
}

export const capiEventForStatus = (status: ProspectStatus) =>
  ({
    new: 'Contact',
    contact: 'Contact',
    offer: 'AddToCart',
    offered: 'AddToCart',
    closing: 'InitiateCheckout',
    deal: 'Purchase',
    closed_won: 'Purchase',
  })[
    status as 'new' | 'contact' | 'offer' | 'offered' | 'closing' | 'deal' | 'closed_won'
  ] ?? null;

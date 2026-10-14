/** Batas media masuk yang diunduh ke server: file lebih besar diteruskan sebagai pesan tanpa media. */
export const MAX_INBOUND_MEDIA_BYTES = 64 * 1024 * 1024;

type LongLike = { toNumber?: () => number; low?: number; high?: number; unsigned?: boolean };

/**
 * Ukuran berkas yang dinyatakan pengirim di pesan (`fileLength`, bisa number, string, atau Long dari protobuf).
 * null bila tidak dinyatakan: batas tetap dicek lagi pada hasil unduhan.
 */
export function declaredMediaBytes(content: unknown, messageType: string): number | null {
  const node = (content as Record<string, { fileLength?: unknown } | undefined> | null | undefined)?.[messageType];
  const raw = node?.fileLength;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  const long = raw as LongLike;
  if (typeof long.toNumber === 'function') {
    const value = long.toNumber();
    return Number.isFinite(value) ? value : null;
  }
  if (typeof long.low === 'number' && typeof long.high === 'number') return (long.high >>> 0) * 2 ** 32 + (long.low >>> 0);
  return null;
}

export const exceedsMediaLimit = (bytes: number | null, limit = MAX_INBOUND_MEDIA_BYTES) => bytes !== null && bytes > limit;

/**
 * Balas cepat: template pesan yang dipilih CS dengan mengetik "/" di kolom pesan. Dua cakupan: untuk seluruh brand
 * (dibuat/diubah siapa saja yang punya akses brand) dan pribadi (hanya pemiliknya).
 */
export const QUICK_REPLY_ROLES = ['superadmin', 'admin', 'cs', 'finance'] as const;
export const canUseQuickReplies = (role?: string | null) => (QUICK_REPLY_ROLES as readonly string[]).includes(role ?? '');

export const QUICK_REPLY_SCOPES = ['brand', 'personal'] as const;
export type QuickReplyScope = (typeof QUICK_REPLY_SCOPES)[number];

export const QUICK_REPLY_TITLE_MAX = 80;
export const QUICK_REPLY_SHORTCUT_MAX = 30;
export const QUICK_REPLY_BODY_MAX = 2000;

/** Token yang ditawarkan di editor (urut sesuai pemakaian umum); semua mengikuti sintaks {{token}}. */
export const QUICK_REPLY_SUGGESTED_TOKENS = [
  'nama', 'cs_name', 'travel', 'paket', 'tanggal_keberangkatan', 'harga_mulai', 'bulan_target', 'rekening', 'nama_rekening',
] as const;

const TOKEN_PATTERN = /\{\{([a-z0-9_]+)\}\}/gi;

/** Isi token {{x}} dari `values`; token yang datanya kosong dibiarkan apa adanya dan dikembalikan di `missing`. */
export function fillQuickReply(body: string, values: Record<string, string | null | undefined>) {
  const missing: string[] = [];
  const text = body.replace(TOKEN_PATTERN, (match, key: string) => {
    const value = values[key.toLowerCase()];
    if (value === undefined || value === null || value === '') {
      if (!missing.includes(key.toLowerCase())) missing.push(key.toLowerCase());
      return match;
    }
    return String(value);
  });
  return { text, missing };
}

/** Nama panggilan: kata pertama dari nama kontak, bila berupa nama (bukan nomor telepon). */
export function firstNameOf(name?: string | null) {
  const trimmed = (name ?? '').trim();
  if (!trimmed || /^[+\d\s()-]+$/.test(trimmed)) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

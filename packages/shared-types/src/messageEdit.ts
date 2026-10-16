/** WhatsApp hanya menerima edit pesan teks dalam ±15 menit sejak terkirim. */
export const EDIT_WINDOW_SECONDS = 15 * 60;
/** Batas panjang teks, sama dengan kirim pesan biasa. */
export const EDIT_MAX_LENGTH = 4000;

/** Jenis pesan teks (pesan baru dari CRM bertipe conversation; dari HP bisa extendedTextMessage). */
const EDITABLE_TYPES = new Set(['conversation', 'extendedTextMessage']);

export type EditBlock = 'not_mine' | 'deleted' | 'not_text' | 'not_in_whatsapp' | 'expired';

export const EDIT_BLOCK_TEXT: Record<EditBlock, string> = {
  not_mine: 'Hanya pesan yang Anda kirim yang dapat diedit.',
  deleted: 'Pesan yang sudah dihapus tidak dapat diedit.',
  not_text: 'Hanya pesan teks yang dapat diedit (bukan foto, video, atau dokumen).',
  not_in_whatsapp: 'Pesan ini tidak tercatat di WhatsApp sehingga tidak bisa diedit.',
  expired: 'Lewat 15 menit: pesan tidak bisa lagi diedit di WhatsApp.',
};

/** Kode HTTP penolakan tiap alasan (satu tabel untuk API; teksnya di EDIT_BLOCK_TEXT). */
export const EDIT_BLOCK_STATUS: Record<EditBlock, number> = {
  not_mine: 400,
  not_text: 400,
  deleted: 409,
  not_in_whatsapp: 422,
  expired: 422,
};

/**
 * Siapa yang boleh mengedit: sama dengan hapus untuk semua, yaitu Admin/Superadmin atau PIC percakapan itu.
 * Dipakai server (penolakan 403) dan menu di layar, supaya keduanya tidak menyimpang.
 */
export function isEditAuthor(input: { role: string; userId: number | null | undefined; picUserId: number | null | undefined }) {
  if (input.role === 'superadmin' || input.role === 'admin') return true;
  return input.userId != null && input.picUserId != null && input.userId === input.picUserId;
}

/** Bentuk pesan yang dibutuhkan aturan edit (cukup sebagian dari baris chat). */
export type EditableMessage = {
  id: number;
  isFromMe: boolean;
  isDeleted?: boolean | null;
  messageType?: string | null;
  messageId: string;
  messageText?: string | null;
  timestamp: number;
};

/**
 * Keadaan item "Edit" di menu pesan. Tidak tampil untuk pesan jamaah, pesan terhapus, atau bukan teks. Pesan teks milik
 * kita selalu tampil; bila belum bisa diedit (lewat 15 menit, tidak tercatat di WhatsApp, bukan Admin/PIC) item nonaktif
 * dan alasannya disebut. `label` singkat untuk menu, `reason` lengkap untuk tooltip.
 */
export function editMenuState(
  message: EditableMessage,
  context: { canEdit: boolean; picName?: string | null },
  nowSeconds = Date.now() / 1000,
): { visible: false } | { visible: true; enabled: boolean; label: string | null; reason: string | null } {
  const block = messageEditBlock(message, nowSeconds);
  if (block === 'not_mine' || block === 'deleted' || block === 'not_text') return { visible: false };
  const reasons = [
    context.canEdit ? null : `Hanya Admin dan PIC (${context.picName || 'CS lain'}) yang dapat mengedit.`,
    block ? EDIT_BLOCK_TEXT[block] : null,
  ].filter((reason): reason is string => Boolean(reason));
  if (!reasons.length) return { visible: true, enabled: true, label: null, reason: null };
  const label = !context.canEdit ? 'Hanya Admin/PIC' : block === 'expired' ? 'Lewat 15 menit' : 'Tidak tercatat di WhatsApp';
  return { visible: true, enabled: false, label, reason: reasons.join(' ') };
}

/** Alasan sebuah pesan tidak bisa diedit, atau null bila boleh. Urutan = prioritas penjelasan ke pengguna. */
export function messageEditBlock(
  message: { isFromMe: boolean; isDeleted?: boolean | null; messageType?: string | null; messageId: string; timestamp: number },
  nowSeconds = Date.now() / 1000,
): EditBlock | null {
  if (!message.isFromMe) return 'not_mine';
  if (message.isDeleted) return 'deleted';
  if (!EDITABLE_TYPES.has(message.messageType ?? 'conversation')) return 'not_text';
  if (message.messageId.startsWith('local-') || message.messageId.startsWith('call-')) return 'not_in_whatsapp';
  if (nowSeconds - message.timestamp > EDIT_WINDOW_SECONDS) return 'expired';
  return null;
}

export type EditTextProblem = 'empty' | 'too_long' | 'unchanged';

export const EDIT_TEXT_PROBLEM_TEXT: Record<EditTextProblem, string> = {
  empty: 'Isi pesan tidak boleh kosong.',
  too_long: 'Pesan maksimal ' + EDIT_MAX_LENGTH + ' karakter.',
  unchanged: 'Isi pesan belum diubah.',
};

/** Kode HTTP penolakan tiap masalah teks. */
export const EDIT_TEXT_PROBLEM_STATUS: Record<EditTextProblem, number> = {
  empty: 400,
  too_long: 400,
  unchanged: 409,
};

/** Masalah pada teks baru (setelah trim), atau null bila boleh disimpan. */
export function editTextProblem(next: string, current: string | null | undefined): EditTextProblem | null {
  const text = next.trim();
  if (!text) return 'empty';
  if (text.length > EDIT_MAX_LENGTH) return 'too_long';
  if (text === (current ?? '').trim()) return 'unchanged';
  return null;
}

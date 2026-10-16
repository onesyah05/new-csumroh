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

/** Masalah pada teks baru (setelah trim), atau null bila boleh disimpan. */
export function editTextProblem(next: string, current: string | null | undefined): EditTextProblem | null {
  const text = next.trim();
  if (!text) return 'empty';
  if (text.length > EDIT_MAX_LENGTH) return 'too_long';
  if (text === (current ?? '').trim()) return 'unchanged';
  return null;
}

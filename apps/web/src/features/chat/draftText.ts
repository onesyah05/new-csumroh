/**
 * Serahkan naskah draft ke CS: disisipkan ke composer chat bila tersedia (Inbox),
 * atau disalin ke clipboard bila modal dibuka dari halaman tanpa composer (Pipeline).
 * Mengembalikan keterangan singkat untuk toast.
 */
export async function deliverDraftText(text: string, onInsertText?: (text: string) => void) {
  if (!text) return 'disimpan';
  if (onInsertText) {
    onInsertText(text);
    return 'disisipkan ke kolom chat';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'disalin ke clipboard';
  } catch {
    return 'disimpan (clipboard tidak tersedia, salin dari pratinjau)';
  }
}

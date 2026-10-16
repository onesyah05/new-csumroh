import { useEffect, useRef, useState, type RefObject } from 'react';
import { useMutation } from '@tanstack/react-query';
import { EDIT_TEXT_PROBLEM_TEXT, editTextProblem, type EditableMessage, type EditTextProblem } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { writeDraftNow } from './profileDraft';

export const EDIT_BLOCKED_TOAST = 'Selesaikan atau batalkan edit pesan dulu.';

export type EditingState = {
  chatId: number;
  /** Id baris chat_messages yang diedit. */
  id: number;
  /** Teks sebelum diedit. */
  original: string;
  /** Draf yang ada di kotak ketik sebelum edit dimulai, dan kuncinya di sessionStorage. */
  draftBefore: string;
  draftKey: string;
  /** Mengembalikan draf semula ke chat ASALNYA (setMessage terikat ke chat saat edit dimulai). */
  restoreDraft: () => void;
};

export type EditHint = { tone: 'neutral' | 'error'; text: string };

/**
 * Mode edit pesan terkirim di kotak ketik (seperti WhatsApp Web): teks lama masuk ke kotak ketik, Enter menyimpan,
 * Esc membatalkan. Draf semula dikembalikan setelah simpan/batal, ke chat asalnya walau CS sempat pindah chat, dan ditulis
 * kembali ke penyimpanan bila halaman ditutup di tengah edit (supaya teks pesan lama tidak tertinggal sebagai draf).
 */
export function useMessageEdit(options: {
  selectedId: number | null;
  message: string;
  setMessage: (value: string | ((previous: string) => string)) => void;
  /** Identitas draf chat yang sedang terbuka (kunci sessionStorage). */
  draftIdentity: string;
  /** Query brand untuk API (mis. ?brandId=1). */
  query: string;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  adjustHeight: (element: HTMLTextAreaElement | null) => void;
  /** Ada lampiran/galeri/kompresi yang belum selesai: edit tidak boleh dimulai. */
  hasPendingAttachment: boolean;
  clearReply: () => void;
  showToast: (message: string) => void;
  /** Teks yang masih memuat tanda {{…}} tidak boleh tersimpan. */
  hasUnresolvedTokens: (text: string) => boolean;
}) {
  const { selectedId, message, setMessage, draftIdentity, query, composerRef, adjustHeight, hasPendingAttachment, clearReply, showToast, hasUnresolvedTokens } = options;
  const [editing, setEditing] = useState<EditingState | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  // Pindah chat di tengah edit: batalkan dan kembalikan draf ke chat asalnya.
  useEffect(() => {
    const active = editingRef.current;
    if (active && active.chatId !== selectedId) {
      active.restoreDraft();
      setEditing(null);
    }
  }, [selectedId]);

  // Halaman ditutup/dimuat ulang di tengah edit: draf yang tersimpan harus draf semula, bukan teks pesan yang diedit.
  useEffect(() => {
    if (!editing) return;
    const restore = () => writeDraftNow(editing.draftKey, editing.draftBefore);
    window.addEventListener('pagehide', restore);
    return () => window.removeEventListener('pagehide', restore);
  }, [editing]);

  const problem: EditTextProblem | null = editing ? editTextProblem(message, editing.original) : null;
  // "Belum diubah" adalah keadaan awal yang wajar (bukan kesalahan); selebihnya ditampilkan sebagai kesalahan.
  const hint: EditHint | null = !editing || !problem
    ? null
    : problem === 'unchanged'
      ? { tone: 'neutral', text: 'Ubah teks lalu tekan Enter untuk menyimpan.' }
      : { tone: 'error', text: EDIT_TEXT_PROBLEM_TEXT[problem] };

  function finish() {
    editingRef.current?.restoreDraft();
    setEditing(null);
    requestAnimationFrame(() => adjustHeight(composerRef.current));
  }

  const mutation = useMutation({
    mutationFn: (vars: { id: number; text: string }) => api.patch(`/chat/messages/${vars.id}${query}`, { text: vars.text }),
    onSuccess: () => {
      finish();
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      showToast('Pesan berhasil diedit.');
    },
    // Gagal (lewat 15 menit, WhatsApp menolak, sesi putus): mode edit tetap terbuka agar teksnya tidak hilang.
    onError: (error: Error) => showToast(error.message || 'Gagal mengedit pesan.'),
  });

  function startEdit(item: Pick<EditableMessage, 'id' | 'messageText'>) {
    if (!selectedId) return;
    if (hasPendingAttachment) {
      showToast('Kirim atau hapus lampiran dulu sebelum mengedit pesan.');
      return;
    }
    const text = item.messageText ?? '';
    // Pindah ke pesan lain saat masih mengedit: draf semula tetap yang pertama.
    const previous = editingRef.current;
    const draftBefore = previous?.draftBefore ?? message;
    setEditing({
      chatId: selectedId,
      id: item.id,
      original: text,
      draftBefore,
      draftKey: previous?.draftKey ?? draftIdentity,
      restoreDraft: previous?.restoreDraft ?? (() => setMessage(draftBefore)),
    });
    clearReply();
    setMessage(text);
    requestAnimationFrame(() => {
      const textarea = composerRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(text.length, text.length);
      adjustHeight(textarea);
    });
  }

  function cancelEdit() {
    if (mutation.isPending) return;
    finish();
  }

  function submitEdit() {
    if (!editing || mutation.isPending) return;
    if (problem) {
      showToast(EDIT_TEXT_PROBLEM_TEXT[problem]);
      return;
    }
    if (hasUnresolvedTokens(message.trim())) {
      showToast('Draft masih memuat tanda {{…}}.');
      return;
    }
    mutation.mutate({ id: editing.id, text: message.trim() });
  }

  /** Dipakai alur lain (lampiran, flyer, galeri): selama mengedit, hanya edit yang boleh. true = diblokir. */
  function blockedWhileEditing() {
    if (!editingRef.current) return false;
    showToast(EDIT_BLOCKED_TOAST);
    return true;
  }

  return { editing, hint, problem, isSaving: mutation.isPending, startEdit, cancelEdit, submitEdit, blockedWhileEditing };
}

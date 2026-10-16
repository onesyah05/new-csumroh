// @vitest-environment happy-dom
import { useRef, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { api } from '../../lib/api';
import { useConversationDraft } from './profileDraft';
import { EDIT_BLOCKED_TOAST, useMessageEdit } from './useMessageEdit';

vi.mock('../../lib/api', () => ({ api: { patch: vi.fn() } }));

const toasts: string[] = [];
const clearReply = vi.fn();
const adjustHeight = vi.fn();

type Props = { chatId: number; pending?: boolean };
const identityOf = (chatId: number) => `7:1:${chatId}`;

function useHarness({ chatId, pending = false }: Props) {
  const [message, setMessage] = useConversationDraft(identityOf(chatId));
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const edit = useMessageEdit({
    selectedId: chatId, message, setMessage, draftIdentity: identityOf(chatId), query: '?brandId=1', composerRef, adjustHeight,
    hasPendingAttachment: pending, clearReply, showToast: (text) => toasts.push(text), hasUnresolvedTokens: (text) => text.includes('{{'),
  });
  return { message, setMessage, edit };
}

function setup(initial: Props = { chatId: 10 }) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return renderHook(useHarness, { initialProps: initial, wrapper });
}

const sent = (overrides: Record<string, unknown> = {}) => ({ id: 900, messageText: 'Harga paket 30 juta', ...overrides });

beforeEach(() => {
  toasts.length = 0;
  clearReply.mockClear();
  adjustHeight.mockClear();
  vi.mocked(api.patch).mockReset();
  sessionStorage.clear();
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
});
afterEach(() => cleanup());

describe('Mode edit pesan', () => {
  it('mulai: teks lama masuk ke kotak ketik, balasan dibersihkan, petunjuk netral karena belum diubah', () => {
    const { result } = setup();
    act(() => result.current.setMessage('draf belum terkirim'));
    act(() => result.current.edit.startEdit(sent()));
    expect(result.current.message).toBe('Harga paket 30 juta');
    expect(result.current.edit.editing).toMatchObject({ id: 900, original: 'Harga paket 30 juta', draftBefore: 'draf belum terkirim' });
    expect(result.current.edit.problem).toBe('unchanged');
    expect(result.current.edit.hint).toEqual({ tone: 'neutral', text: 'Ubah teks lalu tekan Enter untuk menyimpan.' });
    expect(clearReply).toHaveBeenCalled();
  });

  it('simpan: PATCH dengan teks yang sudah di-trim, lalu draf semula kembali dan edit selesai', async () => {
    vi.mocked(api.patch).mockResolvedValue({} as never);
    const { result } = setup();
    act(() => result.current.setMessage('draf belum terkirim'));
    act(() => result.current.edit.startEdit(sent()));
    act(() => result.current.setMessage('  Harga paket 28 juta '));
    expect(result.current.edit.hint).toBeNull();
    act(() => result.current.edit.submitEdit());
    await waitFor(() => expect(result.current.edit.editing).toBeNull());
    expect(api.patch).toHaveBeenCalledWith('/chat/messages/900?brandId=1', { text: 'Harga paket 28 juta' });
    expect(result.current.message).toBe('draf belum terkirim');
    expect(toasts).toContain('Pesan berhasil diedit.');
  });

  it('teks kosong: petunjuk berupa kesalahan dan simpan ditolak tanpa memanggil API', () => {
    const { result } = setup();
    act(() => result.current.edit.startEdit(sent()));
    act(() => result.current.setMessage('   '));
    expect(result.current.edit.hint).toEqual({ tone: 'error', text: 'Isi pesan tidak boleh kosong.' });
    act(() => result.current.edit.submitEdit());
    expect(api.patch).not.toHaveBeenCalled();
    expect(toasts).toContain('Isi pesan tidak boleh kosong.');
  });

  it('teks yang tidak berubah atau masih memuat {{token}} tidak dikirim', () => {
    const { result } = setup();
    act(() => result.current.edit.startEdit(sent()));
    act(() => result.current.edit.submitEdit());
    expect(toasts).toContain('Isi pesan belum diubah.');
    act(() => result.current.setMessage('Harga {{harga}}'));
    act(() => result.current.edit.submitEdit());
    expect(toasts).toContain('Draft masih memuat tanda {{…}}.');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('batal: draf semula kembali', () => {
    const { result } = setup();
    act(() => result.current.setMessage('draf semula'));
    act(() => result.current.edit.startEdit(sent()));
    act(() => result.current.setMessage('teks yang diedit'));
    act(() => result.current.edit.cancelEdit());
    expect(result.current.edit.editing).toBeNull();
    expect(result.current.message).toBe('draf semula');
  });

  it('server menolak: mode edit tetap terbuka dan teks yang diketik tidak hilang', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('Lewat 15 menit: pesan tidak bisa lagi diedit di WhatsApp.'));
    const { result } = setup();
    act(() => result.current.edit.startEdit(sent()));
    act(() => result.current.setMessage('Harga paket 28 juta'));
    act(() => result.current.edit.submitEdit());
    await waitFor(() => expect(toasts).toContain('Lewat 15 menit: pesan tidak bisa lagi diedit di WhatsApp.'));
    expect(result.current.edit.editing).not.toBeNull();
    expect(result.current.message).toBe('Harga paket 28 juta');
  });

  it('ada lampiran yang belum terkirim: edit tidak dimulai', () => {
    const { result } = setup({ chatId: 10, pending: true });
    act(() => result.current.edit.startEdit(sent()));
    expect(result.current.edit.editing).toBeNull();
    expect(toasts).toContain('Kirim atau hapus lampiran dulu sebelum mengedit pesan.');
  });

  it('pindah ke pesan lain saat mengedit: draf semula tetap yang pertama', () => {
    const { result } = setup();
    act(() => result.current.setMessage('draf semula'));
    act(() => result.current.edit.startEdit(sent()));
    act(() => result.current.edit.startEdit(sent({ id: 901, messageText: 'Pesan kedua' })));
    expect(result.current.edit.editing).toMatchObject({ id: 901, draftBefore: 'draf semula' });
    act(() => result.current.edit.cancelEdit());
    expect(result.current.message).toBe('draf semula');
  });

  it('alur lain diblokir selama mengedit dengan satu pesan yang sama', () => {
    const { result } = setup();
    expect(result.current.edit.blockedWhileEditing()).toBe(false);
    act(() => result.current.edit.startEdit(sent()));
    expect(result.current.edit.blockedWhileEditing()).toBe(true);
    expect(toasts).toEqual([EDIT_BLOCKED_TOAST]);
  });
});

describe('Edit di tengah pindah chat atau tutup halaman', () => {
  it('pindah chat: edit dibatalkan dan draf kembali ke chat ASALNYA, chat baru tidak tertimpa', () => {
    const { result, rerender } = setup({ chatId: 10 });
    act(() => result.current.setMessage('draf chat 10'));
    act(() => result.current.edit.startEdit(sent()));
    rerender({ chatId: 11 });
    expect(result.current.edit.editing).toBeNull();
    expect(result.current.message).toBe(''); // chat 11 kosong dan tidak terisi teks pesan chat 10
    rerender({ chatId: 10 });
    expect(result.current.message).toBe('draf chat 10');
  });

  it('halaman ditutup saat mengedit: yang tersimpan adalah draf semula, bukan teks pesan yang diedit', () => {
    const { result } = setup({ chatId: 10 });
    act(() => result.current.setMessage('draf semula'));
    act(() => result.current.edit.startEdit(sent()));
    expect(sessionStorage.getItem('azhan.chat-draft.7:1:10')).toBe('Harga paket 30 juta');
    window.dispatchEvent(new Event('pagehide'));
    expect(sessionStorage.getItem('azhan.chat-draft.7:1:10')).toBe('draf semula');
  });
});

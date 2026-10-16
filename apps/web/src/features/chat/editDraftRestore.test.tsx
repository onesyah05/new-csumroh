// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useConversationDraft } from './profileDraft';

beforeEach(() => sessionStorage.clear());
afterEach(() => cleanup());

/**
 * Mode edit memakai kotak ketik: saat edit dimulai, \`setMessage\` chat itu disimpan sebagai \`restoreDraft\`. Bila CS pindah
 * chat di tengah edit, draf semula harus kembali ke chat ASALNYA, bukan menimpa draf chat yang sedang terbuka.
 */
describe('Draf saat mengedit pesan', () => {
  it('restoreDraft dari chat A mengembalikan draf A walau chat B sedang terbuka', () => {
    const { result, rerender } = renderHook(({ id }) => useConversationDraft(id), { initialProps: { id: '7:1:10' } });
    act(() => result.current[1]('draf belum terkirim'));
    // Edit dimulai: draf semula disimpan, kotak ketik berisi teks pesan yang diedit.
    const draftBefore = result.current[0];
    const setMessageOfA = result.current[1];
    const restoreDraft = () => setMessageOfA(draftBefore);
    act(() => setMessageOfA('Harga paket 30 juta'));
    expect(result.current[0]).toBe('Harga paket 30 juta');

    // CS pindah ke chat B (yang punya draf sendiri) dan edit dibatalkan otomatis.
    rerender({ id: '7:1:11' });
    act(() => result.current[1]('draf chat B'));
    act(() => restoreDraft());

    expect(result.current[0]).toBe('draf chat B'); // chat B tidak tertimpa
    rerender({ id: '7:1:10' });
    expect(result.current[0]).toBe('draf belum terkirim'); // chat A pulih
  });

  it('edit dibatalkan di chat yang sama: draf semula kembali', () => {
    const { result } = renderHook(() => useConversationDraft('7:1:10'));
    act(() => result.current[1]('draf semula'));
    const draftBefore = result.current[0];
    const setMessage = result.current[1];
    act(() => setMessage('teks edit'));
    act(() => setMessage(draftBefore));
    expect(result.current[0]).toBe('draf semula');
  });
});

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageBubble, type MessageBubbleProps } from './MessageBubble';

const nowSeconds = () => Math.floor(Date.now() / 1000);
const baseItem = (overrides: Record<string, unknown> = {}) => ({
  id: 900, messageId: 'WA900', isFromMe: true, isDeleted: false, messageType: 'conversation', messageText: 'Harga paket 30 juta',
  timestamp: nowSeconds() - 60, status: 'read', editedAt: null, senderName: 'Aisyah', ...overrides,
});

function renderBubble(item: Record<string, unknown>, overrides: Partial<MessageBubbleProps> = {}) {
  const startEdit = vi.fn();
  const props: MessageBubbleProps = {
    item, isNewDate: false, dateLabel: '', isPickerOpen: false, isRevealedByAdmin: false, isAdmin: false, showDeletedMessages: false,
    canSend: true, canReply: true, selected: { name: 'Ibu Aisyah', user: { id: 10, name: 'Aisyah' }, status: 'contact' }, user: { id: 10, role: 'cs' },
    composerRef: { current: null }, setActiveReactionMessageId: vi.fn(), setRevealedDeletedIds: vi.fn(), setReplyingTo: vi.fn(),
    setDeleteConfirmId: vi.fn(), startEdit, setPreviewFlyer: vi.fn(), reactMutate: vi.fn(), starMutate: vi.fn(), proofMutate: vi.fn(),
    proofPending: false, scrollToMessage: vi.fn(), showToast: vi.fn(), ...overrides,
  };
  render(<MessageBubble {...props} />);
  return { startEdit };
}

function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Menu pesan' }), { key: 'Enter' });
}
const editItem = () => screen.queryByRole('menuitem', { name: /^Edit/ });

afterEach(() => cleanup());

describe('Menu Edit pada gelembung pesan', () => {
  it('PIC pada pesan teks sendiri dalam 15 menit: Edit aktif dan memanggil startEdit dengan pesannya', () => {
    const item = baseItem();
    const { startEdit } = renderBubble(item);
    openMenu();
    const menuItem = editItem()!;
    expect(menuItem).toBeTruthy();
    expect(menuItem.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(menuItem);
    expect(startEdit).toHaveBeenCalledWith(item);
  });

  it('lewat 15 menit: Edit tetap tampil tetapi nonaktif dengan alasannya', () => {
    const { startEdit } = renderBubble(baseItem({ timestamp: nowSeconds() - 16 * 60 }));
    openMenu();
    const menuItem = editItem()!;
    expect(menuItem.textContent).toContain('Lewat 15 menit');
    expect(menuItem.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(menuItem);
    expect(startEdit).not.toHaveBeenCalled();
  });

  it('bukan Admin/PIC: Edit nonaktif dengan keterangan', () => {
    const { startEdit } = renderBubble(baseItem(), { user: { id: 11, role: 'cs' } });
    openMenu();
    const menuItem = editItem()!;
    expect(menuItem.textContent).toContain('Hanya Admin/PIC');
    expect(menuItem.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(menuItem);
    expect(startEdit).not.toHaveBeenCalled();
  });

  it('Admin boleh walau bukan PIC', () => {
    renderBubble(baseItem(), { user: { id: 1, role: 'admin' }, isAdmin: true });
    openMenu();
    expect(editItem()!.getAttribute('aria-disabled')).not.toBe('true');
  });

  it.each([
    ['pesan jamaah', { isFromMe: false }],
    ['foto/video', { messageType: 'imageMessage' }],
    ['dokumen', { messageType: 'documentMessage' }],
    ['pesan terhapus', { isDeleted: true }],
  ])('tidak ada menu Edit untuk %s', (_name, overrides) => {
    renderBubble(baseItem(overrides));
    openMenu();
    // Menu terbuka (item Balas selalu ada), tetapi tanpa item Edit.
    expect(screen.getByRole('menuitem', { name: /Balas/ })).toBeTruthy();
    expect(editItem()).toBeNull();
  });
});

describe('Menu Edit: alasan ditampilkan', () => {
  it('pesan teks ber-id lokal (tidak tercatat di WhatsApp) tampil tetapi nonaktif dengan alasannya', () => {
    renderBubble(baseItem({ messageId: 'local-abc' }));
    openMenu();
    const menuItem = editItem()!;
    expect(menuItem.textContent).toContain('Tidak tercatat di WhatsApp');
    expect(menuItem.getAttribute('aria-disabled')).toBe('true');
  });

  it('bukan Admin/PIC dan lewat 15 menit: tooltip menyebut kedua alasan', () => {
    renderBubble(baseItem({ timestamp: nowSeconds() - 20 * 60 }), { user: { id: 11, role: 'cs' } });
    openMenu();
    const menuItem = editItem()!;
    expect(menuItem.textContent).toContain('Hanya Admin/PIC');
    expect(menuItem.getAttribute('title')).toContain('Hanya Admin dan PIC (Aisyah)');
    expect(menuItem.getAttribute('title')).toContain('Lewat 15 menit');
  });
});

describe('Penanda Diedit', () => {
  it('pesan yang pernah diedit menampilkan label Diedit; yang belum tidak', () => {
    renderBubble(baseItem({ editedAt: '2026-10-16T05:00:00.000Z' }));
    expect(screen.getByText('Diedit')).toBeTruthy();
    cleanup();
    renderBubble(baseItem());
    expect(screen.queryByText('Diedit')).toBeNull();
  });
});

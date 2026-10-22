// @vitest-environment happy-dom
import { cleanup, createEvent, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageBubble, type MessageBubbleProps } from './MessageBubble';

const item = { id: 900, messageId: 'WA900', isFromMe: false, isDeleted: false, messageType: 'conversation', messageText: 'Berapa harga paket?', timestamp: 1_790_000_000, status: 'read', senderName: 'Ibu Aisyah' };

function renderBubble(overrides: Partial<MessageBubbleProps> = {}, data: Record<string, unknown> = {}) {
  const setReplyingTo = vi.fn();
  const composer = document.createElement('textarea');
  const focus = vi.spyOn(composer, 'focus');
  const props: MessageBubbleProps = {
    item: { ...item, ...data }, isNewDate: false, dateLabel: '', isPickerOpen: false, isRevealedByAdmin: false, isAdmin: false, showDeletedMessages: false,
    canSend: true, canReply: true, swipeToReply: true, selected: { name: 'Ibu Aisyah', user: { id: 10, name: 'Aisyah' }, status: 'contact' }, user: { id: 10, role: 'cs' },
    composerRef: { current: composer }, setActiveReactionMessageId: vi.fn(), setRevealedDeletedIds: vi.fn(), setReplyingTo,
    setDeleteConfirmId: vi.fn(), startEdit: vi.fn(), setPreviewFlyer: vi.fn(), reactMutate: vi.fn(), starMutate: vi.fn(), proofMutate: vi.fn(),
    proofPending: false, scrollToMessage: vi.fn(), showToast: vi.fn(), ...overrides,
  };
  const view = render(<MessageBubble {...props} />);
  const row = view.container.querySelector('.group') as HTMLElement;
  return { row, setReplyingTo, focus };
}

function pointer(target: HTMLElement, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y = 0, pointerType = 'touch') {
  const event = createEvent[type](target, { pointerId: 1, pointerType, clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(target, event);
}
function swipe(row: HTMLElement, dx: number, dy = 0, pointerType = 'touch') {
  pointer(row, 'pointerDown', 10, 10, pointerType);
  pointer(row, 'pointerMove', 10 + dx / 2, 10 + dy / 2, pointerType);
  pointer(row, 'pointerMove', 10 + dx, 10 + dy, pointerType);
  pointer(row, 'pointerUp', 10 + dx, 10 + dy, pointerType);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Geser bubble untuk membalas (HP)', () => {
  it('geser kanan melewati ambang membalas pesan itu dan mengaktifkan kolom pesan', () => {
    const { row, setReplyingTo, focus } = renderBubble();
    swipe(row, 90);
    expect(setReplyingTo).toHaveBeenCalledWith({ id: 900, messageId: 'WA900', senderName: 'Ibu Aisyah', text: 'Berapa harga paket?' });
    expect(focus).toHaveBeenCalled();
  });

  it('geser pendek membatalkan dan bubble kembali ke posisi semula', () => {
    const { row, setReplyingTo } = renderBubble();
    swipe(row, 30);
    expect(setReplyingTo).not.toHaveBeenCalled();
    expect(row.style.transform).toBe('');
  });

  it('bubble mengikuti jari langsung di DOM selama geser (tanpa render ulang) dan kembali saat dilepas', () => {
    const { row } = renderBubble();
    pointer(row, 'pointerDown', 10, 10);
    pointer(row, 'pointerMove', 30, 10);
    pointer(row, 'pointerMove', 40, 10);
    expect(row.style.transform).toBe('translate3d(30px,0,0)');
    pointer(row, 'pointerUp', 40, 10);
    expect(row.style.transform).toBe('');
  });

  it('scroll vertikal tidak membalas', () => {
    const { row, setReplyingTo } = renderBubble();
    swipe(row, 20, 90);
    expect(setReplyingTo).not.toHaveBeenCalled();
  });

  it('tidak aktif di desktop, tanpa hak balas, untuk pesan terhapus, atau selain sentuhan', () => {
    for (const [overrides, data, type] of [
      [{ swipeToReply: false }, {}, 'touch'],
      [{ canReply: false, swipeToReply: false }, {}, 'touch'],
      [{}, { isDeleted: true }, 'touch'],
      [{}, {}, 'mouse'],
    ] as const) {
      const { row, setReplyingTo } = renderBubble(overrides, data);
      swipe(row, 90, 0, type);
      expect(setReplyingTo).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('pesan keluar dibalas sebagai "Anda"', () => {
    const { row, setReplyingTo } = renderBubble({}, { isFromMe: true });
    swipe(row, 90);
    expect(setReplyingTo).toHaveBeenCalledWith(expect.objectContaining({ senderName: 'Anda' }));
  });
});

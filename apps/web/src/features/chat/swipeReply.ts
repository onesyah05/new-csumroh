import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Jarak geser (px) yang memicu balas, dan batas geser maksimum bubble. */
export const SWIPE_REPLY_THRESHOLD = 64;
export const SWIPE_REPLY_MAX = 96;
/** Gerak minimum sebelum arah geser ditentukan. */
const DECIDE_AFTER = 10;

/** Arah gerakan: horizontal ke kanan dihitung geser; vertikal atau ke kiri dilepas ke scroll chat. */
export function classifySwipe(dx: number, dy: number): 'pending' | 'swipe' | 'ignore' {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_AFTER) return 'pending';
  if (dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.5) return 'swipe';
  return 'ignore';
}

/** Bubble mengikuti jari, makin berat setelah melewati ambang, dan berhenti di batas maksimum. */
export function swipeOffset(dx: number) {
  if (dx <= 0) return 0;
  if (dx <= SWIPE_REPLY_THRESHOLD) return dx;
  return Math.min(SWIPE_REPLY_MAX, SWIPE_REPLY_THRESHOLD + (dx - SWIPE_REPLY_THRESHOLD) * 0.4);
}

export const isSwipeReplyTriggered = (dx: number) => dx >= SWIPE_REPLY_THRESHOLD;

/**
 * Geser bubble ke kanan untuk membalas (HP). Hanya sentuhan; mouse dan pena tidak ikut. Elemen yang memakai ini
 * perlu `touch-action: pan-y` agar scroll vertikal tetap milik browser.
 */
export function useSwipeToReply({ enabled, onReply }: { enabled: boolean; onReply: () => void }) {
  const [offset, setOffset] = useState(0);
  const start = useRef<{ x: number; y: number; id: number; mode: 'pending' | 'swipe'; armed: boolean } | null>(null);

  const reset = useCallback(() => { start.current = null; setOffset(0); }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.pointerType !== 'touch') return;
    start.current = { x: event.clientX, y: event.clientY, id: event.pointerId, mode: 'pending', armed: false };
  }, [enabled]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s || s.id !== event.pointerId) return;
    const dx = event.clientX - s.x;
    const dy = event.clientY - s.y;
    if (s.mode === 'pending') {
      const kind = classifySwipe(dx, dy);
      if (kind === 'pending') return;
      if (kind === 'ignore') { start.current = null; return; }
      s.mode = 'swipe';
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    const armed = isSwipeReplyTriggered(dx);
    if (armed && !s.armed) navigator.vibrate?.(15);
    s.armed = armed;
    setOffset(swipeOffset(dx));
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s || s.id !== event.pointerId) return;
    const triggered = s.mode === 'swipe' && isSwipeReplyTriggered(event.clientX - s.x);
    reset();
    if (triggered) onReply();
  }, [onReply, reset]);

  return { offset, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset } };
}

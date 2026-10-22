import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/** Jarak geser (px) yang memicu balas, dan batas geser maksimum bubble. */
export const SWIPE_REPLY_THRESHOLD = 48;
export const SWIPE_REPLY_MAX = 80;
/** Gerak minimum sebelum arah geser ditentukan. */
const DECIDE_AFTER = 6;

/** Arah gerakan: ke kanan dan tidak lebih curam dari 45 derajat dihitung geser; selain itu dilepas ke scroll chat. */
export function classifySwipe(dx: number, dy: number): 'pending' | 'swipe' | 'ignore' {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_AFTER) return 'pending';
  return dx > 0 && dx > Math.abs(dy) ? 'swipe' : 'ignore';
}

/** Bubble mengikuti jari 1:1 sampai ambang, lalu sedikit lebih berat, dan berhenti di batas maksimum. */
export function swipeOffset(dx: number) {
  if (dx <= 0) return 0;
  if (dx <= SWIPE_REPLY_THRESHOLD) return dx;
  return Math.min(SWIPE_REPLY_MAX, SWIPE_REPLY_THRESHOLD + (dx - SWIPE_REPLY_THRESHOLD) * 0.5);
}

export const isSwipeReplyTriggered = (dx: number) => dx >= SWIPE_REPLY_THRESHOLD;

/**
 * Geser bubble ke kanan untuk membalas (HP). Hanya sentuhan; mouse dan pena tidak ikut. Elemen yang memakai ini
 * perlu `touch-action: pan-y` agar scroll vertikal tetap milik browser. Posisi bubble dan ikon diubah langsung di DOM
 * (tanpa state React): merender ulang bubble di setiap gerakan jari membuat geseran patah-patah.
 */
export function useSwipeToReply({ enabled, onReply }: { enabled: boolean; onReply: () => void }) {
  const rowRef = useRef<HTMLElement | null>(null);
  const iconRef = useRef<HTMLElement | null>(null);
  const start = useRef<{ x: number; y: number; id: number; mode: 'pending' | 'swipe'; armed: boolean } | null>(null);

  const paint = useCallback((offset: number, animate: boolean) => {
    const row = rowRef.current;
    const icon = iconRef.current;
    if (row) {
      row.style.transition = animate ? 'transform 150ms ease-out' : 'none';
      row.style.transform = offset ? `translate3d(${offset}px,0,0)` : '';
    }
    if (icon) {
      icon.style.transition = animate ? 'opacity 150ms ease-out' : 'none';
      icon.style.opacity = String(Math.min(1, offset / (SWIPE_REPLY_THRESHOLD * 0.6)));
      icon.style.transform = `translate3d(${-offset}px,-50%,0) scale(${Math.min(1, offset / SWIPE_REPLY_THRESHOLD)})`;
    }
  }, []);

  const reset = useCallback(() => { start.current = null; paint(0, true); }, [paint]);

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
    paint(swipeOffset(dx), false);
  }, [paint]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s || s.id !== event.pointerId) return;
    const triggered = s.mode === 'swipe' && isSwipeReplyTriggered(event.clientX - s.x);
    reset();
    if (triggered) onReply();
  }, [onReply, reset]);

  return {
    rowRef: (element: HTMLElement | null) => { rowRef.current = element; },
    iconRef: (element: HTMLElement | null) => { iconRef.current = element; },
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset },
  };
}

import type { KeyboardEvent } from 'react';

/**
 * Pola keyboard untuk grup radio/tab buatan sendiri (WAI-ARIA): satu posisi Tab per grup, panah kiri/kanan (atau
 * atas/bawah), Home, dan End memindahkan pilihan sekaligus fokus. Pasang di elemen grup (`role="radiogroup"`/`tablist`).
 */
export function onRovingKey<T>(event: KeyboardEvent<HTMLElement>, values: readonly T[], current: T | null | undefined, select: (value: T) => void) {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
  if (!step && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  const at = values.indexOf(current as T);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : (Math.max(at, 0) + step + values.length) % values.length;
  select(values[next]!);
  event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"],[role="tab"]')[next]?.focus();
}

/** tabIndex untuk anggota grup: hanya yang terpilih (atau yang pertama bila belum ada) bisa di-Tab. */
export const rovingTabIndex = <T,>(value: T, current: T | null | undefined, first: T) =>
  (current === null || current === undefined ? value === first : value === current) ? 0 : -1;

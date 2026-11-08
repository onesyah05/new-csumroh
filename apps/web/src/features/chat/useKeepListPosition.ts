import { useLayoutEffect, useMemo, useRef, type DependencyList } from 'react';

type Snapshot = { top: number; rows: Map<string, number> };

/**
 * Menjaga posisi gulir daftar chat saat urutannya berubah (chat yang dibalas atau menerima pesan baru pindah ke atas).
 *
 * Scroll anchoring bawaan browser bisa memilih baris yang pindah itu sebagai jangkar, lalu ikut menggulir daftar sampai
 * ke paling atas. Karena itu kontainer memakai `overflow-anchor: none` dan posisinya dijaga di sini: baris yang terlihat
 * dicatat (urut dari atas) tepat sebelum DOM berubah, lalu setelah render daftar digeser agar baris teratas yang tidak
 * pindah tetap di tempatnya. Bila sebelumnya di paling atas, daftar tetap di atas agar chat baru terlihat.
 *
 * Setiap baris harus punya atribut `data-row-id`.
 */
export function useKeepListPosition(deps: DependencyList) {
  const nodeRef = useRef<HTMLDivElement | null>(null);

  // Dicatat saat render, sebelum React mengubah DOM: baris memakai `content-visibility: auto` sehingga tingginya bisa
  // berubah tanpa event scroll, jadi catatan dari saat menggulir bisa sudah basi.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const snapshot = useMemo(() => measure(nodeRef.current), deps);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node || !node.clientHeight || !snapshot || snapshot.top <= 1) return;
    const box = node.getBoundingClientRect();
    // Jangkar = baris teratas yang tadi terlihat dan masih di sekitar tempatnya. Baris yang pindah ke atas (dibalas,
    // pesan baru) bergeser lebih dari satu layar, jadi dilewati.
    for (const [id, before] of snapshot.rows) {
      const row = node.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
      if (!row) continue;
      const shift = row.getBoundingClientRect().top - box.top - before;
      if (Math.abs(shift) > node.clientHeight) continue;
      if (Math.abs(shift) >= 1) node.scrollTop += shift;
      break;
    }
  }, [snapshot]);

  return { nodeRef };
}

function measure(node: HTMLDivElement | null): Snapshot | null {
  // Tersembunyi (mis. layar HP sedang membuka chat) atau belum terpasang: tidak ada posisi yang bisa dicatat.
  if (!node || !node.clientHeight) return null;
  const box = node.getBoundingClientRect();
  const rows = new Map<string, number>();
  for (const row of node.querySelectorAll<HTMLElement>('[data-row-id]')) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom > box.top && rect.top < box.bottom) rows.set(row.dataset.rowId!, rect.top - box.top);
  }
  return { top: node.scrollTop, rows };
}

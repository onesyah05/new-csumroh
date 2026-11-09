import { useLayoutEffect, useMemo, useRef, type DependencyList } from 'react';

/** Baris yang terlihat: jarak dari atas kotak (px) dan urutannya di daftar. */
type Snapshot = { top: number; rows: Map<string, { offset: number; index: number }> };

/**
 * Menjaga posisi gulir daftar chat saat urutannya berubah (chat yang dibalas atau menerima pesan baru pindah ke atas).
 *
 * Scroll anchoring bawaan browser bisa memilih baris yang pindah itu sebagai jangkar, lalu ikut menggulir daftar sampai
 * ke paling atas. Karena itu kontainer memakai `overflow-anchor: none` dan posisinya dijaga di sini: baris yang terlihat
 * dicatat (urut dari atas) tepat sebelum DOM berubah, lalu setelah render daftar digeser agar baris teratas yang tidak
 * naik urutan tetap di tempatnya. Bila sebelumnya di paling atas, daftar tetap di atas agar chat baru terlihat.
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
    const rows = [...node.querySelectorAll<HTMLElement>('[data-row-id]')];
    const indexOf = new Map(rows.map((row, index) => [row.dataset.rowId!, index]));
    // Jangkar = baris teratas yang tadi terlihat dan tidak naik urutan. Baris yang naik (dibalas, menerima pesan baru)
    // dilewati berapa pun jaraknya, agar daftar tidak ikut naik bersamanya.
    for (const [id, before] of snapshot.rows) {
      const index = indexOf.get(id);
      if (index === undefined || index < before.index) continue;
      const shift = rows[index]!.getBoundingClientRect().top - box.top - before.offset;
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
  const rows: Snapshot['rows'] = new Map();
  node.querySelectorAll<HTMLElement>('[data-row-id]').forEach((row, index) => {
    const rect = row.getBoundingClientRect();
    if (rect.bottom > box.top && rect.top < box.bottom) rows.set(row.dataset.rowId!, { offset: rect.top - box.top, index });
  });
  return { top: node.scrollTop, rows };
}

import { useEffect, useRef, useState, type DragEvent } from 'react';

const hasFiles = (event: Pick<DragEvent, 'dataTransfer'> | globalThis.DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');

/**
 * Seret-lepas berkas dari luar browser ke satu area. `dragging` menyalakan bingkai petunjuk; drag elemen halaman
 * biasa diabaikan. Selama hook terpasang, berkas yang dilepas di luar area tidak dibuka browser (meninggalkan
 * halaman). `disabled` (mis. unggahan sedang berjalan) mematikan area tanpa mengubah perilaku di luar area.
 */
export function useFileDrop({ onFiles, disabled = false }: { onFiles(files: File[]): void; disabled?: boolean }) {
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave menyala pada tiap anak area; penghitung menjaga bingkai tidak berkedip.
  const depth = useRef(0);

  useEffect(() => {
    const reset = () => { depth.current = 0; setDragging(false); };
    // Lepas di luar area: batalkan navigasi bawaan browser ke berkas.
    const guard = (event: globalThis.DragEvent) => { if (hasFiles(event)) event.preventDefault(); };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    // Seretan dibatalkan (Esc) atau berakhir di luar jendela: dragenter/dragleave tidak seimbang.
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
    };
  }, []);

  useEffect(() => { if (disabled) { depth.current = 0; setDragging(false); } }, [disabled]);

  const dropProps = {
    onDragEnter: (event: DragEvent) => {
      if (disabled || !hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (disabled || !hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event: DragEvent) => {
      if (disabled || !hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (disabled || !hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      onFiles(Array.from(event.dataTransfer.files));
    },
  };

  return { dragging, dropProps };
}

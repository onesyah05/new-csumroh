import { useEffect, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Bukti bayar disimpan privat dan hanya bisa dibaca dengan Bearer token, sehingga
 * tidak dapat dipakai langsung di <img src>. Hook ini mengunduhnya sebagai blob dan
 * mengembalikan object URL yang dibersihkan saat komponen dilepas.
 */
export function usePrivateFile(url?: string | null) {
  const [state, setState] = useState<{ objectUrl: string | null; mime: string; error: string | null }>({
    objectUrl: null,
    mime: '',
    error: null,
  });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let created: string | null = null;
    setState({ objectUrl: null, mime: '', error: null });
    api.blob(url)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setState({ objectUrl: created, mime: blob.type, error: null });
      })
      .catch((err: Error) => !cancelled && setState({ objectUrl: null, mime: '', error: err.message }));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  return state;
}

export function PrivateProofPreview({ url }: { url: string }) {
  const { objectUrl, mime, error } = usePrivateFile(url);

  if (error) return <p className="p-3 text-[11px] text-red-600">Bukti transfer tidak dapat dimuat: {error}</p>;
  if (!objectUrl) return <p className="p-3 text-[11px] text-zinc-500">Memuat bukti transfer…</p>;
  if (mime === 'application/pdf') {
    return (
      <div className="flex w-full flex-col gap-2">
        <object data={objectUrl} type="application/pdf" className="h-56 w-full rounded-lg bg-white">
          <div className="flex items-center gap-2 p-3 text-[11px] text-zinc-600">
            <FileText size={14} /> Pratinjau PDF tidak didukung browser ini.
          </div>
        </object>
        <a href={objectUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline">
          <ExternalLink size={12} /> Buka PDF di tab baru
        </a>
      </div>
    );
  }
  return (
    <a href={objectUrl} target="_blank" rel="noreferrer" title="Buka ukuran penuh">
      <img src={objectUrl} alt="Bukti Transfer" className="max-h-44 object-contain rounded-lg shadow-xs" />
    </a>
  );
}

/** Thumbnail kecil untuk panel prospek; klik membuka berkas penuh di tab baru. */
export function PrivateProofThumb({ url }: { url: string }) {
  const { objectUrl, mime, error } = usePrivateFile(url);
  const content = error ? (
    <span className="text-[9px] text-red-600">Gagal</span>
  ) : !objectUrl ? (
    <span className="text-[9px] text-zinc-400">…</span>
  ) : mime === 'application/pdf' ? (
    <FileText size={18} className="text-emerald-700" />
  ) : (
    <img src={objectUrl} alt="Bukti Transfer" className="h-full w-full object-cover" />
  );
  return (
    <a
      href={objectUrl ?? undefined}
      target="_blank"
      rel="noreferrer"
      title="Lihat bukti transfer"
      className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-emerald-300 bg-white"
    >
      {content}
    </a>
  );
}

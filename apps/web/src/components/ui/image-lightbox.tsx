import * as Dialog from '@radix-ui/react-dialog';
import { Download, ExternalLink, X } from 'lucide-react';

/**
 * Penampil gambar layar penuh (mis. flyer paket). Klik di luar gambar atau Escape menutup; fokus kembali
 * ke pemicu. Nama dialog = `alt` gambar untuk pembaca layar.
 */
export function ImageLightbox({ open, onClose, src, alt, download = false }: {
  open: boolean;
  onClose: () => void;
  src: string;
  alt: string;
  /** Tampilkan tombol unduh (mis. media chat) alih-alih "buka di tab baru". */
  download?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          // Konten memenuhi layar: klik di area gelap (bukan gambar/tombol) dianggap klik di luar.
          onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none sm:p-6"
        >
          <Dialog.Title className="sr-only">{alt}</Dialog.Title>
          <div className="relative flex max-h-[92vh] max-w-[92vw] flex-col items-center overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-2 shadow-2xl">
            <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                {...(download ? { download: true } : {})}
                aria-label={download ? 'Unduh berkas' : 'Buka gambar asli di tab baru'}
                className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white/80 backdrop-blur-xs transition hover:bg-black/80 hover:text-white"
              >
                {download ? <Download size={16} /> : <ExternalLink size={16} />}
              </a>
              <Dialog.Close
                aria-label="Tutup pratinjau"
                className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white/80 backdrop-blur-xs transition hover:bg-black/80 hover:text-white"
              >
                <X size={16} />
              </Dialog.Close>
            </div>
            <img src={src} alt={alt} className="max-h-[86vh] w-auto max-w-full rounded-xl object-contain" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

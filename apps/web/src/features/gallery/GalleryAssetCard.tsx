import { useRef } from 'react';
import { Pencil, Play, ZoomIn } from 'lucide-react';
import { resolveMediaUrl } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/button';
import { isVideoAsset, type GalleryAsset } from './galleryApi';

export function formatGalleryWhen(iso: string) {
  return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Satu media di grid galeri: thumbnail, nama, dan aksi zoom/ganti nama di atas gambar. Aksi tampil saat hover atau
 * fokus; pada media terpilih dan di perangkat tanpa hover selalu tampil (layar sentuh).
 */
export function GalleryAssetCard({ asset, active, editable, renameValue, onSelect, onOpen, onZoom, onStartRename, onRenameChange, onRenameCommit, onRenameCancel }: {
  asset: GalleryAsset;
  active: boolean;
  /** Pengunggah atau Admin. */
  editable: boolean;
  /** Tidak null = nama sedang diubah di kartu ini. */
  renameValue: string | null;
  onSelect(): void;
  onOpen(): void;
  onZoom(): void;
  onStartRename(): void;
  onRenameChange(value: string): void;
  onRenameCommit(value: string): void;
  onRenameCancel(): void;
}) {
  const skipSave = useRef(false);
  const renaming = renameValue !== null;
  const uploader = asset.uploadedBy?.name ?? 'Pengguna dihapus';
  const iconButton = 'rounded-full bg-white/95 shadow-sm ring-1 ring-black/10 hover:bg-white';

  return (
    <li className="group relative min-w-0">
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onOpen}
        aria-pressed={active}
        title={asset.name + ' · ' + uploader + ' · ' + formatGalleryWhen(asset.createdAt)}
        className={cn('block w-full min-w-0 rounded-xl border p-1 text-left transition', active ? 'border-zinc-950 ring-2 ring-zinc-950/15' : 'border-zinc-200 hover:border-zinc-300')}
      >
        <span className="relative block aspect-square overflow-hidden rounded-lg bg-zinc-100">
          {isVideoAsset(asset) ? (
            <>
              <video src={resolveMediaUrl(asset.url)} preload="metadata" muted playsInline className="h-full w-full object-cover" />
              <span className="absolute inset-0 grid place-items-center"><span className="grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white"><Play size={16} /></span></span>
            </>
          ) : (
            <img src={resolveMediaUrl(asset.url)} alt={asset.name} loading="lazy" className="h-full w-full object-cover" />
          )}
        </span>
        <span className={cn('mt-1 block truncate px-1 text-xs font-medium text-zinc-700', renaming && 'invisible')}>{asset.name}</span>
      </button>

      {renaming && (
        // Ganti nama inline menimpa label di dalam kartu (tinggi kartu tetap): sengaja tanpa lantai tinggi kontrol global.
        <input
          autoFocus
          value={renameValue}
          onChange={(event) => onRenameChange(event.target.value)}
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') { event.stopPropagation(); skipSave.current = true; onRenameCancel(); }
          }}
          onBlur={() => {
            if (skipSave.current) { skipSave.current = false; return; }
            onRenameCommit(renameValue);
          }}
          maxLength={160}
          aria-label="Nama media"
          className="absolute inset-x-2 bottom-1.5 h-4 !min-h-0 min-w-0 rounded-none border-0 border-b border-zinc-950 bg-white p-0 px-1 text-xs font-medium leading-4 text-zinc-900 outline-none focus:ring-0"
        />
      )}

      <span
        className={cn(
          'absolute right-2 top-2 flex gap-1 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
          active ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Button type="button" size="icon" variant="secondary" onClick={onZoom} aria-label={'Perbesar ' + asset.name} className={iconButton}>
          <ZoomIn size={15} />
        </Button>
        {editable && (
          <Button type="button" size="icon" variant="secondary" onClick={onStartRename} aria-label={'Ganti nama ' + asset.name} className={iconButton}>
            <Pencil size={15} />
          </Button>
        )}
      </span>
    </li>
  );
}

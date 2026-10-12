import { useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, FolderInput, MoreVertical, Pencil, Play, Trash2, ZoomIn } from 'lucide-react';
import { resolveMediaUrl } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/button';
import { MENU_CONTENT, MENU_ITEM, MENU_SEPARATOR } from '../../components/ui/menu-styles';
import { isVideoAsset, type GalleryAsset, type GalleryFolder } from './galleryApi';

export function formatGalleryWhen(iso: string) {
  return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Aksi pada satu media; hanya diberikan untuk pengunggah atau Admin. */
export interface GalleryAssetActions {
  /** Folder tujuan untuk Pindahkan. */
  folders: GalleryFolder[];
  move(folderId: number | null): void;
  startRename(): void;
  remove(): void;
}

/** Keadaan ganti nama inline pada kartu ini (null = tidak sedang diubah). */
export interface GalleryRenameState {
  value: string;
  change(value: string): void;
  commit(value: string): void;
  cancel(): void;
}

/**
 * Satu media di grid galeri: thumbnail, nama, zoom, dan menu titik tiga (ganti nama, pindahkan, hapus) di atas
 * gambar. Aksi tampil saat hover atau fokus, saat menu terbuka, pada media terpilih, dan di perangkat tanpa hover.
 */
export function GalleryAssetCard({ asset, active, actions, rename, onSelect, onOpen, onZoom }: {
  asset: GalleryAsset;
  active: boolean;
  /** Null untuk pengguna yang bukan pengunggah/Admin: hanya zoom. */
  actions: GalleryAssetActions | null;
  rename: GalleryRenameState | null;
  onSelect(): void;
  onOpen(): void;
  onZoom(): void;
}) {
  const skipSave = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
        <span className={cn('mt-1 block truncate px-1 text-xs font-medium text-zinc-700', rename && 'invisible')}>{asset.name}</span>
      </button>

      {rename && (
        // Ganti nama inline menimpa label di dalam kartu (tinggi kartu tetap): sengaja tanpa lantai tinggi kontrol global.
        <input
          autoFocus
          value={rename.value}
          onChange={(event) => rename.change(event.target.value)}
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') { event.stopPropagation(); skipSave.current = true; rename.cancel(); }
          }}
          onBlur={() => {
            if (skipSave.current) { skipSave.current = false; return; }
            rename.commit(rename.value);
          }}
          maxLength={160}
          aria-label="Nama media"
          className="absolute inset-x-2 bottom-1.5 h-4 !min-h-0 min-w-0 rounded-none border-0 border-b border-zinc-950 bg-white p-0 px-1 text-xs font-medium leading-4 text-zinc-900 outline-none focus:ring-0"
        />
      )}

      <span
        className={cn(
          'absolute right-2 top-2 flex gap-1 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none),(pointer:coarse)]:opacity-100',
          active || menuOpen ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Button type="button" size="icon" variant="secondary" onClick={onZoom} aria-label={'Perbesar ' + asset.name} className={iconButton}>
          <ZoomIn size={15} />
        </Button>
        {actions && (
          <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenu.Trigger asChild>
              <Button type="button" size="icon" variant="secondary" aria-label={'Opsi ' + asset.name} className={iconButton}>
                <MoreVertical size={15} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className={cn(MENU_CONTENT, 'min-w-44')}>
                <DropdownMenu.Item onSelect={actions.startRename} className={MENU_ITEM}>
                  <Pencil size={14} className="text-zinc-500" aria-hidden="true" />Ganti nama
                </DropdownMenu.Item>
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className={cn(MENU_ITEM, 'justify-between')}>
                    <span className="flex items-center gap-2"><FolderInput size={14} className="text-zinc-500" aria-hidden="true" />Pindahkan</span>
                    <ChevronRight size={14} className="text-zinc-400" aria-hidden="true" />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent sideOffset={4} className={cn(MENU_CONTENT, 'min-w-44')}>
                      <DropdownMenu.Item onSelect={() => actions.move(null)} className={cn(MENU_ITEM, 'justify-between')}>
                        Tanpa folder{asset.folderId === null && <Check size={14} aria-hidden="true" />}
                      </DropdownMenu.Item>
                      {actions.folders.map((folder) => (
                        <DropdownMenu.Item key={folder.id} onSelect={() => actions.move(folder.id)} className={cn(MENU_ITEM, 'justify-between')}>
                          <span className="truncate">{folder.name}</span>
                          {asset.folderId === folder.id && <Check size={14} className="shrink-0" aria-hidden="true" />}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
                <DropdownMenu.Separator className={MENU_SEPARATOR} />
                <DropdownMenu.Item onSelect={actions.remove} className={cn(MENU_ITEM, 'text-rose-700')}>
                  <Trash2 size={14} aria-hidden="true" />Hapus
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </span>
    </li>
  );
}

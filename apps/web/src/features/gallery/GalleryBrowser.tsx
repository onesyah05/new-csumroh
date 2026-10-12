import { useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, FolderPlus, Images, Loader2, Monitor, Search, Trash2, Upload, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/page-feedback';
import { ImageLightbox } from '../../components/ui/image-lightbox';
import { ConfirmDialog } from '../../components/ui/modal';
import { Select } from '../../components/ui/select';
import { showFeedback } from '../../app/toast';
import { resolveMediaUrl } from '../../lib/api';
import { formatFileSize } from '../chat/mediaCompressor';
import { GalleryAssetCard, formatGalleryWhen } from './GalleryAssetCard';
import {
  GALLERY_ACCEPT, isVideoAsset, uploadGalleryFile,
  type GalleryAsset, type GalleryAssetPage, type GalleryFolders,
} from './galleryApi';

const RECENT = 'recent';
const NO_FOLDER = '0';

type PendingDelete = { kind: 'asset'; asset: GalleryAsset } | { kind: 'folder'; id: number; name: string };

/**
 * Galeri media bersama per brand. Dipakai di halaman Galeri (mode "page") dan di Inbox saat CS memilih Foto & Video
 * (mode "picker": satu media dipilih lalu dikembalikan lewat onSelect).
 */
export function GalleryBrowser({ brandId, mode, onSelect, onClose, onPickFromDevice }: {
  brandId: number;
  mode: 'page' | 'picker';
  onSelect?: (asset: GalleryAsset) => void;
  onClose?: () => void;
  /** Picker: kirim berkas langsung dari perangkat tanpa menyimpannya ke galeri (mis. GIF, MOV). */
  onPickFromDevice?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState<string>(RECENT);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<GalleryAsset | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [zoom, setZoom] = useState<GalleryAsset | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const folderId = folder === RECENT ? null : Number(folder);
  const isManager = user?.role === 'admin' || user?.role === 'superadmin';
  const canModify = (asset: GalleryAsset) => isManager || asset.uploadedBy?.id === user?.id;
  const isPicker = mode === 'picker';

  const folders = useQuery({
    queryKey: ['gallery-folders', brandId],
    queryFn: () => api.get<GalleryFolders>('/gallery/folders?brandId=' + brandId),
  });

  const assets = useInfiniteQuery({
    queryKey: ['gallery-assets', brandId, folder, search],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ brandId: String(brandId) });
      if (folderId) params.set('folderId', String(folderId));
      if (search.trim()) params.set('q', search.trim());
      if (pageParam) params.set('cursor', String(pageParam));
      return api.get<GalleryAssetPage>('/gallery/assets?' + params);
    },
    initialPageParam: 0 as number,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(() => assets.data?.pages.flatMap((page) => page.items) ?? [], [assets.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['gallery-folders', brandId] });
    void queryClient.invalidateQueries({ queryKey: ['gallery-assets', brandId] });
  };
  const onError = (error: Error) => showFeedback(error.message, { error: true });

  async function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setUploading(files.length);
    let last: GalleryAsset | null = null;
    for (const file of files) {
      try {
        last = await uploadGalleryFile(brandId, file, folderId);
      } catch (error) {
        showFeedback(error instanceof Error ? error.message : 'Gagal mengunggah media.', { error: true });
      } finally {
        setUploading((count) => count - 1);
      }
    }
    refresh();
    if (last) {
      setSelected(last);
      showFeedback('Media berhasil diunggah.');
    }
  }

  const createFolder = useMutation({
    mutationFn: (name: string) => api.post<{ id: number }>('/gallery/folders', { brandId, name }),
    onSuccess: (created) => { setNewFolder(null); setFolder(String(created.id)); refresh(); },
    onError,
  });

  const updateAsset = useMutation({
    mutationFn: (input: { asset: GalleryAsset; patch: { name?: string; folderId?: number | null } }) =>
      api.patch<GalleryAsset>('/gallery/assets/' + input.asset.id, input.patch),
    onSuccess: (updated) => { setSelected(updated); setRenaming(null); refresh(); },
    onError,
  });

  const removeAsset = useMutation({
    mutationFn: (asset: GalleryAsset) => api.delete('/gallery/assets/' + asset.id),
    onSuccess: () => { setSelected(null); refresh(); showFeedback('Media dihapus.'); },
    onError,
  });

  const removeFolder = useMutation({
    mutationFn: (id: number) => api.delete('/gallery/folders/' + id),
    onSuccess: () => { setFolder(RECENT); refresh(); },
    onError,
  });

  const current = folders.data?.folders.find((f) => String(f.id) === folder);
  const folderOptions = [
    { value: NO_FOLDER, label: 'Tanpa folder' },
    ...(folders.data?.folders ?? []).map((f) => ({ value: String(f.id), label: f.name })),
  ];

  const folderButton = (id: string, label: string, count: number | undefined) => (
    <button
      key={id}
      type="button"
      onClick={() => { setFolder(id); setSelected(null); }}
      className={cn(
        'flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition md:w-full',
        folder === id ? 'bg-zinc-950 text-white' : 'text-zinc-700 hover:bg-zinc-100',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {id === RECENT && <Clock size={14} className="shrink-0" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </span>
      {count !== undefined && <span className="shrink-0 text-xs font-medium text-zinc-500">{count}</span>}
    </button>
  );

  return (
    <div className={cn('flex min-h-0 w-full min-w-0 flex-col bg-white', isPicker ? 'h-full' : 'min-h-[60vh] rounded-2xl border border-zinc-200')}>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5 sm:px-4">
        {isPicker && <h2 className="shrink-0 text-sm font-bold text-zinc-900">Galeri</h2>}
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setSelected(null); }}
            placeholder="Cari nama media"
            aria-label="Cari media berdasarkan nama"
            className="field pl-9"
          />
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={GALLERY_ACCEPT}
          className="hidden"
          onChange={(event) => { void handleFiles(event.target.files); event.target.value = ''; }}
        />
        <Button
          variant="secondary"
          onClick={() => fileInput.current?.click()}
          disabled={uploading > 0}
          aria-label="Unggah media"
          icon={uploading > 0 ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          className="shrink-0"
        >
          <span className="hidden sm:inline">{uploading > 0 ? 'Mengunggah...' : 'Unggah'}</span>
        </Button>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Tutup galeri">
            <X size={18} />
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:w-52 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
          {folderButton(RECENT, 'Unggahan terbaru', folders.data?.total)}
          {(folders.data?.folders ?? []).map((f) => folderButton(String(f.id), f.name, f.count))}
          {newFolder === null ? (
            <button
              type="button"
              onClick={() => setNewFolder('')}
              className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 md:w-full"
            >
              <FolderPlus size={14} aria-hidden="true" />Folder baru
            </button>
          ) : (
            <form
              className="flex shrink-0 items-center gap-1 md:w-full"
              onSubmit={(event) => { event.preventDefault(); if (newFolder.trim()) createFolder.mutate(newFolder.trim()); }}
            >
              <input
                autoFocus
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') setNewFolder(null); }}
                maxLength={80}
                placeholder="Nama folder"
                aria-label="Nama folder baru"
                className="field w-32 min-w-0 md:w-full"
              />
              <Button type="submit" size="icon" disabled={createFolder.isPending || !newFolder.trim()} aria-label="Simpan folder">
                <Check size={14} />
              </Button>
            </form>
          )}
          {isPicker && onPickFromDevice && (
            <button
              type="button"
              onClick={onPickFromDevice}
              className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 md:mt-auto md:w-full"
            >
              <Monitor size={14} aria-hidden="true" />Dari perangkat
            </button>
          )}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!isPicker && current && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2 text-xs sm:px-4">
              <span className="truncate font-semibold text-zinc-800">{current.name}</span>
              <button
                type="button"
                onClick={() => setPendingDelete({ kind: 'folder', id: current.id, name: current.name })}
                className="shrink-0 font-semibold text-rose-700 hover:underline"
              >
                Hapus folder
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4">
            {assets.isLoading ? (
              <p className="py-12 text-center text-xs text-zinc-500">Memuat galeri...</p>
            ) : items.length === 0 ? (
              <EmptyState icon={Images} title={search ? 'Media tidak ditemukan' : 'Belum ada media'} />
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((asset) => (
                  <GalleryAssetCard
                    key={asset.id}
                    asset={asset}
                    active={selected?.id === asset.id}
                    editable={canModify(asset)}
                    renameValue={renaming?.id === asset.id ? renaming.value : null}
                    onSelect={() => { setSelected(asset); setRenaming(null); }}
                    onOpen={() => { if (isPicker) onSelect?.(asset); else setZoom(asset); }}
                    onZoom={() => setZoom(asset)}
                    onStartRename={() => { setSelected(asset); setRenaming({ id: asset.id, value: asset.name }); }}
                    onRenameChange={(value) => setRenaming({ id: asset.id, value })}
                    onRenameCommit={(value) => {
                      const name = value.trim();
                      if (name && name !== asset.name) updateAsset.mutate({ asset, patch: { name } });
                      else setRenaming(null);
                    }}
                    onRenameCancel={() => setRenaming(null)}
                  />
                ))}
              </ul>
            )}
            {assets.hasNextPage && (
              <div className="pt-4 text-center">
                <Button variant="secondary" onClick={() => void assets.fetchNextPage()} disabled={assets.isFetchingNextPage}>
                  {assets.isFetchingNextPage ? 'Memuat...' : 'Muat lebih banyak'}
                </Button>
              </div>
            )}
          </div>

          {selected && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-3 py-2.5 sm:px-4">
              <div className="min-w-0 flex-1 text-xs text-zinc-600">
                <p className="truncate font-semibold text-zinc-900">{selected.name}</p>
                <p className="truncate">
                  {selected.uploadedBy?.name ?? 'Pengguna dihapus'} &middot; {formatGalleryWhen(selected.createdAt)} &middot; {formatFileSize(selected.size)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canModify(selected) && (
                  <>
                    <div className="w-36">
                      <Select
                        size="md"
                        value={String(selected.folderId ?? NO_FOLDER)}
                        onValueChange={(value) => updateAsset.mutate({ asset: selected, patch: { folderId: value === NO_FOLDER ? null : Number(value) } })}
                        options={folderOptions}
                        aria-label="Pindah ke folder"
                        className="w-full"
                      />
                    </div>
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={() => setPendingDelete({ kind: 'asset', asset: selected })}
                      disabled={removeAsset.isPending}
                      aria-label="Hapus media"
                      className="text-rose-700"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </>
                )}
                {isPicker && <Button onClick={() => onSelect?.(selected)}>Pilih</Button>}
              </div>
            </div>
          )}
        </div>
      </div>

      <ImageLightbox
        open={zoom !== null}
        onClose={() => setZoom(null)}
        src={zoom ? resolveMediaUrl(zoom.url) : ''}
        alt={zoom?.name ?? ''}
        video={zoom ? isVideoAsset(zoom) : false}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete?.kind === 'asset') removeAsset.mutate(pendingDelete.asset);
          if (pendingDelete?.kind === 'folder') removeFolder.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
        title={pendingDelete?.kind === 'folder' ? 'Hapus folder?' : 'Hapus media?'}
        description={pendingDelete?.kind === 'folder' ? 'Folder ' + pendingDelete.name + ' dihapus; isinya tetap ada di Unggahan terbaru.' : 'Media dihapus dari galeri untuk semua pengguna.'}
        confirmLabel="Hapus"
      />
    </div>
  );
}

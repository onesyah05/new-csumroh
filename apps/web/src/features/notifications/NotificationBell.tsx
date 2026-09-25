import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bell, Check, CheckCheck, Settings2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { businessDateKey } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { queryClient } from '../../app/query';

export type NotificationItem = {
  id: number;
  type: string;
  priority: 'info' | 'action' | 'urgent';
  title: string;
  body: string | null;
  link: string | null;
  count: number;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
  resolvedAt: string | null;
};
type Page = { items: NotificationItem[]; nextCursor: number | null };
type Filter = 'action' | 'all';
type Counts = { actionable: number; urgent: number; info: number };

export const notificationKeys = {
  all: ['notifications'] as const,
  count: ['notifications', 'count'] as const,
  list: (filter: Filter) => ['notifications', 'list', filter] as const,
};

function relativeTime(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

/**
 * Hitungan untuk lencana. Hanya yang perlu tindakan (tindakan + mendesak) diberi angka; info (mis. pesan
 * baru, yang sudah terlihat di Inbox) cukup titik, agar angka lencana tetap bermakna.
 */
function useNotificationCounts() {
  const count = useQuery({
    queryKey: notificationKeys.count,
    queryFn: () => api.get<Counts>('/notifications/unread-count'),
    staleTime: 30_000,
  });
  return { actionable: count.data?.actionable ?? 0, urgent: count.data?.urgent ?? 0, info: count.data?.info ?? 0 };
}

/** Jumlah yang perlu tindakan di judul tab, mis. "(3) CRM AZHAN". Dipasang sekali di AppShell. */
export function useNotificationTitle() {
  const { actionable } = useNotificationCounts();
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, '');
    document.title = actionable > 0 ? `(${actionable > 99 ? '99+' : actionable}) ${base}` : base;
  }, [actionable]);
}

/** Buka panel lonceng yang sedang terlihat (dipakai toast ringkasan saat notifikasi masuk beruntun). */
export const OPEN_NOTIFICATIONS_EVENT = 'notifications:open';
export function openNotificationPanel() {
  window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
}

function dayGroup(iso: string) {
  const key = businessDateKey(new Date(iso));
  if (key === businessDateKey()) return 'Hari ini';
  if (key === businessDateKey(new Date(Date.now() - 86_400_000))) return 'Kemarin';
  return 'Sebelumnya';
}

/** Tab "Perlu tindakan": Mendesak lalu Tindakan (urutan dari server). Tab "Semua": per hari (WIB). */
function groupItems(items: NotificationItem[], filter: Filter) {
  const groups: { label: string; items: NotificationItem[] }[] = [];
  for (const item of items) {
    const label = filter === 'action' ? (item.priority === 'urgent' ? 'Mendesak' : 'Tindakan') : dayGroup(item.updatedAt);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/**
 * Lonceng notifikasi dengan panel. `placement`: item pertama di sidebar (desktop, juga di Inbox yang tanpa
 * header) atau header (layar kecil). Panel dirender lewat portal ke <body>.
 */
export function NotificationBell({ placement, className }: { placement: 'sidebar' | 'header'; className?: string }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('action');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const navigate = useNavigate();

  const { actionable, urgent, info } = useNotificationCounts();
  const list = useInfiniteQuery({
    queryKey: notificationKeys.list(filter),
    queryFn: ({ pageParam }) => api.get<Page>(`/notifications?filter=${filter}&limit=20${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: open,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
  const markRead = useMutation({ mutationFn: (id: number) => api.post(`/notifications/${id}/read`), onSettled: refresh });
  const markAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSettled: refresh });

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const groups = groupItems(items, filter);

  // Tutup dengan Escape atau klik di luar; fokus kembali ke lonceng.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  // Toast ringkasan "N notifikasi baru" membuka panel; hanya lonceng yang sedang terlihat yang merespons.
  useEffect(() => {
    const onOpen = () => {
      const button = buttonRef.current;
      if (!button || button.getClientRects().length === 0) return;
      setFilter('action');
      setOpen(true);
    };
    window.addEventListener(OPEN_NOTIFICATIONS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTIFICATIONS_EVENT, onOpen);
  }, []);

  function openItem(item: NotificationItem) {
    if (!item.readAt) markRead.mutate(item.id);
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  const label = actionable
    ? `Notifikasi, ${actionable} perlu tindakan${urgent ? `, ${urgent} mendesak` : ''}`
    : info ? 'Notifikasi, ada info baru' : 'Notifikasi';
  const badgeText = actionable > 99 ? '99+' : String(actionable);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="Notifikasi"
        className={cn(
          'relative transition',
          placement === 'sidebar'
            // Sama dengan item menu sidebar: ikon saja di rail, berlabel saat sidebar melebar.
            ? cn(
              'hidden h-10 items-center rounded-xl text-sm font-medium lg:flex',
              'lg:w-10 lg:justify-center lg:gap-0 lg:px-0',
              'lg:group-hover/sidebar:w-full lg:group-hover/sidebar:justify-start lg:group-hover/sidebar:gap-3 lg:group-hover/sidebar:px-3',
              open ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-white',
            )
            : 'grid h-10 w-10 place-items-center rounded-xl text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950',
        )}
      >
        <span className="relative shrink-0">
          <Bell size={placement === 'sidebar' ? 20 : 19} strokeWidth={1.9} />
          {actionable > 0 ? (
            <span
              aria-hidden="true"
              className={cn(
                'absolute -right-2 -top-2 min-w-[18px] rounded-full px-1 text-center text-[11px] font-bold leading-[18px] tabular-nums',
                urgent ? 'bg-rose-600 text-white' : placement === 'sidebar' ? 'bg-white text-zinc-950 ring-2 ring-zinc-950' : 'bg-zinc-950 text-white',
                // Sidebar melebar: angka pindah ke pil di kanan baris agar tidak menimpa label.
                placement === 'sidebar' && 'lg:group-hover/sidebar:hidden',
              )}
            >
              {badgeText}
            </span>
          ) : info > 0 ? (
            // Hanya info: titik tanpa angka.
            <span
              aria-hidden="true"
              data-testid="notification-info-dot"
              className={cn('absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full', placement === 'sidebar' ? 'bg-white' : 'bg-zinc-950')}
            />
          ) : null}
        </span>
        {placement === 'sidebar' && (
          <>
            <span className="hidden min-w-0 flex-1 truncate whitespace-nowrap text-left lg:group-hover/sidebar:inline" aria-hidden="true">Notifikasi</span>
            {actionable > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  'hidden shrink-0 rounded-full px-2 text-[11px] font-bold leading-5 tabular-nums lg:group-hover/sidebar:inline',
                  urgent ? 'bg-rose-600 text-white' : 'bg-white text-zinc-950',
                )}
              >
                {badgeText}
              </span>
            )}
          </>
        )}
      </button>

      {/* Portal ke <body>: sidebar memakai transform + overflow-hidden yang memotong elemen fixed di dalamnya. */}
      {open && createPortal((
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Notifikasi"
          tabIndex={-1}
          className={cn(
            'fixed z-50 flex max-h-[min(640px,85vh)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-lift outline-none',
            placement === 'sidebar' ? 'left-[84px] top-4' : 'right-2 top-16 sm:right-4',
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-bold">Notifikasi</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending || actionable + info === 0}
                className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
              >
                <CheckCheck size={14} />Tandai semua dibaca
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); navigate('/pengaturan/notifikasi'); }}
                aria-label="Pengaturan notifikasi"
                title="Pengaturan notifikasi"
                className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100"
              >
                <Settings2 size={15} />
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Tutup notifikasi" className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100">
                <X size={15} />
              </button>
            </div>
          </div>
          <div role="group" aria-label="Tampilkan" className="flex gap-1 border-b border-zinc-100 px-4 py-2">
            {([['action', `Perlu tindakan${actionable ? ` (${badgeText})` : ''}`], ['all', 'Semua']] as const).map(([id, text]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={cn('min-h-7 rounded-full px-3 text-xs font-semibold', filter === id ? 'bg-zinc-950 text-white' : 'text-zinc-600 hover:bg-zinc-100')}
              >
                {text}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.isLoading ? (
              <p className="px-4 py-8 text-center text-xs text-zinc-600">Memuat notifikasi…</p>
            ) : list.isError ? (
              <p className="px-4 py-8 text-center text-xs text-rose-700" role="alert">{(list.error as Error).message}</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-zinc-600">
                {filter === 'action' ? 'Tidak ada yang perlu ditindaklanjuti.' : 'Belum ada notifikasi.'}
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h3 className="sticky top-0 z-10 border-b border-zinc-100 bg-white/95 px-4 py-1.5 text-xs font-semibold text-zinc-600 backdrop-blur-xs">
                    {group.label} <span className="font-normal tabular-nums">· {group.items.length}</span>
                  </h3>
                  <ul className="divide-y divide-zinc-100">
                    {group.items.map((item) => {
                      const unread = !item.readAt && !item.resolvedAt;
                      return (
                        <li key={item.id} className={cn('flex items-start', unread && 'bg-zinc-50/70')}>
                          <button
                            type="button"
                            onClick={() => openItem(item)}
                            className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 pr-2 text-left hover:bg-zinc-50"
                          >
                            <span aria-hidden="true" className={cn(
                              'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg',
                              item.priority === 'urgent' ? 'bg-rose-50 text-rose-700' : 'bg-zinc-100 text-zinc-600',
                            )}>
                              {item.priority === 'urgent' ? <AlertTriangle size={14} /> : <Bell size={14} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={cn('block text-sm', unread ? 'font-semibold text-zinc-950' : 'text-zinc-700')}>
                                {item.title}{item.count > 1 && <span className="font-normal text-zinc-600"> ({item.count})</span>}
                              </span>
                              {item.body && <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-600">{item.body}</span>}
                              <span className="mt-1 block text-xs text-zinc-500">
                                {relativeTime(item.updatedAt)}{item.resolvedAt ? ' · selesai' : ''}
                              </span>
                            </span>
                          </button>
                          {unread && (
                            // Aksi cepat: rapikan daftar tanpa membuka halaman tujuan.
                            <button
                              type="button"
                              onClick={() => markRead.mutate(item.id)}
                              disabled={markRead.isPending && markRead.variables === item.id}
                              aria-label={`Tandai dibaca: ${item.title}`}
                              title="Tandai dibaca"
                              className="mr-2 mt-3 grid h-7 w-7 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900"
                            >
                              <Check size={15} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
            {list.hasNextPage && (
              <div className="p-3 text-center">
                <button
                  type="button"
                  onClick={() => void list.fetchNextPage()}
                  disabled={list.isFetchingNextPage}
                  className="rounded-md px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
                >
                  {list.isFetchingNextPage ? 'Memuat…' : 'Muat lebih banyak'}
                </button>
              </div>
            )}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

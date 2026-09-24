import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bell, CheckCheck, Settings2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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

/** Jumlah notifikasi belum dibaca di judul tab, mis. "(3) CRM AZHAN". Dipasang sekali di AppShell. */
export function useNotificationTitle() {
  const count = useQuery({
    queryKey: notificationKeys.count,
    queryFn: () => api.get<{ total: number; urgent: number }>('/notifications/unread-count'),
    staleTime: 30_000,
  });
  const total = count.data?.total ?? 0;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, '');
    document.title = total > 0 ? `(${total > 99 ? '99+' : total}) ${base}` : base;
  }, [total]);
}

/**
 * Lonceng notifikasi dengan panel. `placement` menentukan posisi panel: rail sidebar (desktop, juga di
 * Inbox yang tidak punya header) atau header (layar kecil).
 */
export function NotificationBell({ placement, className }: { placement: 'sidebar' | 'header'; className?: string }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('action');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const navigate = useNavigate();

  const count = useQuery({
    queryKey: notificationKeys.count,
    queryFn: () => api.get<{ total: number; urgent: number }>('/notifications/unread-count'),
    staleTime: 30_000,
  });
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

  const total = count.data?.total ?? 0;
  const urgent = count.data?.urgent ?? 0;
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

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

  function openItem(item: NotificationItem) {
    if (!item.readAt) markRead.mutate(item.id);
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  const label = total ? `Notifikasi, ${total} belum dibaca${urgent ? `, ${urgent} mendesak` : ''}` : 'Notifikasi';

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
            // Sama dengan item menu sidebar: ikon saja di rail, berlabel saat sidebar melebar/drawer.
            ? cn(
              'flex h-10 w-full items-center justify-start gap-3 rounded-xl px-3 text-sm font-medium',
              'lg:w-10 lg:justify-center lg:gap-0 lg:px-0',
              'lg:group-hover/sidebar:w-full lg:group-hover/sidebar:justify-start lg:group-hover/sidebar:gap-3 lg:group-hover/sidebar:px-3',
              open ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-white',
            )
            : 'grid h-10 w-10 place-items-center rounded-xl text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950',
        )}
      >
        <span className="relative shrink-0">
          <Bell size={placement === 'sidebar' ? 20 : 19} strokeWidth={1.9} />
          {total > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                'absolute -right-2 -top-2 min-w-[18px] rounded-full px-1 text-center text-[11px] font-bold leading-[18px] tabular-nums',
                urgent ? 'bg-rose-600 text-white' : placement === 'sidebar' ? 'bg-white text-zinc-950 ring-2 ring-zinc-950' : 'bg-zinc-950 text-white',
              )}
            >
              {total > 99 ? '99+' : total}
            </span>
          )}
        </span>
        {placement === 'sidebar' && (
          <span className="truncate whitespace-nowrap lg:hidden lg:group-hover/sidebar:inline" aria-hidden="true">Notifikasi</span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Notifikasi"
          tabIndex={-1}
          className={cn(
            'fixed z-50 flex max-h-[min(640px,80vh)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-lift outline-none',
            placement === 'sidebar' ? 'bottom-4 left-4 lg:left-[84px]' : 'right-4 top-16',
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-bold">Notifikasi</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending || total === 0}
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
            {([['action', 'Perlu tindakan'], ['all', 'Semua']] as const).map(([id, text]) => (
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
              <ul className="divide-y divide-zinc-100">
                {items.map((item) => {
                  const unread = !item.readAt && !item.resolvedAt;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => openItem(item)}
                        className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-zinc-50', unread && 'bg-zinc-50/70')}
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
                        {unread && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-zinc-950" aria-label="Belum dibaca" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
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
      )}
    </div>
  );
}

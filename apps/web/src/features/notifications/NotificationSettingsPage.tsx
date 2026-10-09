import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Volume2 } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { queryClient } from '../../app/query';
import { showFeedback } from '../../app/toast';
import { playNotificationSound } from '../../lib/notificationSound';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/page-header';
import { PageError, PageLoading } from '../../components/ui/page-feedback';

type Preference = {
  type: string;
  group: string;
  label: string;
  description: string;
  priority: 'info' | 'action' | 'urgent';
  toast: boolean;
  sound: boolean;
  /** Dimatikan: tidak dicatat di lonceng sama sekali (tidak berlaku untuk Mendesak). */
  muted: boolean;
  locked: boolean;
};

// Kunci sendiri (bukan di bawah ['notifications']) agar tidak dimuat ulang setiap ada notifikasi masuk.
const PREFERENCES_KEY = ['notification-preferences'] as const;
const PRIORITY_LABEL = { urgent: 'Mendesak', action: 'Tindakan', info: 'Info' } as const;

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange(next: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition',
        checked ? 'border-zinc-950 bg-zinc-950' : 'border-zinc-300 bg-zinc-200',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

/**
 * Preferensi notifikasi per tipe yang relevan untuk role user. Daftar di lonceng selalu lengkap;
 * yang diatur: aktif/mati, toast (muncul di layar), dan suara. Notifikasi Mendesak selalu aktif dan tampil sebagai toast.
 */
export function NotificationSettingsPage() {
  const preferences = useQuery({ queryKey: PREFERENCES_KEY, queryFn: () => api.get<Preference[]>('/notifications/preferences') });
  const save = useMutation({
    mutationFn: (item: Pick<Preference, 'type' | 'toast' | 'sound' | 'muted'>) => api.put<Preference[]>('/notifications/preferences', { items: [item] }),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: PREFERENCES_KEY });
      const previous = queryClient.getQueryData<Preference[]>(PREFERENCES_KEY);
      queryClient.setQueryData<Preference[]>(PREFERENCES_KEY, (old) => old?.map((p) => (p.type === item.type ? { ...p, ...item } : p)));
      return { previous };
    },
    onError: (error: Error, _item, context) => {
      if (context?.previous) queryClient.setQueryData(PREFERENCES_KEY, context.previous);
      showFeedback(`Preferensi gagal disimpan: ${error.message}`, { error: true });
    },
    onSuccess: (data) => queryClient.setQueryData(PREFERENCES_KEY, data),
  });

  const groups = useMemo(() => {
    const map = new Map<string, Preference[]>();
    for (const p of preferences.data ?? []) map.set(p.group, [...(map.get(p.group) ?? []), p]);
    return [...map];
  }, [preferences.data]);

  if (preferences.isLoading) return <PageLoading label="Memuat pengaturan notifikasi…" />;
  if (preferences.isError) return <PageError description={preferences.error.message} onRetry={() => void preferences.refetch()} />;

  const update = (p: Preference, patch: Partial<Pick<Preference, 'toast' | 'sound' | 'muted'>>) =>
    save.mutate({ type: p.type, toast: patch.toast ?? p.toast, sound: patch.sound ?? p.sound, muted: patch.muted ?? p.muted });

  return (
    <div className="app-page space-y-4 md:space-y-6">
      <div className="flex justify-end md:hidden">
        <Button
          variant="secondary"
          size="sm"
          icon={<Volume2 size={14} />}
          onClick={() => { if (!playNotificationSound({ force: true })) showFeedback('Browser ini tidak mengizinkan suara.', { error: true }); }}
        >
          Uji suara
        </Button>
      </div>
      <PageHeader
        className="hidden md:flex"
        title="Pengaturan Notifikasi"
        subtitle="Atur jenis notifikasi yang aktif, yang muncul di layar (toast), dan yang berbunyi. Jenis yang dimatikan tidak dicatat di lonceng."
        actions={
          <Button
            variant="secondary"
            icon={<Volume2 size={14} />}
            onClick={() => { if (!playNotificationSound({ force: true })) showFeedback('Browser ini tidak mengizinkan suara.', { error: true }); }}
          >
            Uji suara
          </Button>
        }
      />

      {groups.map(([group, items]) => (
        <section key={group} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <header className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50/75 px-4 py-2.5">
            <h2 className="text-sm font-bold text-zinc-900">{group}</h2>
            <div className="flex gap-3 text-xs font-semibold text-zinc-600 sm:gap-6" aria-hidden="true">
              <span className="w-11 text-center">Aktif</span>
              <span className="w-11 text-center">Toast</span>
              <span className="w-11 text-center">Suara</span>
            </div>
          </header>
          <ul className="divide-y divide-zinc-100">
            {items.map((p) => (
              <li key={p.type} className={cn('flex items-center gap-3 px-4 py-3', p.muted && 'bg-zinc-50/70')}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900">
                    {p.label}
                    <span className={cn(
                      'mt-1 block w-fit whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold sm:ml-2 sm:mt-0 sm:inline sm:align-middle',
                      p.priority === 'urgent' ? 'bg-rose-50 text-rose-700' : 'hidden bg-zinc-100 text-zinc-600 sm:inline',
                    )}>
                      {PRIORITY_LABEL[p.priority]}
                    </span>
                  </p>
                  <p className="mt-0.5 hidden text-xs text-zinc-600 sm:block">
                    {p.description}{p.locked ? ' Selalu aktif dan muncul di layar.' : p.muted ? ' Dimatikan: tidak dicatat di lonceng.' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 sm:gap-6">
                  <span className="flex items-center">
                    <Toggle checked={!p.muted} disabled={p.locked} label={`Aktifkan notifikasi: ${p.label}`} onChange={(active) => update(p, { muted: !active })} />
                  </span>
                  <span className="flex items-center">
                    <Toggle checked={p.toast && !p.muted} disabled={p.locked || p.muted} label={`Tampilkan toast: ${p.label}`} onChange={(toast) => update(p, { toast })} />
                  </span>
                  <span className="flex items-center">
                    <Toggle checked={p.sound && !p.muted} disabled={p.muted} label={`Bunyikan suara: ${p.label}`} onChange={(sound) => update(p, { sound })} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

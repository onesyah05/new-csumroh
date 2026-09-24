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
 * yang diatur hanya toast (muncul di layar) dan suara. Notifikasi Mendesak selalu muncul sebagai toast.
 */
export function NotificationSettingsPage() {
  const preferences = useQuery({ queryKey: PREFERENCES_KEY, queryFn: () => api.get<Preference[]>('/notifications/preferences') });
  const save = useMutation({
    mutationFn: (item: Pick<Preference, 'type' | 'toast' | 'sound'>) => api.put<Preference[]>('/notifications/preferences', { items: [item] }),
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

  const update = (p: Preference, patch: Partial<Pick<Preference, 'toast' | 'sound'>>) =>
    save.mutate({ type: p.type, toast: patch.toast ?? p.toast, sound: patch.sound ?? p.sound });

  return (
    <div className="app-page space-y-6">
      <PageHeader
        title="Pengaturan Notifikasi"
        subtitle="Semua notifikasi tetap tercatat di lonceng. Atur mana yang muncul di layar (toast) dan berbunyi."
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
            <div className="hidden gap-6 pr-1 text-xs font-semibold text-zinc-600 sm:flex" aria-hidden="true">
              <span className="w-11 text-center">Toast</span>
              <span className="w-11 text-center">Suara</span>
            </div>
          </header>
          <ul className="divide-y divide-zinc-100">
            {items.map((p) => (
              <li key={p.type} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900">
                    {p.label}
                    <span className={cn(
                      'ml-2 rounded-full px-2 py-0.5 align-middle text-xs font-semibold',
                      p.priority === 'urgent' ? 'bg-rose-50 text-rose-700' : 'bg-zinc-100 text-zinc-600',
                    )}>
                      {PRIORITY_LABEL[p.priority]}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {p.description}{p.locked ? ' Selalu muncul di layar.' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-6">
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-zinc-600 sm:hidden">Toast</span>
                    <Toggle checked={p.toast} disabled={p.locked} label={`Tampilkan toast: ${p.label}`} onChange={(toast) => update(p, { toast })} />
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-zinc-600 sm:hidden">Suara</span>
                    <Toggle checked={p.sound} label={`Bunyikan suara: ${p.label}`} onChange={(sound) => update(p, { sound })} />
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

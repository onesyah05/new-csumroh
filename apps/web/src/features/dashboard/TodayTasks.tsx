import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

type Task = { key: string; label: string; count: number; hint: string | null; link: string; action?: string; tone: 'urgent' | 'action' | 'clear' };
type WaitingItem = { id: number; brandId: number; brandName: string | null; name: string; waitedMinutes: number; picName: string | null; link: string };
type Tasks = { role: string; tasks: Task[]; waiting: { title: string; items: WaitingItem[] } | null };

function waited(minutes: number) {
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} jam` : `${Math.floor(hours / 24)} hari`;
}

/**
 * "Perlu ditindaklanjuti": satu panel berisi baris masalah yang masih terbuka (mendesak lebih dulu),
 * masing-masing dengan angka, penjelasan singkat, dan satu tombol aksi. Yang sudah beres tidak ditampilkan.
 * Di samping: daftar jamaah/bukti yang menunggu paling lama.
 */
export function TodayTasks({ scope }: { scope: string }) {
  const tasks = useQuery({
    queryKey: ['dashboard', 'tasks', scope],
    queryFn: () => api.get<Tasks>(`/dashboard/tasks${scope}`),
    refetchInterval: 60_000,
  });

  if (tasks.isLoading) {
    return <section aria-busy="true" className="surface h-24 animate-pulse" aria-label="Memuat daftar tindak lanjut" />;
  }
  if (tasks.isError || !Array.isArray(tasks.data?.tasks)) {
    return (
      <section className="surface p-4 text-xs text-zinc-600" role="alert">
        Daftar tindak lanjut tidak dapat dimuat.{' '}
        <button type="button" onClick={() => void tasks.refetch()} className="font-semibold text-zinc-900 underline">Coba lagi</button>
      </section>
    );
  }

  const order = { urgent: 0, action: 1, clear: 2 } as const;
  const pending = tasks.data!.tasks.filter((t) => t.tone !== 'clear').sort((a, b) => order[a.tone] - order[b.tone]);
  const waiting = tasks.data!.waiting;

  if (pending.length === 0 && !waiting) {
    return (
      <section aria-labelledby="today-tasks" className="surface flex items-center gap-3 px-5 py-4">
        <CheckCircle2 size={18} className="shrink-0 text-emerald-700" aria-hidden="true" />
        <p className="text-sm text-zinc-700">
          <span id="today-tasks" className="font-semibold text-zinc-950">Tidak ada yang perlu ditindaklanjuti.</span>{' '}
          Tidak ada tugas tertunda pada cakupan yang Anda lihat.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="today-tasks" className={cn('surface grid overflow-hidden', waiting && 'lg:grid-cols-[minmax(0,1fr)_320px]')}>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3 border-b border-zinc-200 px-5 py-3">
          <h2 id="today-tasks" className="text-sm font-bold text-zinc-950">Perlu ditindaklanjuti</h2>
          <span className="text-xs text-zinc-600">{pending.length ? `${pending.length} hal` : 'Semua beres'}</span>
        </div>
        {pending.length > 0 ? (
          <ul className="divide-y divide-zinc-100">
            {pending.map((t) => (
              <li key={t.key}>
                <Link to={t.link} className="group flex items-center gap-3 px-4 py-4 sm:gap-4 sm:px-5 sm:py-3 transition hover:bg-zinc-50">
                  <span
                    className={cn(
                      'w-10 shrink-0 text-right text-xl font-bold leading-none tabular-nums',
                      t.tone === 'urgent' ? 'text-rose-700' : 'text-zinc-950',
                    )}
                  >
                    {t.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                      {t.label}
                      {t.tone === 'urgent' && (
                        <>
                          {/* HP: ikon (bukan hanya warna angka); layar lebar: label. */}
                          <AlertTriangle size={13} className="shrink-0 text-rose-700 sm:hidden" aria-hidden="true" />
                          <span className="sr-only sm:not-sr-only sm:shrink-0 sm:rounded-full sm:bg-rose-50 sm:px-1.5 sm:py-px sm:text-xs sm:font-semibold sm:text-rose-700 sm:ring-1 sm:ring-inset sm:ring-rose-200">Mendesak</span>
                        </>
                      )}
                    </span>
                    {t.hint && <span className="mt-0.5 block text-xs text-zinc-600">{t.hint}</span>}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-lg sm:border border-zinc-200 sm:px-2.5 py-1 text-xs font-semibold text-zinc-800 transition group-hover:border-zinc-400 group-hover:text-zinc-950">
                    <span className="hidden sm:inline">{t.action ?? 'Buka'}</span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 px-5 py-4 text-sm text-zinc-700">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-700" aria-hidden="true" />Tidak ada masalah terbuka.
          </p>
        )}
      </div>

      {waiting && (
        <aside className="border-t border-zinc-200 lg:border-l lg:border-t-0" aria-label={waiting.title}>
          <h3 className="border-b border-zinc-200 px-4 py-3 text-xs font-bold text-zinc-900">{waiting.title}</h3>
          <ol className="divide-y divide-zinc-100">
            {waiting.items.map((item) => (
              <li key={`${item.brandId}-${item.id}`}>
                <Link to={item.link} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-900">{item.name}</span>
                    <span className="block truncate text-xs text-zinc-600">
                      {[item.brandName, item.picName && `PIC ${item.picName}`].filter(Boolean).join(' · ') || 'Buka percakapan'}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums text-zinc-700">
                    <Clock size={12} aria-hidden="true" />{waited(item.waitedMinutes)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </section>
  );
}

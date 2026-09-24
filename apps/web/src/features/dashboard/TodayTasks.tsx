import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

type Task = { key: string; label: string; count: number; hint: string | null; link: string; tone: 'urgent' | 'action' | 'clear' };
type WaitingItem = { id: number; brandId: number; brandName: string | null; name: string; waitedMinutes: number; picName: string | null; link: string };
type Tasks = { role: string; tasks: Task[]; waiting: { title: string; items: WaitingItem[] } | null };

function waited(minutes: number) {
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} jam` : `${Math.floor(hours / 24)} hari`;
}

/**
 * "Perlu dikerjakan sekarang": daftar kerja sesuai role (CS: jamaah & follow-up miliknya; Finance: bukti,
 * refund; Admin: SLA, lead tanpa PIC, perangkat). Yang mendesak diurutkan lebih dulu, yang beres diredupkan.
 */
export function TodayTasks({ scope }: { scope: string }) {
  const tasks = useQuery({
    queryKey: ['dashboard', 'tasks', scope],
    queryFn: () => api.get<Tasks>(`/dashboard/tasks${scope}`),
    refetchInterval: 60_000,
  });

  if (tasks.isLoading) {
    return <section aria-busy="true" className="surface h-28 animate-pulse" aria-label="Memuat daftar kerja" />;
  }
  if (tasks.isError || !Array.isArray(tasks.data?.tasks)) {
    return (
      <section className="surface p-4 text-xs text-zinc-600" role="alert">
        Daftar kerja tidak dapat dimuat.{' '}
        <button type="button" onClick={() => void tasks.refetch()} className="font-semibold text-zinc-900 underline">Coba lagi</button>
      </section>
    );
  }

  const order = { urgent: 0, action: 1, clear: 2 } as const;
  const sorted = [...tasks.data!.tasks].sort((a, b) => order[a.tone] - order[b.tone]);
  const pending = sorted.filter((t) => t.tone !== 'clear');
  const waiting = tasks.data!.waiting;

  return (
    <section aria-labelledby="today-tasks" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="today-tasks" className="text-sm font-bold text-zinc-950">Perlu dikerjakan sekarang</h2>
        {pending.length === 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600">
            <CheckCircle2 size={14} aria-hidden="true" />Semua beres
          </span>
        )}
      </div>

      <div className={cn('grid gap-3', waiting ? 'lg:grid-cols-[minmax(0,1fr)_340px]' : '')}>
        <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((t) => (
            <li key={t.key}>
              <Link
                to={t.link}
                className={cn(
                  'group flex h-full items-start gap-3 rounded-xl border bg-white p-3.5 transition hover:shadow-xs',
                  t.tone === 'urgent' && 'border-rose-300 hover:border-rose-400',
                  t.tone === 'action' && 'border-zinc-300 hover:border-zinc-400',
                  t.tone === 'clear' && 'border-zinc-200 text-zinc-600 hover:border-zinc-300',
                )}
              >
                <span
                  className={cn(
                    'min-w-[2.5rem] text-2xl font-bold leading-none tabular-nums',
                    t.tone === 'urgent' ? 'text-rose-700' : t.tone === 'action' ? 'text-zinc-950' : 'text-zinc-500',
                  )}
                >
                  {t.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('flex items-center gap-1 text-sm font-semibold', t.tone === 'clear' ? 'text-zinc-600' : 'text-zinc-900')}>
                    {t.tone === 'urgent' && <AlertTriangle size={13} className="shrink-0 text-rose-700" aria-label="Mendesak" />}
                    {t.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-600">{t.tone === 'clear' ? 'Tidak ada' : t.hint ?? 'Buka untuk menindaklanjuti'}</span>
                </span>
                <ChevronRight size={16} className="mt-0.5 shrink-0 text-zinc-500 transition group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>

        {waiting && (
          <aside className="surface overflow-hidden" aria-label={waiting.title}>
            <h3 className="border-b border-zinc-200 px-4 py-2.5 text-xs font-bold text-zinc-900">{waiting.title}</h3>
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
      </div>
    </section>
  );
}

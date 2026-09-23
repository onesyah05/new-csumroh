import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, BookOpen, Check, ChevronRight, Circle, Clock3, GraduationCap, Lightbulb, Target } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';

function loadProgress() {
  try {
    const stored = JSON.parse(localStorage.getItem('csumroh_lms_progress') ?? '[]');
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function LmsPage() {
  const course = useQuery({ queryKey: ['lms'], queryFn: () => api.get<any>('/scripts/lms') });
  const [active, setActive] = useState(0);
  const [done, setDone] = useState<string[]>(loadProgress);

  useEffect(() => {
    localStorage.setItem('csumroh_lms_progress', JSON.stringify(done));
  }, [done]);

  const stages = (course.data?.stages ?? []) as any[];
  const module = stages[active];
  const progress = stages.length ? Math.round((done.length / stages.length) * 100) : 0;

  const content = useMemo(() => {
    if (!module) return [];
    return Object.entries(module)
      .filter(([key, value]) => !['id', 'urutan', 'nama'].includes(key) && value)
      .slice(0, 6);
  }, [module]);

  function complete() {
    if (module && !done.includes(module.id)) {
      setDone([...done, module.id]);
    }
    if (active < stages.length - 1) {
      setActive(active + 1);
    }
  }

  if (course.isLoading) return <PageLoading label="Memuat materi akademi CS..." />;
  if (course.isError) return <PageError description={course.error.message} onRetry={() => void course.refetch()} />;

  return (
    <div className="app-page space-y-6">
      <PageHeader
        title="Akademi CS"
        subtitle="Kurikulum praktis alur konsultasi calon jamaah dari sapaan awal hingga closing yang amanah."
        actions={
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2 shadow-xs">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-4 text-xs">
                <span className="text-zinc-500 font-medium">Progres Belajar</span>
                <span className="font-mono font-bold text-zinc-950 text-xs">{progress}%</span>
              </div>
              <div
                className="h-1.5 w-36 rounded-full bg-zinc-100 overflow-hidden"
                role="progressbar"
                aria-label="Progres belajar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-zinc-950 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        }
      />

      {/* 2 Column Layout: Modules Sidebar + Lesson Content */}
      <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
        <aside className="surface h-fit overflow-hidden">
          <div className="border-b border-zinc-200/90 px-4 py-3.5">
            <h3 className="font-sans text-sm font-semibold text-zinc-950">Daftar Modul</h3>
            <p className="mt-0.5 text-xs text-zinc-400">9 bab conversion cycle</p>
          </div>
          <div className="max-h-[620px] overflow-y-auto p-2 space-y-1">
            {stages.map((item, index) => {
              const isCompleted = done.includes(item.id);
              const isActive = active === index;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(index)}
                  className={`flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition ${
                    isActive ? 'bg-zinc-950 text-white shadow-xs' : 'hover:bg-zinc-100/80 text-zinc-700'
                  }`}
                >
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-semibold ${
                      isActive
                        ? 'bg-white text-black'
                        : isCompleted
                        ? 'bg-zinc-200 text-zinc-800'
                        : 'bg-zinc-100 text-zinc-500'
                    }`}
                  >
                    {isCompleted ? <Check size={13} strokeWidth={2.5} /> : index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-xs font-medium">{item.nama}</b>
                    <span className={`block text-[10px] ${isActive ? 'text-zinc-400' : 'text-zinc-400'}`}>
                      ± 8 menit
                    </span>
                  </div>
                  <ChevronRight size={13} className={isActive ? 'text-zinc-400' : 'text-zinc-300'} />
                </button>
              );
            })}
          </div>
        </aside>

        <section className="surface min-w-0 p-6 sm:p-8">
          {module ? (
            <>
              <div className="flex flex-col justify-between gap-4 border-b border-zinc-200/90 pb-6 sm:flex-row sm:items-start">
                <div>
                  <p className="text-xs font-medium text-zinc-400">
                    Modul {active + 1} · Conversion Cycle
                  </p>
                  <h3 className="mt-1.5 font-sans text-2xl font-bold tracking-tight text-zinc-950">
                    {module.nama}
                  </h3>
                  <p className="mt-2 max-w-3xl text-xs sm:text-sm leading-relaxed text-zinc-600">
                    {module.tujuan || module.deskripsi}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-2xs">
                  <Clock3 size={13} />
                  <span>8 menit</span>
                </span>
              </div>

              <div className="mt-6 space-y-4">
                {content.map(([key, value], index) => (
                  <section key={key} className="rounded-xl border border-zinc-200/90 bg-zinc-50/50 p-5">
                    <div className="flex items-start gap-3.5">
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white border border-zinc-200 text-zinc-700 shadow-2xs">
                        {index === 0 ? <Target size={14} /> : index === 1 ? <Lightbulb size={14} /> : <BookOpen size={14} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-sans text-xs sm:text-sm font-semibold text-zinc-950 capitalize">
                          {key.replaceAll('_', ' ')}
                        </h4>
                        {Array.isArray(value) ? (
                          <ul className="mt-2.5 space-y-2">
                            {value.slice(0, 6).map((line: any, i: number) => (
                              <li key={i} className="flex gap-2 text-xs sm:text-sm leading-relaxed text-zinc-600">
                                <Circle size={5} className="mt-2 shrink-0 fill-zinc-400 text-zinc-400" />
                                <span>{typeof line === 'string' ? line : JSON.stringify(line)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-xs sm:text-sm leading-relaxed text-zinc-600">
                            {typeof value === 'string' ? value : JSON.stringify(value)}
                          </p>
                        )}
                      </div>
                    </div>
                  </section>
                ))}
              </div>

              <div className="mt-7 flex flex-col items-start justify-between gap-3 border-t border-zinc-200/90 pt-5 sm:flex-row sm:items-center">
                <p className="text-xs text-zinc-400">Pelajari materi sebelum menandai selesai.</p>
                <Button onClick={complete}>
                  {done.includes(module.id) ? <Check size={14} /> : <Award size={14} />}
                  <span>{done.includes(module.id) ? 'Sudah Selesai' : 'Tandai Selesai'}</span>
                </Button>
              </div>
            </>
          ) : (
            <div className="grid min-h-96 place-items-center text-xs text-zinc-400">
              Materi belum tersedia.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

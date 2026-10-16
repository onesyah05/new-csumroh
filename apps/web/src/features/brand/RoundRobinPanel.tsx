import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Shuffle } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { showFeedback } from '../../app/toast';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { Toggle } from '../../components/ui/toggle';

interface Member { userId: number; name: string; percent: number; assignedCount: number }
interface RoundRobinSettings { enabled: boolean; total: number; members: Member[] }

/** Persen dari isian: kosong/tidak valid = 0, dibatasi 0–100 dan bilangan bulat. */
export const parsePercent = (value: string) => {
  const n = Math.floor(Number(value.replace(/\D/g, '')));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
};

/** Isian jatah satu CS dibatasi sisa persen yang belum dipakai CS lain, jadi total tidak bisa melebihi 100%. */
const capShare = (raw: string, room: number) => {
  const digits = raw.replace(/\D/g, '').slice(0, 3);
  return digits === '' ? '' : String(Math.min(parsePercent(digits), Math.max(0, room)));
};

/** Pembagian otomatis prospek baru ke CS sesuai persen (Admin & Superadmin). */
export function RoundRobinPanel({ brandId }: { brandId: number }) {
  const queryClient = useQueryClient();
  const key = ['round-robin', brandId];
  const query = useQuery({ queryKey: key, queryFn: () => api.get<RoundRobinSettings>(`/catalog/brands/${brandId}/round-robin`) });
  const [enabled, setEnabled] = useState(false);
  const [draft, setDraft] = useState<Record<number, string>>({});

  // Isi ulang dari server hanya saat setelan berubah (muat awal, setelah simpan). Angka "Terbagi" yang naik karena lead
  // baru tidak termasuk, jadi isian yang belum disimpan tidak terhapus oleh pemuatan ulang.
  const settingsKey = query.data ? `${query.data.enabled}|${query.data.members.map((m) => `${m.userId}:${m.percent}`).join(',')}` : '';
  useEffect(() => {
    if (!query.data) return;
    setEnabled(query.data.enabled);
    setDraft(Object.fromEntries(query.data.members.map((m) => [m.userId, String(m.percent)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  const members = query.data?.members ?? [];
  const percentOf = (userId: number) => parsePercent(draft[userId] ?? '0');
  const total = members.reduce((sum, m) => sum + percentOf(m.userId), 0);
  const dirty = Boolean(query.data) && (enabled !== query.data!.enabled || members.some((m) => percentOf(m.userId) !== m.percent));
  const invalid = total > 100 || (enabled && total !== 100) || (enabled && members.length === 0);
  const hint = useMemo(() => {
    if (!members.length) return '';
    if (total > 100) return `Kelebihan ${total - 100}%. Total tidak boleh lebih dari 100%.`;
    if (total === 100) return 'Total 100%.';
    return enabled ? `Kurang ${100 - total}% untuk bisa disimpan.` : `Sisa ${100 - total}%.`;
  }, [members.length, total, enabled]);

  const save = useMutation({
    mutationFn: () => api.put<RoundRobinSettings>(`/catalog/brands/${brandId}/round-robin`, {
      enabled,
      shares: members.map((m) => ({ userId: m.userId, percent: percentOf(m.userId) })),
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      showFeedback(data.enabled ? 'Round robin aktif. Hitungan pembagian dimulai dari nol.' : 'Pengaturan round robin disimpan (nonaktif).');
    },
    onError: (error: Error) => showFeedback(error.message || 'Gagal menyimpan round robin.'),
  });

  if (query.isLoading) return <PageLoading label="Memuat pembagian CS…" />;
  if (query.isError || !query.data) return <PageError title="Pembagian CS gagal dimuat" description={(query.error as Error)?.message} onRetry={() => void query.refetch()} />;

  return (
    <div role="tabpanel" id="brand-panel-roundrobin" aria-labelledby="brand-tab-roundrobin" className="max-w-2xl space-y-4">
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <Shuffle size={17} className="mt-0.5 shrink-0 text-zinc-600" aria-hidden="true" />
            <div className="min-w-0">
              <p id="round-robin-label" className="text-sm font-semibold text-zinc-950">Round robin CS</p>
            </div>
          </div>
          <Toggle checked={enabled} label="Aktifkan round robin CS" onChange={setEnabled} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <span>CS</span>
            <span className="flex items-center gap-6"><span>Terbagi</span><span className="w-20 text-right">Jatah (%)</span></span>
          </div>
          {members.length === 0 ? (
            <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">Belum ada CS aktif di brand ini. Tambahkan CS di menu Staf.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <label htmlFor={`rr-${m.userId}`} className="min-w-0 truncate text-sm font-medium text-zinc-900">{m.name}</label>
                  <span className="flex shrink-0 items-center gap-6">
                    <span className="text-sm tabular-nums text-zinc-600" title="Prospek yang sudah dibagi sejak setelan terakhir disimpan">{m.assignedCount}</span>
                    <input
                      id={`rr-${m.userId}`}
                      className="field h-10 w-20 text-right tabular-nums disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!enabled}
                      inputMode="numeric"
                      autoComplete="off"
                      value={draft[m.userId] ?? '0'}
                      onChange={(event) => setDraft((prev) => ({ ...prev, [m.userId]: capShare(event.target.value, 100 - (total - percentOf(m.userId))) }))}
                      onBlur={() => setDraft((prev) => ({ ...prev, [m.userId]: String(percentOf(m.userId)) }))}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className={cn('text-sm font-semibold tabular-nums', invalid ? 'text-rose-700' : 'text-zinc-700')}>
            Total {total}%{hint && <span className="font-normal text-zinc-600"> · {hint}</span>}
          </p>
          <Button type="button" className="w-full gap-2 sm:w-auto" disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={15} />}
            {save.isPending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

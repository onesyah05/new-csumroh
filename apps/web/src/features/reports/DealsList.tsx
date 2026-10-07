import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download, MessageCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/button';
import { showFeedback } from '../../app/toast';
import { rupiah, wibDateTime } from '../finance/verificationApi';

export type DealBasis = 'verified' | 'lead';
export type DealRow = {
  id: number; brandId: number; brand: string; name: string; phone: string | null;
  packageName: string | null; dealValue: number; source: string; adName: string | null;
  pic: string | null; lastCs: { name: string | null; at: string } | null;
  leadAt: string; verifiedAt: string | null; daysToDeal: number | null;
};
type DaysToDeal = { avg: number; median: number; min: number; max: number };
type DealsReport = { basis: DealBasis; summary: { deals: number; dealValue: number; daysToDeal?: DaysToDeal | null }; rows: DealRow[] };

const dayText = (value: number) => `${value.toLocaleString('id-ID')} hari`;

const BASIS_OPTIONS: { value: DealBasis; label: string; hint: string }[] = [
  { value: 'verified', label: 'Tanggal verifikasi', hint: 'Deal yang pembayaran pertamanya diverifikasi pada periode ini (sama dengan kartu Deal).' },
  { value: 'lead', label: 'Tanggal lead masuk', hint: 'Lead yang masuk pada periode ini dan sekarang sudah Deal, kapan pun diverifikasi.' },
];

const dateOnly = (value: string) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(value));

/** Daftar prospek deal di tab Penjualan, dengan PIC dan CS terakhir yang membalas. */
export function DealsList({ query }: { query: string }) {
  const [basis, setBasis] = useState<DealBasis>('verified');
  const [downloading, setDownloading] = useState(false);
  const deals = useQuery({
    queryKey: ['report', 'deals', query, basis],
    queryFn: () => api.get<DealsReport>(`/reports/deals?${query}&basis=${basis}`),
    placeholderData: keepPreviousData,
  });

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await api.blob(`/api/v1/reports/deals?${query}&basis=${basis}&format=csv`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `laporan-daftar-deal-${basis === 'lead' ? 'per-lead-masuk' : 'per-verifikasi'}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showFeedback((error as Error).message, { error: true });
    } finally {
      setDownloading(false);
    }
  };

  const data = deals.data;
  const hint = BASIS_OPTIONS.find((o) => o.value === basis)!.hint;
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white" aria-label="Daftar deal">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50/75 px-4 py-2.5">
        <h2 className="text-xs font-semibold text-zinc-600">
          Daftar deal{data ? ` · ${data.summary.deals} deal · ${rupiah(data.summary.dealValue)}` : ''}
        </h2>
        <div role="radiogroup" aria-label="Hitung deal berdasarkan" className="ml-auto flex rounded-lg border border-zinc-200 bg-white p-0.5">
          {BASIS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={basis === option.value}
              onClick={() => setBasis(option.value)}
              title={option.hint}
              className={cn('whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium', basis === option.value ? 'bg-zinc-950 text-white' : 'text-zinc-600 hover:text-zinc-950')}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={() => void download()} loading={downloading} disabled={!data?.rows?.length} icon={<Download size={13} />}>
          CSV
        </Button>
      </header>
      <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">{hint}</p>
      {data?.summary.daysToDeal && (
        <dl className="grid grid-cols-2 gap-px border-b border-zinc-100 bg-zinc-100 sm:grid-cols-4" aria-label="Lama lead masuk sampai deal">
          {([
            ['Rata-rata lead → deal', data.summary.daysToDeal.avg],
            ['Median', data.summary.daysToDeal.median],
            ['Tercepat', data.summary.daysToDeal.min],
            ['Terlama', data.summary.daysToDeal.max],
          ] as const).map(([label, value]) => (
            <div key={label} className="bg-white px-4 py-2.5">
              <dt className="text-xs text-zinc-500">{label}</dt>
              <dd className="text-sm font-semibold tabular-nums text-zinc-950">{dayText(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {deals.isLoading ? (
        <p className="px-4 py-6 text-center text-xs text-zinc-500">Memuat daftar deal…</p>
      ) : deals.isError ? (
        <p className="px-4 py-6 text-center text-xs text-rose-600">{deals.error.message}</p>
      ) : !data?.rows?.length ? (
        <p className="px-4 py-6 text-center text-xs text-zinc-500">Belum ada deal pada periode ini.</p>
      ) : (
        <ul className={cn('divide-y divide-zinc-100', deals.isFetching && 'opacity-60')}>
          {data.rows.map((d) => (
            <li key={d.id} className="grid gap-2 px-4 py-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-4">
              <div className="min-w-0">
                <Link to={`/prospects/${d.id}`} className="block truncate text-sm font-semibold text-zinc-950 hover:underline">{d.name}</Link>
                <p className="truncate whitespace-nowrap font-mono text-xs text-zinc-500">{d.phone ? `+${d.phone}` : '—'} · {d.brand}</p>
              </div>
              <div className="min-w-0 text-xs">
                <p className="whitespace-nowrap font-semibold tabular-nums text-zinc-950">{rupiah(d.dealValue)}</p>
                <p className="truncate whitespace-nowrap text-zinc-500" title={d.packageName ?? undefined}>{d.packageName ?? 'Layanan custom'}</p>
                <p className="truncate whitespace-nowrap text-zinc-500" title={d.adName ?? undefined}>{d.source}{d.adName ? ` · ${d.adName}` : ''}</p>
              </div>
              <div className="min-w-0 text-xs text-zinc-500">
                <p className="truncate whitespace-nowrap">PIC: <span className="text-zinc-800">{d.pic ?? 'Belum ada'}</span></p>
                <p className="truncate whitespace-nowrap">
                  CS terakhir: <span className="text-zinc-800">{d.lastCs?.name ?? '—'}</span>
                </p>
                {d.lastCs && <p className="whitespace-nowrap">{wibDateTime(d.lastCs.at)}</p>}
              </div>
              <div className="min-w-0 text-xs text-zinc-500">
                <p className="whitespace-nowrap">Lead masuk <span className="text-zinc-800">{dateOnly(d.leadAt)}</span></p>
                <p className="whitespace-nowrap">Diverifikasi <span className="text-zinc-800">{d.verifiedAt ? dateOnly(d.verifiedAt) : '—'}</span></p>
                {d.daysToDeal !== null && <p className="whitespace-nowrap">{dayText(d.daysToDeal)} ke deal</p>}
              </div>
              <Link
                to={`/inbox?prospectId=${d.id}&brandId=${d.brandId}`}
                className="inline-flex items-center gap-1.5 justify-self-start whitespace-nowrap rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 lg:justify-self-end"
              >
                <MessageCircle size={13} aria-hidden="true" />Buka chat
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

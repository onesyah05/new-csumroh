import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download, History, Pencil, Search, Undo2 } from 'lucide-react';
import { businessDateKey, type PaymentHistoryStatus } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useAuth } from '../../app/auth';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { EmptyState, PageError, PageLoading } from '../../components/ui/page-feedback';
import { PrivateProofThumb } from '../chat/PrivateProof';
import { CorrectPaymentDialog, ReversePaymentDialog } from './PaymentAdminDialogs';
import { dateLabel, historyQuery, rupiah, wibDateTime, type HistoryFilter, type HistoryPage, type HistoryRow } from './verificationApi';

const STATUS_OPTIONS: { value: PaymentHistoryStatus; label: string }[] = [
  { value: 'all', label: 'Semua status' },
  { value: 'verified', label: 'Terverifikasi' },
  { value: 'rejected', label: 'Ditolak' },
  { value: 'reversed', label: 'Dibatalkan' },
];
const STATUS_TAG: Record<HistoryRow['status'], { label: string; className: string }> = {
  verified: { label: 'Terverifikasi', className: 'bg-emerald-50 text-emerald-800' },
  rejected: { label: 'Ditolak', className: 'bg-rose-50 text-rose-800' },
  reversed: { label: 'Dibatalkan', className: 'bg-zinc-100 text-zinc-700' },
};

const monthStart = () => `${businessDateKey().slice(0, 8)}01`;

function RowDetail({ row }: { row: HistoryRow }) {
  if (row.status === 'rejected') {
    return <p className="text-xs text-zinc-700"><span className="text-zinc-500">Alasan:</span> {row.reason}</p>;
  }
  return (
    <div className="text-xs text-zinc-600">
      <p className="truncate">{row.bankName}{row.referenceNo ? <> · <span className="font-mono">{row.referenceNo}</span></> : ' · tanpa ref'}</p>
      <p>Mutasi {row.mutationDate ? dateLabel(row.mutationDate) : '—'}{row.correctedAt ? ' · dikoreksi' : ''}</p>
      {row.status === 'reversed' && <p className="text-zinc-700"><span className="text-zinc-500">Dibatalkan{row.reversedBy ? ` ${row.reversedBy}` : ''}:</span> {row.reason}</p>}
    </div>
  );
}

/**
 * Riwayat Finance: pembayaran terverifikasi, dibatalkan, dan bukti ditolak. Filter rentang tanggal/status/cari,
 * total per bank untuk rekonsiliasi rekening koran, dan unduh CSV sesuai filter. Superadmin dapat mengoreksi/membatalkan.
 */
export function VerificationHistory({ brandScope, onShowToast }: { brandScope: string; onShowToast(message: string): void }) {
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';
  const [status, setStatus] = useState<PaymentHistoryStatus>('all');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => businessDateKey());
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [correcting, setCorrecting] = useState<HistoryRow | null>(null);
  const [reversing, setReversing] = useState<HistoryRow | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [brandScope, status, from, to, q]);

  const filter: HistoryFilter = { status, from, to, q };
  const history = useQuery({
    queryKey: ['verification-history', brandScope, filter, page],
    queryFn: () => api.get<HistoryPage>(`/verification/history?${historyQuery(brandScope, filter, page)}`),
    placeholderData: keepPreviousData,
  });

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await api.blob(`/api/v1/verification/history?${historyQuery(brandScope, filter)}&format=csv`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `riwayat-verifikasi-${from || 'awal'}-sd-${to || businessDateKey()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onShowToast((error as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const data = history.data;
  const totals = data?.totals;
  const first = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">Cari riwayat</span>
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama, telepon, no. invoice, no. ref" className="field pl-9" />
        </label>
        <Select aria-label="Status riwayat" value={status} onValueChange={(v) => setStatus(v as PaymentHistoryStatus)} options={STATUS_OPTIONS} className="w-40" />
        <label className="flex items-center gap-1.5 text-xs text-zinc-600">Dari
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="field w-[9.75rem]" aria-label="Dari tanggal" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600">s.d.
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="field w-[9.75rem]" aria-label="Sampai tanggal" />
        </label>
        <Button variant="secondary" onClick={() => void download()} loading={downloading} disabled={!data?.total} icon={<Download size={14} />}>
          Unduh CSV
        </Button>
      </div>

      {totals && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700" aria-live="polite">
          <span><b className="font-semibold tabular-nums text-zinc-950">{totals.verifiedCount}</b> terverifikasi · <b className="font-semibold tabular-nums text-zinc-950">{rupiah(totals.verifiedAmount)}</b></span>
          <span><b className="font-semibold tabular-nums">{totals.rejectedCount}</b> ditolak</span>
          {totals.reversedCount > 0 && <span><b className="font-semibold tabular-nums">{totals.reversedCount}</b> dibatalkan</span>}
          {totals.byBank.length > 0 && (
            <span className="flex flex-wrap gap-1.5">
              {totals.byBank.map((b) => (
                <span key={b.bankName} className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 tabular-nums">{b.bankName}: {rupiah(b.amount)} ({b.count})</span>
              ))}
            </span>
          )}
        </div>
      )}

      {history.isLoading ? (
        <PageLoading label="Memuat riwayat…" />
      ) : history.isError ? (
        <PageError description={history.error.message} onRetry={() => void history.refetch()} />
      ) : !data?.items.length ? (
        <EmptyState icon={History} title="Belum ada riwayat" description="Tidak ada verifikasi atau penolakan pada filter ini. Ubah rentang tanggal atau status." />
      ) : (
        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white" aria-label="Riwayat verifikasi">
          <ul className="divide-y divide-zinc-100">
            {data.items.map((row) => {
              const tag = STATUS_TAG[row.status];
              const canAct = isSuperadmin && row.status === 'verified';
              return (
                <li key={row.key} className={cn('grid gap-2 px-4 py-3 sm:items-center sm:gap-4', isSuperadmin ? 'sm:grid-cols-[3rem_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_10.5rem]' : 'sm:grid-cols-[3rem_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)]')}>
                  <div className="hidden sm:block">{row.proofUrl ? <PrivateProofThumb url={row.proofUrl} /> : <span className="block h-12 w-12 rounded-lg bg-zinc-100" />}</div>
                  <div className="min-w-0">
                    <Link to={`/prospects/${row.prospect.id}`} className="block truncate text-sm font-semibold text-zinc-950 hover:underline">{row.prospect.name}</Link>
                    <p className="truncate text-xs text-zinc-500">{row.brand.name} · {row.prospect.invoiceNumber ?? 'Tanpa invoice'}</p>
                  </div>
                  <div className="min-w-0">
                    {row.amount !== null && <p className="text-sm font-semibold tabular-nums text-zinc-950">
                      {rupiah(row.amount)}
                      {row.paymentType && <span className="ml-1.5 text-xs font-medium text-zinc-500">{row.paymentType === 'full' ? 'Lunas' : 'DP'}</span>}
                    </p>}
                    <p className="text-xs text-zinc-500">
                      <span className={cn('mr-1.5 rounded px-1.5 py-0.5 font-semibold', tag.className)}>{tag.label}</span>
                      {wibDateTime(row.at)}{row.actor ? ` · ${row.actor}` : ''}
                    </p>
                  </div>
                  <RowDetail row={row} />
                  {isSuperadmin && <div className="flex gap-1.5 sm:justify-end">
                    {canAct && (
                      <>
                        <Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={() => setCorrecting(row)} aria-label={`Koreksi pembayaran ${row.prospect.name}`}>Koreksi</Button>
                        {row.prospect.status === 'deal' && (
                          <Button size="sm" variant="secondary" icon={<Undo2 size={13} />} onClick={() => setReversing(row)} aria-label={`Batalkan verifikasi ${row.prospect.name}`}>Batalkan</Button>
                        )}
                      </>
                    )}
                  </div>}
                </li>
              );
            })}
          </ul>
          <footer className="flex items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50/75 px-4 py-2 text-xs text-zinc-600">
            <span className="tabular-nums">{first}–{last} dari {data.total}</span>
            <span className="flex gap-1.5">
              <Button size="sm" variant="secondary" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>Sebelumnya</Button>
              <Button size="sm" variant="secondary" disabled={last >= data.total} onClick={() => setPage((p) => p + 1)}>Berikutnya</Button>
            </span>
          </footer>
        </section>
      )}

      {correcting && <CorrectPaymentDialog row={correcting} onClose={() => setCorrecting(null)} onDone={(m) => { onShowToast(m); setCorrecting(null); }} />}
      {reversing && <ReversePaymentDialog row={reversing} onClose={() => setReversing(null)} onDone={(m) => { onShowToast(m); setReversing(null); }} />}
    </div>
  );
}

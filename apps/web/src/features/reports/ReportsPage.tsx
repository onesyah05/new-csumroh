import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Download } from 'lucide-react';
import { businessDateKey } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { EmptyState, PageError, PageLoading } from '../../components/ui/page-feedback';
import { onRovingKey, rovingTabIndex } from '../custom/roving';
import { showFeedback } from '../../app/toast';
import { durationLabel, rupiah } from '../finance/verificationApi';
import { CreativesView, roasText } from './CreativesView';

export const REPORT_TABS = [
  { key: 'sales', label: 'Penjualan', file: 'penjualan' },
  { key: 'cs', label: 'Kinerja CS', file: 'kinerja-cs' },
  { key: 'sources', label: 'Sumber lead', file: 'sumber-lead' },
  { key: 'ads', label: 'Iklan Meta', file: 'iklan-meta' },
  { key: 'creatives', label: 'Kreatif iklan', file: 'kreatif-iklan' },
  { key: 'lost', label: 'Alasan batal', file: 'alasan-batal' },
  { key: 'payments', label: 'Pembayaran', file: 'pembayaran' },
] as const;
type ReportKey = (typeof REPORT_TABS)[number]['key'];

type Period = 'this_month' | 'last_month' | '7d' | '30d' | 'custom';
const PERIOD_OPTIONS = [
  { value: 'this_month', label: 'Bulan ini' },
  { value: 'last_month', label: 'Bulan lalu' },
  { value: '7d', label: '7 hari terakhir' },
  { value: '30d', label: '30 hari terakhir' },
  { value: 'custom', label: 'Pilih tanggal' },
];

const shiftKey = (key: string, days: number) => {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Rentang tanggal bisnis (WIB) untuk preset periode. */
export function periodRange(period: Exclude<Period, 'custom'>, today = businessDateKey()) {
  const monthStart = `${today.slice(0, 8)}01`;
  if (period === 'this_month') return { from: monthStart, to: today };
  if (period === 'last_month') {
    const lastDay = shiftKey(monthStart, -1);
    return { from: `${lastDay.slice(0, 8)}01`, to: lastDay };
  }
  return { from: shiftKey(today, period === '7d' ? -6 : -29), to: today };
}

const num = (value: number) => new Intl.NumberFormat('id-ID').format(value);
const percent = (value: number) => `${value.toLocaleString('id-ID')}%`;

type Named = { label: string; deals: number; value: number };
type SalesReport = {
  summary: { leads: number; spam: number; deals: number; lost: number; conversion: number; dealValue: number; cashIn: number; avgDealValue: number; avgDaysToDeal: number | null };
  stages: { key: string; label: string; count: number }[];
  byPackage: Named[];
  byBrand: Named[];
};
type CsReport = {
  rows: { id: number; name: string; isActive: boolean; leads: number; deals: number; dealValue: number; conversion: number; medianReplyMinutes: number | null; takenOver: number; openNow: number; overdueFollowups: number }[];
};
type SourcesReport = { total: number; rows: { source: string; label: string; leads: number; spam: number; deals: number; lost: number; open: number; conversion: number; dealValue: number }[] };
type AdsRow = { brandId: number; brand: string; status: 'ok' | 'not_configured' | 'error'; message: string | null; spend: number | null; leads: number; deals: number; purchaseValue: number; cpl: number | null; cac: number | null; roas: number | null };
type AdsReport = {
  summary: { spend: number; leads: number; deals: number; purchaseValue: number; cpl: number | null; cac: number | null; roas: number | null; measuredBrands: number; brands: number };
  rows: AdsRow[];
};
type LostReport = {
  totalLost: number;
  reasons: { reason: string; count: number; share: number }[];
  objections: { category: string; count: number; won: number; lost: number; winRate: number }[];
};
type PaymentsReport = {
  summary: { count: number; amount: number; dpCount: number; dpAmount: number; fullCount: number; fullAmount: number; reversed: number; rejected: number; openInvoices: number; openInvoiceAmount: number; overdueInvoices: number; waitingVerification: number };
  byBank: { bankName: string; count: number; amount: number }[];
  byBrand: { brand: string; count: number; amount: number }[];
};

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (REPORT_TABS.find((t) => t.key === params.get('tab'))?.key ?? 'sales') as ReportKey;
  const setTab = (key: ReportKey) => setParams((p) => { p.set('tab', key); return p; }, { replace: true });

  const [brandScope, setBrandScope] = useState('all');
  const [period, setPeriod] = useState<Period>('this_month');
  const [custom, setCustom] = useState(() => periodRange('this_month'));
  const range = period === 'custom' ? custom : periodRange(period);
  const [downloading, setDownloading] = useState(false);

  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get<any[]>('/catalog/brands') });
  const query = `from=${range.from}&to=${range.to}&brandId=${brandScope}`;
  const report = useQuery({
    queryKey: ['report', tab, query],
    queryFn: () => api.get<any>(`/reports/${tab}?${query}`),
    // Data lama hanya dipertahankan saat periode/brand berubah; bentuk data tiap tab berbeda.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === tab ? previous : undefined),
    enabled: range.from <= range.to,
  });

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await api.blob(`/api/v1/reports/${tab}?${query}&format=csv`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `laporan-${REPORT_TABS.find((t) => t.key === tab)!.file}-${range.from}-sd-${range.to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showFeedback((error as Error).message, { error: true });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Manajemen"
        kickerIcon={<BarChart3 size={13} />}
        title="Laporan"
        actions={
          <Select
            value={brandScope}
            onValueChange={setBrandScope}
            aria-label="Cakupan brand"
            className="w-48"
            options={[
              { value: 'all', label: 'Semua brand' },
              ...(brands.data ?? []).map((b) => ({ value: String(b.id), label: b.name, iconUrl: b.logoUrl, iconInitials: b.name.substring(0, 2).toUpperCase() })),
            ]}
          />
        }
      />

      <div role="tablist" aria-label="Jenis laporan" className="scroll-row flex gap-1 border-b border-zinc-200" onKeyDown={(e) => onRovingKey(e, REPORT_TABS.map((t) => t.key), tab, setTab)}>
        {REPORT_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`report-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="report-panel"
            tabIndex={rovingTabIndex(t.key, tab, 'sales')}
            onClick={() => setTab(t.key)}
            className={cn('-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-xs font-medium', tab === t.key ? 'border-zinc-950 font-semibold text-zinc-950' : 'border-transparent text-zinc-500 hover:text-zinc-950')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Periode" value={period} onValueChange={(v) => setPeriod(v as Period)} options={PERIOD_OPTIONS} className="w-44" />
        {period === 'custom' ? (
          <>
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="field w-[9.75rem]" aria-label="Dari tanggal" />
            <span className="text-xs text-zinc-500">s.d.</span>
            <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="field w-[9.75rem]" aria-label="Sampai tanggal" />
          </>
        ) : (
          <span className="text-xs tabular-nums text-zinc-500">{dateText(range.from)} – {dateText(range.to)}</span>
        )}
        <Button variant="secondary" className="ml-auto" onClick={() => void download()} loading={downloading} disabled={!report.data} icon={<Download size={14} />}>
          Unduh CSV
        </Button>
      </div>

      <div role="tabpanel" id="report-panel" aria-labelledby={`report-tab-${tab}`} className="space-y-5">
        {report.isLoading ? (
          <PageLoading label="Memuat laporan…" />
        ) : report.isError ? (
          <PageError description={report.error.message} onRetry={() => void report.refetch()} />
        ) : report.data ? (
          <div className={cn('space-y-5 transition-opacity', report.isFetching && 'opacity-60')}>
            {tab === 'sales' && <SalesView data={report.data} />}
            {tab === 'cs' && <CsView data={report.data} />}
            {tab === 'sources' && <SourcesView data={report.data} />}
            {tab === 'ads' && <AdsView data={report.data} />}
            {tab === 'creatives' && <CreativesView data={report.data} />}
            {tab === 'lost' && <LostView data={report.data} />}
            {tab === 'payments' && <PaymentsView data={report.data} />}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const dateText = (key: string) =>
  new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00.000Z`));

// ── Tabel & bar ─────────────────────────────────────────────────────────────────────────────────────────

type Column<T> = { label: string; cell: (row: T) => ReactNode; align?: 'right' };
function ReportTable<T>({ title, rows, columns, empty, rowKey }: { title: string; rows: T[]; columns: Column<T>[]; empty: string; rowKey: (row: T) => string | number }) {
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <header className="border-b border-zinc-200 bg-zinc-50/75 px-4 py-2.5">
        <h2 className="text-xs font-semibold text-zinc-600">{title}</h2>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-zinc-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-xs text-zinc-500">
                {columns.map((c) => (
                  <th key={c.label} scope="col" className={cn('px-4 py-2 font-medium', c.align === 'right' ? 'text-right' : 'text-left')}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((c) => (
                    <td key={c.label} className={cn('px-4 py-2.5 text-zinc-800', c.align === 'right' && 'text-right tabular-nums')}>{c.cell(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Bar({ value, max, tone = 'bg-zinc-900' }: { value: number; max: number; tone?: string }) {
  return (
    <span className="block h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-zinc-100">
      <span className={cn('block h-full rounded-full', tone)} style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} />
    </span>
  );
}

// ── 1. Penjualan ────────────────────────────────────────────────────────────────────────────────────────

function SalesView({ data }: { data: SalesReport }) {
  const s = data.summary;
  const maxStage = Math.max(0, ...data.stages.map((x) => x.count));
  const columns: Column<Named>[] = [
    { label: 'Nama', cell: (r) => r.label },
    { label: 'Deal', cell: (r) => num(r.deals), align: 'right' },
    { label: 'Nilai deal', cell: (r) => rupiah(r.value), align: 'right' },
  ];
  return (
    <>
      <StatGrid cols={4}>
        <StatCard label="Lead baru" value={num(s.leads)} note={s.spam ? `${num(s.spam)} chat spam tidak dihitung` : undefined} />
        <StatCard label="Deal" value={num(s.deals)} note={`Konversi ${percent(s.conversion)}`} />
        <StatCard label="Nilai deal" value={rupiah(s.dealValue)} note={s.deals ? `Rata-rata ${rupiah(s.avgDealValue)}` : undefined} />
        <StatCard label="Uang masuk" value={rupiah(s.cashIn)} note={s.avgDaysToDeal !== null ? `Lead → deal ${num(s.avgDaysToDeal)} hari` : undefined} />
      </StatGrid>
      <section className="rounded-xl border border-zinc-200 bg-white">
        <header className="border-b border-zinc-200 bg-zinc-50/75 px-4 py-2.5">
          <h2 className="text-xs font-semibold text-zinc-600">Posisi lead periode ini</h2>
        </header>
        {s.leads === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-zinc-500">Belum ada lead pada periode ini.</p>
        ) : (
          <ul className="space-y-2.5 px-4 py-3">
            {data.stages.map((stage) => (
              <li key={stage.key} className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
                <span className="truncate text-zinc-700">{stage.label}</span>
                <Bar value={stage.count} max={maxStage} tone={stage.key === 'deal' ? 'bg-emerald-600' : stage.key === 'lose' ? 'bg-rose-500' : 'bg-zinc-800'} />
                <span className="text-right tabular-nums text-zinc-950">{num(stage.count)} <span className="text-xs text-zinc-500">{s.leads ? `${Math.round((stage.count / s.leads) * 100)}%` : ''}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <ReportTable title="Deal per paket" rows={data.byPackage} columns={columns} rowKey={(r) => r.label} empty="Belum ada deal." />
        <ReportTable title="Deal per brand" rows={data.byBrand} columns={columns} rowKey={(r) => r.label} empty="Belum ada deal." />
      </div>
    </>
  );
}

// ── 2. Kinerja CS ───────────────────────────────────────────────────────────────────────────────────────

function CsView({ data }: { data: CsReport }) {
  if (!data.rows.length) return <EmptyState icon={BarChart3} title="Belum ada CS" description="Tidak ada CS pada brand ini." />;
  return (
    <ReportTable
      title="Kinerja per CS"
      rows={data.rows}
      rowKey={(r) => r.id}
      empty=""
      columns={[
        { label: 'CS', cell: (r) => <span className={cn('font-medium', !r.isActive && 'text-zinc-500')}>{r.name}{!r.isActive && ' (nonaktif)'}</span> },
        { label: 'Lead baru', cell: (r) => num(r.leads), align: 'right' },
        { label: 'Deal', cell: (r) => num(r.deals), align: 'right' },
        { label: 'Konversi', cell: (r) => percent(r.conversion), align: 'right' },
        { label: 'Nilai deal', cell: (r) => rupiah(r.dealValue), align: 'right' },
        { label: 'Balas pertama', cell: (r) => (r.medianReplyMinutes === null ? '—' : r.medianReplyMinutes < 1 ? '< 1 menit' : durationLabel(r.medianReplyMinutes)), align: 'right' },
        { label: 'Diambil alih', cell: (r) => num(r.takenOver), align: 'right' },
        { label: 'Prospek aktif', cell: (r) => num(r.openNow), align: 'right' },
        { label: 'FU terlambat', cell: (r) => <span className={cn(r.overdueFollowups > 0 && 'font-semibold text-rose-600')}>{num(r.overdueFollowups)}</span>, align: 'right' },
      ]}
    />
  );
}

// ── 3. Sumber lead ──────────────────────────────────────────────────────────────────────────────────────

function SourcesView({ data }: { data: SourcesReport }) {
  const max = Math.max(0, ...data.rows.map((r) => r.leads));
  return (
    <ReportTable
      title={`Sumber lead · ${num(data.total)} lead`}
      rows={data.rows}
      rowKey={(r) => r.source}
      empty="Belum ada lead pada periode ini."
      columns={[
        { label: 'Sumber', cell: (r) => <span className="font-medium">{r.label}</span> },
        { label: 'Lead', cell: (r) => <span className="flex items-center justify-end gap-2"><span className="hidden w-24 sm:block"><Bar value={r.leads} max={max} /></span>{num(r.leads)}</span>, align: 'right' },
        { label: 'Deal', cell: (r) => num(r.deals), align: 'right' },
        { label: 'Spam', cell: (r) => num(r.spam), align: 'right' },
        { label: 'Batal', cell: (r) => num(r.lost), align: 'right' },
        { label: 'Berjalan', cell: (r) => num(r.open), align: 'right' },
        { label: 'Konversi', cell: (r) => percent(r.conversion), align: 'right' },
        { label: 'Nilai deal', cell: (r) => rupiah(r.dealValue), align: 'right' },
      ]}
    />
  );
}

// ── Iklan Meta ──────────────────────────────────────────────────────────────────────────────────────────

const money = (value: number | null) => (value === null ? '—' : rupiah(value));

function AdsView({ data }: { data: AdsReport }) {
  const s = data.summary;
  if (s.measuredBrands === 0 && data.rows.every((r) => r.status === 'not_configured')) {
    return <EmptyState icon={BarChart3} title="Ad account belum diatur" description="Isi Ad Account ID di Brand Travel → tab Meta. Token Meta perlu izin ads_read." />;
  }
  return (
    <>
      <StatGrid cols={4}>
        <StatCard label="Biaya iklan" value={rupiah(s.spend)} note={s.measuredBrands < s.brands ? `${s.measuredBrands} dari ${s.brands} brand terukur` : undefined} />
        <StatCard label="ROAS" value={roasText(s.roas)} note={`Nilai deal ${rupiah(s.purchaseValue)}`} />
        <StatCard label="Biaya per lead" value={money(s.cpl)} note={`${num(s.leads)} lead Meta Ads`} />
        <StatCard label="Biaya per deal" value={money(s.cac)} note={`${num(s.deals)} deal`} />
      </StatGrid>
      <ReportTable
        title="Per brand"
        rows={data.rows}
        rowKey={(r) => r.brandId}
        empty=""
        columns={[
          { label: 'Brand', cell: (r) => (
            <span className="flex flex-col">
              <span className="font-medium">{r.brand}</span>
              {r.status !== 'ok' || r.message ? <span className={cn('text-xs', r.status === 'error' || r.message ? 'text-rose-600' : 'text-zinc-500')}>{r.status === 'not_configured' ? 'Ad account belum diatur' : r.message}</span> : null}
            </span>
          ) },
          { label: 'Biaya iklan', cell: (r) => money(r.spend), align: 'right' },
          { label: 'Lead', cell: (r) => num(r.leads), align: 'right' },
          { label: 'Deal', cell: (r) => num(r.deals), align: 'right' },
          { label: 'Nilai deal', cell: (r) => rupiah(r.purchaseValue), align: 'right' },
          { label: 'Per lead', cell: (r) => money(r.cpl), align: 'right' },
          { label: 'Per deal', cell: (r) => money(r.cac), align: 'right' },
          { label: 'ROAS', cell: (r) => <span className="font-semibold">{roasText(r.roas)}</span>, align: 'right' },
        ]}
      />
      <p className="text-xs text-zinc-500">Lead dan deal dari prospek bersumber Meta Ads. Nilai deal = harga paket atau harga custom yang disepakati. Biaya dari Meta, diperbarui tiap 10 menit.</p>
    </>
  );
}

// ── 4. Alasan batal ─────────────────────────────────────────────────────────────────────────────────────

function LostView({ data }: { data: LostReport }) {
  const max = Math.max(0, ...data.reasons.map((r) => r.count));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ReportTable
        title={`Alasan batal · ${num(data.totalLost)} prospek`}
        rows={data.reasons}
        rowKey={(r) => r.reason}
        empty="Tidak ada prospek batal pada periode ini."
        columns={[
          { label: 'Alasan', cell: (r) => r.reason },
          { label: 'Jumlah', cell: (r) => <span className="flex items-center justify-end gap-2"><span className="hidden w-20 sm:block"><Bar value={r.count} max={max} tone="bg-rose-500" /></span>{num(r.count)}</span>, align: 'right' },
          { label: 'Porsi', cell: (r) => percent(r.share), align: 'right' },
        ]}
      />
      <ReportTable
        title="Keberatan tercatat"
        rows={data.objections}
        rowKey={(r) => r.category}
        empty="Tidak ada keberatan tercatat pada periode ini."
        columns={[
          { label: 'Keberatan', cell: (r) => r.category },
          { label: 'Prospek', cell: (r) => num(r.count), align: 'right' },
          { label: 'Deal', cell: (r) => num(r.won), align: 'right' },
          { label: 'Batal', cell: (r) => num(r.lost), align: 'right' },
          { label: 'Tembus deal', cell: (r) => percent(r.winRate), align: 'right' },
        ]}
      />
    </div>
  );
}

// ── 5. Pembayaran ───────────────────────────────────────────────────────────────────────────────────────

function PaymentsView({ data }: { data: PaymentsReport }) {
  const s = data.summary;
  return (
    <>
      <StatGrid cols={4}>
        <StatCard label="Pembayaran masuk" value={rupiah(s.amount)} note={`${num(s.count)} pembayaran terverifikasi`} />
        <StatCard label="DP" value={rupiah(s.dpAmount)} note={`${num(s.dpCount)} pembayaran`} />
        <StatCard label="Lunas" value={rupiah(s.fullAmount)} note={`${num(s.fullCount)} pembayaran`} />
        <StatCard label="Ditolak / dibatalkan" value={`${num(s.rejected)} / ${num(s.reversed)}`} note="Bukti ditolak · verifikasi dibatalkan" alert={s.reversed > 0} />
      </StatGrid>
      <StatGrid cols={3}>
        <StatCard label="Invoice berjalan" value={num(s.openInvoices)} note={rupiah(s.openInvoiceAmount)} />
        <StatCard label="Tunggu verifikasi" value={num(s.waitingVerification)} note="Bukti sudah dikirim" />
        <StatCard label="Lewat jatuh tempo" value={num(s.overdueInvoices)} note="Belum ada bukti transfer" alert={s.overdueInvoices > 0} />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <ReportTable
          title="Per rekening tujuan"
          rows={data.byBank}
          rowKey={(r) => r.bankName}
          empty="Belum ada pembayaran pada periode ini."
          columns={[
            { label: 'Bank', cell: (r) => r.bankName },
            { label: 'Pembayaran', cell: (r) => num(r.count), align: 'right' },
            { label: 'Nominal', cell: (r) => rupiah(r.amount), align: 'right' },
          ]}
        />
        <ReportTable
          title="Per brand"
          rows={data.byBrand}
          rowKey={(r) => r.brand}
          empty="Belum ada pembayaran pada periode ini."
          columns={[
            { label: 'Brand', cell: (r) => r.brand },
            { label: 'Pembayaran', cell: (r) => num(r.count), align: 'right' },
            { label: 'Nominal', cell: (r) => rupiah(r.amount), align: 'right' },
          ]}
        />
      </div>
    </>
  );
}

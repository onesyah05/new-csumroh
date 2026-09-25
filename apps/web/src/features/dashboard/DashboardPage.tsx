import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { isHoldingRole, useBrandScope } from '../../lib/scope';
import { Select } from '../../components/ui/select';
import { useAuth } from '../../app/auth';
import { TodayTasks } from './TodayTasks';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';

type Trend = { value: number; previous: number };
type Summary = {
  scope: { isHoldingView: boolean; currentBrandId: number | null; role: string; brands: { id: number; name: string; logoUrl?: string | null }[] };
  period: { key: string; from: string; to: string; prevFrom: string; prevTo: string; comparison: string };
  kpis: {
    leads: Trend;
    deals: Trend & { jamaah: number };
    bookingValue: Trend;
  };
  funnel: { stages: { label: string; count: number }[]; lost: number; conversion: number; sources: { source: string; leads: number; deals: number }[] };
  brands: Array<{ id: number; name: string; leads: number; deals: number; jamaah: number; bookingValue: number; conversion: number; activeCs: number; unassignedOpen: number }>;
  team: Array<{ id: number; name: string; isActive: boolean; brands: string[]; leads: number; deals: number; jamaah: number; bookingValue: number; conversion: number; openNow: number }> | null;
  departures: Array<{ id: number; name: string; brandName: string; departureDate: string; sold: number; remaining: number | null; capacity: number | null; daysLeft: number }>;
};

const PERIODS = [
  { value: 'this_month', label: 'Bulan ini' },
  { value: 'last_month', label: 'Bulan lalu' },
  { value: 'last_30', label: '30 hari terakhir' },
  { value: 'this_year', label: 'Tahun ini' },
];
const SOURCE_LABELS: Record<string, string> = { whatsapp: 'WhatsApp langsung', meta_ads: 'Iklan Meta', manual: 'Input manual' };
const TZ = 'Asia/Jakarta';

const money = (value: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact', maximumFractionDigits: 1 }).format(value);
const moneyFull = (value: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);

/** "1–24 Sep 2026" atau "25 Agu – 24 Sep 2026" (akhir rentang eksklusif). */
export function formatRange(fromIso: string, toIso: string) {
  const from = new Date(fromIso);
  const to = new Date(new Date(toIso).getTime() - 1);
  const part = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('id-ID', { timeZone: TZ, ...o }).format(d);
  const sameYear = part(from, { year: 'numeric' }) === part(to, { year: 'numeric' });
  const sameMonth = sameYear && part(from, { month: 'short' }) === part(to, { month: 'short' });
  const end = part(to, { day: 'numeric', month: 'short', year: 'numeric' });
  if (sameMonth) return `${part(from, { day: 'numeric' })}–${end}`;
  return `${part(from, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} – ${end}`;
}

function Delta({ value, previous }: Trend) {
  if (value === previous) {
    return <span className="inline-flex items-center gap-0.5 text-xs font-medium text-zinc-500"><Minus size={12} aria-hidden="true" />Sama</span>;
  }
  const up = value > previous;
  const label = previous === 0 ? 'Baru' : `${up ? '+' : '−'}${Math.round((Math.abs(value - previous) / previous) * 100)}%`;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums', up ? 'text-emerald-700' : 'text-rose-700')}>
      <Icon size={13} aria-hidden="true" />{label}
    </span>
  );
}

function Kpi({ label, value, note, trend, previousLabel }: { label: string; value: string; note?: ReactNode; trend?: Trend; previousLabel?: string }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="text-xs font-medium text-zinc-600">{label}</p>
      <p className="mt-1.5 truncate text-2xl font-bold leading-none tracking-tight text-zinc-950 tabular-nums">{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-600">
        {trend && <Delta {...trend} />}
        {trend && previousLabel && <span className="tabular-nums">sebelumnya {previousLabel}</span>}
        {note}
      </div>
    </div>
  );
}

function Panel({ title, subtitle, aside, children, className }: { title: string; subtitle?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('surface overflow-hidden', className)} aria-label={title}>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-zinc-950">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-zinc-600">{subtitle}</p>}
        </div>
        {aside && <div className="shrink-0 text-xs">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

const th = 'whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-zinc-600';
const td = 'whitespace-nowrap px-3 py-3 tabular-nums text-zinc-800';

export function DashboardPage() {
  const { user } = useAuth();
  const { brandId, query } = useBrandScope();
  const isHolding = isHoldingRole(user?.role);
  const isCs = user?.role === 'cs';
  const [holdingScope, setHoldingScope] = useState('all');
  const [period, setPeriod] = useState('this_month');

  const scopeParam = isHolding ? `?brandId=${holdingScope}` : query;
  const dashboard = useQuery({
    queryKey: ['dashboard', 'summary', isHolding ? holdingScope : brandId, period],
    queryFn: () => api.get<Summary>(`/dashboard${scopeParam}${scopeParam ? '&' : '?'}period=${period}`),
    enabled: user?.role !== 'finance' && (!!brandId || isHolding),
  });

  if (user?.role === 'finance') return <div className="app-page space-y-5"><PageHeader title="Verifikasi pembayaran awal" subtitle="Verifikasi DP atau pembayaran lunas pertama untuk menetapkan Deal." /><TodayTasks scope="?brandId=all" /></div>;

  if (!brandId && !isHolding) {
    return <PageError title="Belum ada brand aktif" description="Akun Anda belum dikaitkan dengan brand. Hubungi Administrator untuk penugasan brand." />;
  }
  if (dashboard.isLoading) return <PageLoading label="Memuat ringkasan..." />;
  if (dashboard.isError || !dashboard.data?.kpis) {
    return <PageError description={dashboard.error?.message ?? 'Data ringkasan tidak lengkap.'} onRetry={() => void dashboard.refetch()} />;
  }

  const data = dashboard.data;
  const { kpis, funnel } = data;
  const brandName = data.scope.brands.find((b) => b.id === data.scope.currentBrandId)?.name ?? user?.brand?.name ?? 'Brand';
  const scopeLabel = data.scope.isHoldingView ? `Semua brand (${data.scope.brands.length})` : brandName;
  const rangeLabel = formatRange(data.period.from, data.period.to);
  const prevRange = formatRange(data.period.prevFrom, data.period.prevTo);
  const leadsTotal = funnel.stages[0]?.count ?? 0;

  return (
    <div className="app-page space-y-5">
      <PageHeader
        title="Ringkasan"
        subtitle={isCs ? `Jamaah yang Anda tangani di ${brandName} · ${rangeLabel}` : `${scopeLabel} · ${rangeLabel}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={period} onValueChange={setPeriod} size="sm" aria-label="Periode" className="w-auto text-xs" options={PERIODS} />
            {isHolding && (
              <Select
                value={holdingScope}
                onValueChange={setHoldingScope}
                size="sm"
                aria-label="Cakupan brand"
                className="w-auto text-xs"
                options={[{ value: 'all', label: 'Semua brand' }, ...data.scope.brands.map((b) => ({ value: String(b.id), label: b.name, iconUrl: b.logoUrl, iconInitials: b.name.substring(0, 2).toUpperCase() }))]}
              />
            )}
          </div>
        }
      />

      <TodayTasks scope={scopeParam} />

      {/* Angka bisnis periode ini, dibandingkan dengan rentang yang sama sebelumnya. */}
      <section aria-label="Kinerja periode" className="surface overflow-hidden">
        {/* gap-px di atas latar abu = garis pembatas; di 2 kolom KPI terakhir melebar agar tidak ada sel kosong. */}
        <div className="grid grid-cols-2 gap-px bg-zinc-100 md:grid-cols-3 [&>*]:bg-white [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
          <Kpi label={isCs ? 'Lead baru saya' : 'Lead masuk'} value={kpis.leads.value.toLocaleString('id-ID')} trend={kpis.leads} previousLabel={String(kpis.leads.previous)} />
          <Kpi
            label="Deal"
            value={`${kpis.deals.value} booking`}
            trend={kpis.deals}
            previousLabel={String(kpis.deals.previous)}
            note={<span className="font-medium text-zinc-700">{kpis.deals.jamaah} jamaah</span>}
          />
          <Kpi label="Nilai deal" value={money(kpis.bookingValue.value)} trend={kpis.bookingValue} previousLabel={money(kpis.bookingValue.previous)} />
        </div>
        <p className="border-t border-zinc-100 bg-white px-5 py-2 text-xs text-zinc-500">
          Perbandingan dengan {data.period.comparison} ({prevRange}).
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          title="Perjalanan lead"
          subtitle={`${leadsTotal} lead yang masuk ${rangeLabel} dan tahap terjauhnya sekarang`}
          aside={<span className="font-semibold text-zinc-900">Konversi {funnel.conversion}%</span>}
        >
          {leadsTotal === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-zinc-600">Belum ada lead masuk pada periode ini.</p>
          ) : (
            <div className="space-y-4 px-5 py-5">
              {funnel.stages.map((stage, index) => {
                const share = Math.round((stage.count / leadsTotal) * 100);
                const isDeal = index === funnel.stages.length - 1;
                return (
                  <div key={stage.label} className="grid grid-cols-[112px_minmax(0,1fr)_76px] items-center gap-3 text-xs">
                    <span className="font-medium text-zinc-700">{stage.label}</span>
                    <span className="h-3 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
                      <span className={cn('block h-full rounded-full', isDeal ? 'bg-emerald-600' : 'bg-zinc-800')} style={{ width: `${Math.max(share, stage.count ? 2 : 0)}%` }} />
                    </span>
                    <span className="text-right tabular-nums">
                      <b className="text-zinc-950">{stage.count}</b> <span className="text-zinc-500">· {share}%</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {leadsTotal > 0 && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-zinc-100 px-5 py-2.5 text-xs text-zinc-600">
              {funnel.sources.map((s) => (
                <span key={s.source}>
                  <b className="font-semibold text-zinc-800">{SOURCE_LABELS[s.source] ?? s.source}</b> {s.leads} lead · {s.deals} deal
                </span>
              ))}
              {funnel.lost > 0 && <span>{funnel.lost} batal</span>}
            </div>
          )}
        </Panel>

        <Panel
          className="lg:col-span-2"
          title="Keberangkatan terdekat"
          subtitle="Seat terjual dari kuota paket"
          aside={<Link to="/packages" className="font-medium text-zinc-700 hover:text-zinc-950 hover:underline">Semua paket</Link>}
        >
          {data.departures.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-zinc-600">Belum ada keberangkatan terjadwal.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {data.departures.map((d) => {
                const fill = d.capacity ? Math.round((d.sold / d.capacity) * 100) : 0;
                const date = new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d.departureDate));
                return (
                  <li key={d.id} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-semibold text-zinc-900" title={d.name}>{d.name}</p>
                      <p className="shrink-0 text-xs tabular-nums text-zinc-700">
                        {d.capacity === null ? 'Kuota belum diatur' : <><b className="text-zinc-950">{d.sold}</b>/{d.capacity} seat</>}
                      </p>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-xs text-zinc-600">
                      <span className="truncate">
                        {date} · {d.daysLeft === 0 ? 'hari ini' : `${d.daysLeft} hari lagi`}{data.scope.isHoldingView ? ` · ${d.brandName}` : ''}
                      </span>
                      {d.remaining === 0 ? (
                        <span className="shrink-0 font-semibold text-zinc-900">Penuh</span>
                      ) : d.remaining !== null && d.remaining <= 5 ? (
                        <span className="shrink-0 font-semibold text-amber-800">Sisa {d.remaining}</span>
                      ) : null}
                    </div>
                    {d.capacity !== null && (
                      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
                        <span className="block h-full rounded-full bg-zinc-800" style={{ width: `${Math.max(fill, d.sold ? 2 : 0)}%` }} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {data.scope.isHoldingView && data.brands.length > 1 && (
        <Panel title="Per brand" subtitle={`Kinerja ${rangeLabel}. Klik nama brand untuk melihat rinciannya.`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50">
                <tr>
                  <th className={cn(th, 'pl-5')}>Brand</th>
                  <th className={cn(th, 'text-right')}>Lead</th>
                  <th className={cn(th, 'text-right')}>Deal</th>
                  <th className={cn(th, 'text-right')}>Nilai deal</th>
                  <th className={cn(th, 'text-right')}>Konversi</th>
                  <th className={cn(th, 'pr-5 text-right')}>CS aktif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.brands.map((b) => (
                  <tr key={b.id} className="hover:bg-zinc-50">
                    <td className="whitespace-nowrap py-3 pl-5 pr-3">
                      <button type="button" onClick={() => setHoldingScope(String(b.id))} className="font-semibold text-zinc-900 hover:underline">
                        {b.name}
                      </button>
                    </td>
                    <td className={cn(td, 'text-right')}>{b.leads}</td>
                    <td className={cn(td, 'text-right')}>{b.deals} <span className="text-xs text-zinc-500">({b.jamaah} jamaah)</span></td>
                    <td className={cn(td, 'text-right')} title={moneyFull(b.bookingValue)}>{money(b.bookingValue)}</td>
                    <td className={cn(td, 'text-right')}>{b.conversion}%</td>
                    <td className={cn(td, 'pr-5 text-right')}>
                      {b.activeCs > 0 ? b.activeCs : <Link to="/staff" className="font-semibold text-amber-800 hover:underline">Belum ada</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {data.team && (
        <Panel
          title="Performa CS"
          subtitle={`Diurutkan menurut nilai deal ${rangeLabel}. Prospek aktif = beban saat ini.`}
          aside={<Link to="/staff" className="font-medium text-zinc-700 hover:text-zinc-950 hover:underline">Kelola staf</Link>}
        >
          {data.team.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-zinc-600">
              Belum ada CS aktif pada cakupan ini. <Link to="/staff" className="font-semibold text-zinc-900 underline">Tambah CS</Link>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50">
                  <tr>
                    <th className={cn(th, 'pl-5')}>CS</th>
                    <th className={cn(th, 'text-right')}>Lead baru</th>
                    <th className={cn(th, 'text-right')}>Deal</th>
                    <th className={cn(th, 'text-right')}>Nilai deal</th>
                    <th className={cn(th, 'text-right')}>Konversi</th>
                    <th className={cn(th, 'pr-5 text-right')}>Prospek aktif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {data.team.map((cs) => (
                    <tr key={cs.id} className="hover:bg-zinc-50">
                      <td className="whitespace-nowrap py-3 pl-5 pr-3">
                        <p className="font-semibold text-zinc-900">
                          {cs.name}
                          {!cs.isActive && <span className="ml-1.5 text-xs font-medium text-zinc-500">nonaktif</span>}
                        </p>
                        {data.scope.isHoldingView && cs.brands.length > 0 && <p className="text-xs text-zinc-500">{cs.brands.join(', ')}</p>}
                      </td>
                      <td className={cn(td, 'text-right')}>{cs.leads}</td>
                      <td className={cn(td, 'text-right')}>{cs.deals} <span className="text-xs text-zinc-500">({cs.jamaah} jamaah)</span></td>
                      <td className={cn(td, 'text-right')} title={moneyFull(cs.bookingValue)}>{money(cs.bookingValue)}</td>
                      <td className={cn(td, 'text-right')}>{cs.conversion}%</td>
                      <td className={cn(td, 'pr-5 text-right')}>{cs.openNow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

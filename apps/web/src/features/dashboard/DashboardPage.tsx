import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CircleDollarSign,
  CreditCard,
  Inbox,
  MessageCircleMore,
  Plane,
  Sparkles,
  TrendingUp,
  Trophy,
  Users2,
  UserPlus2,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { isHoldingRole, useBrandScope } from '../../lib/scope';
import { Select } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../app/auth';
import { PageError, PageLoading, SectionEmpty } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';

const rupiah = (value: unknown) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

const moneyCompact = (value: unknown) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0));

export function DashboardPage() {
  const { user } = useAuth();
  const { brandId, query } = useBrandScope();
  // Pengawas holding memilih cakupan secara eksplisit; default "Semua brand" (konsolidasi holding).
  const isSuperOrFinance = isHoldingRole(user?.role);
  const [holdingScope, setHoldingScope] = useState<string>('all');
  const scopeParam = isSuperOrFinance ? `?brandId=${holdingScope}` : query;

  const dashboard = useQuery({
    queryKey: ['dashboard', isSuperOrFinance ? holdingScope : brandId],
    queryFn: () => api.get<any>(`/dashboard${scopeParam}`),
    enabled: !!brandId || isSuperOrFinance,
  });

  const data = dashboard.data;
  const brandCount = data?.brands?.length ?? 0;
  const currentBrandName = data?.brands?.find((b: any) => b.id === data?.currentBrandId)?.name ?? user?.brand?.name ?? 'brand terpilih';

  if (!brandId && !isSuperOrFinance) {
    return (
      <PageError
        title="Belum ada brand aktif"
        description="Akun Anda belum dikaitkan dengan brand tertentu. Hubungi Administrator Holding untuk penugasan brand."
      />
    );
  }

  if (dashboard.isLoading) return <PageLoading label="Menyiapkan ringkasan workspace..." />;
  if (dashboard.isError) return <PageError description={dashboard.error.message} onRetry={() => void dashboard.refetch()} />;

  const isHolding = data?.isHoldingView;

  const metrics = [
    {
      label: isHolding ? 'Total Leads Holding' : 'Total Prospek',
      value: data?.total ?? '0',
      note: isHolding ? `Semua kontak dari ${brandCount} brand` : 'Semua pipeline aktif',
      icon: Inbox,
    },
    {
      label: 'Jamaah Ter-Booking',
      value: `${data?.totalPax ?? 0} Pax`,
      note: `${data?.won ?? 0} transaksi deal terverifikasi`,
      icon: Users2,
    },
    {
      label: 'Omzet Deal Won',
      value: moneyCompact(data?.totalDealValue ?? 0),
      note: `Kas Masuk: ${moneyCompact(data?.totalVerifiedCash ?? 0)}`,
      icon: CircleDollarSign,
    },
    {
      label: 'Konversi Deal',
      value: `${data?.conversionRate ?? 0}%`,
      note: isHolding ? 'Rata-rata konversi holding' : `${data?.won ?? 0} prospek deal`,
      icon: Trophy,
    },
  ];

  return (
    <div className="app-page space-y-7">
      {/* Header Section */}
      <PageHeader
        kicker={isHolding ? 'Holding Executive Overview' : 'Overview Operasional'}
        kickerIcon={isHolding ? <Building2 size={13} className="text-amber-500" /> : <Sparkles size={13} />}
        title={`Assalamualaikum, ${user?.name ? user.name.split(' ')[0] : 'Ustadz'}.`}
        subtitle={
          isHolding ? (
            <>
              Ringkasan konsolidasi {brandCount} brand di bawah naungan{' '}
              <span className="font-semibold text-zinc-900">PT Azhan Mandiri Wisata Holding</span>.
            </>
          ) : (
            <>
              Aktivitas operasional dan konversi di{' '}
              <span className="font-semibold text-zinc-800">{currentBrandName}</span>.
            </>
          )
        }
        actions={
          <div className="flex items-center gap-2">
            {isSuperOrFinance && (
              <Select
                value={holdingScope}
                onValueChange={setHoldingScope}
                aria-label="Cakupan ringkasan"
                className="w-44"
                options={[
                  { value: 'all', label: 'Semua brand (holding)' },
                  ...(data?.brands ?? []).map((b: any) => ({ value: String(b.id), label: b.name })),
                ]}
              />
            )}
            <Button to="/inbox" icon={<MessageCircleMore size={15} />}>
              Buka Kotak Masuk
            </Button>
          </div>
        }
      />

      {/* Financial Health Summary Banner for Finance / Superadmin */}
      {isSuperOrFinance && (
        <section className="grid gap-4 sm:grid-cols-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/60">
              <Wallet size={18} />
            </span>
            <div>
              <p className="text-[11px] font-medium text-zinc-500">Kas Masuk Terverifikasi (DP + Lunas)</p>
              <p className="text-base font-bold text-zinc-950">{rupiah(data?.totalVerifiedCash ?? 0)}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700 border border-amber-200/60">
              <CreditCard size={18} />
            </span>
            <div>
              <p className="text-[11px] font-medium text-zinc-500">Sisa Tagihan / Piutang Jamaah</p>
              <p className="text-base font-bold text-zinc-950">{rupiah(data?.totalOutstanding ?? 0)}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              <CircleDollarSign size={18} />
            </span>
            <div>
              <p className="text-[11px] font-medium text-zinc-500">Total Nilai Kontrak Deal (Omzet Total)</p>
              <p className="text-base font-bold text-zinc-950">{rupiah(data?.totalDealValue ?? 0)}</p>
            </div>
          </div>
          {(Number(data?.totalOverpayment) > 0 || Number(data?.cashOnCancelled) > 0) && (
            <p className="sm:col-span-3 border-t border-zinc-100 pt-3 text-[11px] text-amber-800">
              Perlu rekonsiliasi Finance:
              {Number(data?.totalOverpayment) > 0 && <> kelebihan bayar <b>{rupiah(data.totalOverpayment)}</b></>}
              {Number(data?.totalOverpayment) > 0 && Number(data?.cashOnCancelled) > 0 && ' ·'}
              {Number(data?.cashOnCancelled) > 0 && <> dana pada booking batal (refund/pemindahan) <b>{rupiah(data.cashOnCancelled)}</b></>}
            </p>
          )}
        </section>
      )}

      {/* Vercel-Style Stat Metric Cards */}
      <section className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, note, icon: Icon }) => (
          <article
            key={label}
            className="surface p-5 transition-colors hover:border-zinc-300"
          >
            <div className="flex items-center justify-between text-zinc-400">
              <span className="text-xs font-medium text-zinc-500">{label}</span>
              <span className="grid h-7 w-7 place-items-center rounded-md bg-zinc-100 text-zinc-600">
                <Icon size={14} />
              </span>
            </div>
            <p className="mt-3 font-sans text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
              {value}
            </p>
            <p className="mt-2 text-xs text-zinc-400">
              {note}
            </p>
          </article>
        ))}
      </section>

      {/* Holding 5 Brands Comparison Table (A14) */}
      {isHolding && (data?.brandBreakdown?.length ?? 0) > 0 && (
        <section className="surface overflow-hidden">
          <div className="border-b border-zinc-200/90 px-6 py-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-950">Konsolidasi Performa {brandCount} Brand Holding</h3>
              <p className="mt-0.5 text-xs text-zinc-400">Perbandingan perolehan leads, booking pax, dan cashflow antar brand</p>
            </div>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
              {brandCount} Brand Aktif
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-5">Brand Travel</th>
                  <th className="py-3 px-4 text-center">Total Leads</th>
                  <th className="py-3 px-4 text-center">Deal Won</th>
                  <th className="py-3 px-4 text-center">Total Pax</th>
                  <th className="py-3 px-4 text-right">Omzet Deal</th>
                  <th className="py-3 px-4 text-right">Kas Terverifikasi</th>
                  <th className="py-3 px-4 text-right">Sisa Piutang</th>
                  <th className="py-3 px-5 text-center">Konversi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.brandBreakdown.map((b: any) => (
                  <tr key={b.id} className="hover:bg-zinc-50/75 transition">
                    <td className="py-3.5 px-5">
                      <div className="font-bold text-zinc-900">{b.name}</div>
                      <div className="text-[10px] text-zinc-400 font-mono">Kode: {b.code}</div>
                    </td>
                    <td className="py-3.5 px-4 text-center font-medium text-zinc-700">
                      {b.totalLeads}
                    </td>
                    <td className="py-3.5 px-4 text-center font-bold text-emerald-700">
                      {b.won}
                    </td>
                    <td className="py-3.5 px-4 text-center font-mono font-semibold text-zinc-800">
                      {b.totalPax} Pax
                    </td>
                    <td className="py-3.5 px-4 text-right font-medium text-zinc-900">
                      {moneyCompact(b.dealValue)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-semibold text-emerald-700">
                      {moneyCompact(b.verifiedCash)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-medium text-amber-700">
                      {moneyCompact(b.outstanding)}
                    </td>
                    <td className="py-3.5 px-5 text-center">
                      <span className="inline-block rounded-full bg-zinc-100 px-2.5 py-0.5 text-[10.5px] font-bold text-zinc-800">
                        {b.conversionRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Main Grid: Activity + Focus */}
      <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        {/* Recent Activity Table Card */}
        <article className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-200/90 px-6 py-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-950">Aktivitas Prospek Terbaru</h3>
              <p className="mt-0.5 text-xs text-zinc-400">Pembaruan interaksi dan pergerakan prospek di CRM</p>
            </div>
            <Link
              to="/pipeline"
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-black transition"
            >
              <span>Lihat pipeline</span>
              <ArrowRight size={13} />
            </Link>
          </div>

          <div className="divide-y divide-zinc-100">
            {data?.recent?.map((item: any) => (
              <Link
                to={`/prospects/${item.id}`}
                key={item.id}
                className="flex items-center gap-3.5 px-6 py-3.5 transition hover:bg-zinc-50/75"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700 border border-zinc-200/60">
                  {String(item.name ?? '?').slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <b className="truncate text-xs sm:text-sm font-semibold text-zinc-950">{item.name}</b>
                    {item.brand?.name && (
                      <span className="text-[10px] bg-zinc-100 text-zinc-600 rounded px-1.5 py-0.2 shrink-0">
                        {item.brand.name}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 truncate">
                    {item.city || item.phone} · PIC: {item.user?.name ?? 'Belum ada PIC'}
                    {item.package?.name && ` · Paket: ${item.package.name}`}
                  </p>
                </div>
                <Badge value={item.status} />
              </Link>
            ))}

            {!data?.recent?.length && (
              <div className="p-8">
                <SectionEmpty
                  title="Belum ada aktivitas"
                  description="Aktivitas terbaru tim CS dan prospek akan muncul di sini."
                />
              </div>
            )}
          </div>
        </article>

        {/* Sidebar Cards */}
        <aside className="space-y-4">
          {/* WhatsApp Gateway Status */}
          <article className="surface p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-zinc-400">
                  {isHolding ? 'WhatsApp Gateway Holding' : 'WhatsApp Gateway'}
                </p>
                <h3 className="mt-1 text-base font-semibold text-zinc-950">
                  {data?.wa?.status === 'connected' ? 'Terhubung & Aktif' : data?.wa?.status === 'connecting' ? 'Sebagian Terhubung' : 'Belum Terhubung'}
                </h3>
              </div>
              <span
                className={`relative flex h-3 w-3 ${
                  data?.wa?.status === 'connected' ? 'text-emerald-500' : 'text-zinc-300'
                }`}
              >
                {data?.wa?.status === 'connected' && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex h-3 w-3 rounded-full ${
                    data?.wa?.status === 'connected' ? 'bg-emerald-500' : 'bg-zinc-300'
                  }`}
                />
              </span>
            </div>
            <p className="mt-2.5 text-xs text-zinc-500 leading-relaxed font-mono">
              {data?.wa?.phoneNumber ?? 'Hubungkan nomor WhatsApp brand untuk mulai menerima pesan.'}
            </p>
          </article>

          {/* Sisa Kuota Paket Umroh Aktif */}
          {(data?.activePackages?.length ?? 0) > 0 && (
            <article className="surface p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
                <div className="flex items-center gap-1.5 text-zinc-800 font-bold text-xs">
                  <Plane size={14} className="text-indigo-600" />
                  <span>Sisa Kuota Paket Umroh</span>
                </div>
                <Link to="/packages" className="text-[11px] font-medium text-indigo-600 hover:underline">
                  Semua Paket
                </Link>
              </div>

              <div className="space-y-2">
                {data.activePackages.map((pkg: any) => (
                  <div key={pkg.id} className="flex items-center justify-between text-xs p-1.5 rounded-lg hover:bg-zinc-50">
                    <div className="min-w-0 pr-2">
                      <p className="font-semibold text-zinc-900 truncate">{pkg.name}</p>
                      <p className="text-[10px] text-zinc-400">
                        {pkg.departureInfo || (pkg.departureDate ? new Date(pkg.departureDate).toLocaleDateString('id-ID') : 'Jadwal Reguler')}
                        {isHolding && pkg.brand?.name ? ` · ${pkg.brand.name}` : ''}
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                        (pkg.quotaRemaining ?? 0) <= 5
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {pkg.quotaRemaining !== null && pkg.quotaRemaining !== undefined
                        ? `Sisa ${pkg.quotaRemaining}`
                        : 'Tersedia'}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          )}

          {/* Vercel-Style Focus Banner */}
          <article className="rounded-xl border border-zinc-900 bg-zinc-950 p-6 text-white shadow-xs">
            <div className="flex items-center gap-2 text-zinc-400">
              <TrendingUp size={16} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Fokus Tim CS & Closing</span>
            </div>
            <h3 className="mt-3 font-sans text-lg font-bold leading-snug tracking-tight text-white">
              Respons cepat, data terintegrasi, transaksi aman.
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              Verifikasi DP dilakukan oleh tim Finance, kuota seat berkurang otomatis, dan data holding terpusat rapi.
            </p>
          </article>
        </aside>
      </section>
    </div>
  );
}

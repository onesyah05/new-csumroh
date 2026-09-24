import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CircleDollarSign,
  Compass,
  Inbox,
  MessageCircleMore,
  Plane,
  ShieldAlert,
  Smartphone,
  Trophy,
  Users2,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { isWonStatus } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { isHoldingRole, useBrandScope } from '../../lib/scope';
import { Select } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../app/auth';
import { PageError, PageLoading, SectionEmpty } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { ProspectAvatar } from '../../components/ui/avatar';
import { useWhatsAppAvatars } from '../../lib/avatars';

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

function formatRelativeTime(dateStr?: string | null) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'Baru saja';
  if (diffMinutes < 60) return `${diffMinutes} mnt lalu`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} jam lalu`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} hari lalu`;
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

export function DashboardPage() {
  const { user } = useAuth();
  const { brandId, query } = useBrandScope();
  const isSuperOrFinance = isHoldingRole(user?.role);
  const [holdingScope, setHoldingScope] = useState<string>('all');
  const [activityFilter, setActivityFilter] = useState<'all' | 'new' | 'won' | 'unassigned'>('all');

  const scopeParam = isSuperOrFinance ? `?brandId=${holdingScope}` : query;

  const dashboard = useQuery({
    queryKey: ['dashboard', isSuperOrFinance ? holdingScope : brandId],
    queryFn: () => api.get<any>(`/dashboard${scopeParam}`),
    enabled: !!brandId || isSuperOrFinance,
  });

  const data = dashboard.data;
  // Foto profil WhatsApp aktivitas terbaru (disalin API; siluet bila kontak tidak memasang foto).
  const photoFor = useWhatsAppAvatars(data?.recent, data?.currentBrandId ?? brandId);
  const brandCount = data?.brands?.length ?? 0;
  const currentBrandName =
    data?.brands?.find((b: any) => b.id === data?.currentBrandId)?.name ?? user?.brand?.name ?? 'Brand Terpilih';

  if (!brandId && !isSuperOrFinance) {
    return (
      <PageError
        title="Belum ada brand aktif"
        description="Akun Anda belum dikaitkan dengan brand tertentu. Hubungi Administrator untuk penugasan brand."
      />
    );
  }

  if (dashboard.isLoading) return <PageLoading label="Memuat ringkasan dashboard..." />;
  if (dashboard.isError) {
    return <PageError description={dashboard.error.message} onRetry={() => void dashboard.refetch()} />;
  }

  const isHolding = data?.isHoldingView;
  const wonCount = Number(data?.won ?? 0);
  const totalCount = Number(data?.total ?? 0);
  const unassignedCount = Number(data?.unassigned ?? 0);
  const dealValue = Number(data?.totalDealValue ?? 0);
  const verifiedCash = Number(data?.totalVerifiedCash ?? 0);
  const outstanding = Number(data?.totalOutstanding ?? 0);

  const recentProspects = (data?.recent ?? []).filter((item: any) => {
    if (activityFilter === 'all') return true;
    if (activityFilter === 'new') return item.status === 'new';
    if (activityFilter === 'won') return isWonStatus(item.status);
    if (activityFilter === 'unassigned') return !item.user;
    return true;
  });

  return (
    <div className="app-page space-y-6">
      {/* 1. CLEAN PAGE HEADER */}
      <PageHeader
        kicker={isHolding ? undefined : currentBrandName}
        title="Ringkasan Sales"
        subtitle={
          isHolding
            ? `Performa akuisisi prospek, aktivitas CS WhatsApp, dan konversi closing seluruh brand.`
            : `Performa akuisisi prospek, aktivitas CS WhatsApp, dan konversi closing.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {isSuperOrFinance && (
              <Select
                value={holdingScope}
                onValueChange={setHoldingScope}
                size="sm"
                aria-label="Filter cakupan brand"
                className="w-auto text-xs"
                options={[
                  { value: 'all', label: 'Semua Brand' },
                  ...(data?.brands ?? []).map((b: any) => ({
                    value: String(b.id),
                    label: b.name,
                  })),
                ]}
              />
            )}
            <Button
              to="/inbox"
              variant="primary"
              size="sm"
              icon={<MessageCircleMore size={15} />}
            >
              Buka Kotak Masuk
            </Button>
            <Button
              to="/pipeline"
              variant="secondary"
              size="sm"
              icon={<Compass size={14} />}
            >
              Pipeline
            </Button>
          </div>
        }
      />

      {/* RECONCILIATION NOTICE (ONLY IF DISCREPANCY EXISTS) */}
      {(Number(data?.totalOverpayment) > 0 || Number(data?.cashOnCancelled) > 0) && (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-amber-600 shrink-0" />
            <span>
              <b>Perlu Tindakan Keuangan:</b>{' '}
              {Number(data?.totalOverpayment) > 0 && (
                <span>Lebih bayar <b>{rupiah(data.totalOverpayment)}</b>. </span>
              )}
              {Number(data?.cashOnCancelled) > 0 && (
                <span>Dana booking batal <b>{rupiah(data.cashOnCancelled)}</b> menunggu refund / pindah seat.</span>
              )}
            </span>
          </div>
          <Link to="/finance" className="font-semibold text-amber-900 hover:underline shrink-0 ml-3">
            Cek Finance &rarr;
          </Link>
        </div>
      )}

      {/* 2. CORE METRICS STRIP (CLEAN, SINGLE-LAYER CARDS) */}
      <section className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Prospek */}
        <div className="surface p-5">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium text-zinc-500">
              Total Prospek
            </span>
            <Inbox size={16} className="text-zinc-400" />
          </div>
          <p className="mt-2 font-sans text-3xl font-bold tracking-tight text-zinc-950">
            {totalCount}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
            <span>Akuisisi prospek</span>
            {unassignedCount > 0 ? (
              <Link
                to="/pipeline"
                className="font-medium text-amber-700 hover:underline"
              >
                {unassignedCount} belum ada CS
              </Link>
            ) : (
              <span className="text-emerald-700 font-medium">Semua ditangani CS</span>
            )}
          </div>
        </div>

        {/* Card 2: Total Deal */}
        <div className="surface p-5">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium text-zinc-500">Total Deal</span>
            <Users2 size={16} className="text-zinc-400" />
          </div>
          <p className="mt-2 font-sans text-3xl font-bold tracking-tight text-zinc-950">
            {wonCount}
          </p>
          <p className="mt-2 text-xs text-zinc-400">
            {data?.totalPax ?? 0} Pax seat terjual
          </p>
        </div>

        {/* Card 3: Nilai Deal */}
        <div className="surface p-5">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium text-zinc-500">Nilai Deal</span>
            <CircleDollarSign size={16} className="text-zinc-400" />
          </div>
          <p className="mt-2 font-sans text-3xl font-bold tracking-tight text-zinc-950 truncate">
            {moneyCompact(dealValue)}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
            <span>Terverifikasi: <b className="text-zinc-700 font-medium">{moneyCompact(verifiedCash)}</b></span>
          </div>
        </div>

        {/* Card 4: Konversi Closing */}
        <div className="surface p-5">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium text-zinc-500">Konversi Closing</span>
            <Trophy size={16} className="text-zinc-400" />
          </div>
          <p className="mt-2 font-sans text-3xl font-bold tracking-tight text-zinc-950">
            {data?.conversionRate ?? 0}%
          </p>
          <p className="mt-2 text-xs text-zinc-400">
            {wonCount} closing dari {totalCount} prospek
          </p>
        </div>
      </section>

      {/* 3. MAIN CONTENT: LEFT (2/3) + RIGHT (1/3) */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* LEFT COLUMN: BRAND TABLE (IF HOLDING) + RECENT PROSPECTS */}
        <div className="space-y-6 lg:col-span-2">
          {/* Performa Brand Table (Holding View Only) */}
          {isHolding && (data?.brandBreakdown?.length ?? 0) > 0 && (
            <section className="surface overflow-hidden">
              <div className="border-b border-zinc-200/90 px-5 py-3.5 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950">Performa Sales per Brand</h3>
                  <p className="text-xs text-zinc-400">Akuisisi prospek, transaksi deal, dan closing per brand</p>
                </div>
                <span className="text-xs font-medium text-zinc-500 bg-zinc-100 rounded-md px-2 py-0.5">
                  {brandCount} Brand
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-50/80 border-b border-zinc-200/70 text-zinc-500 font-semibold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-2.5 px-4">Brand</th>
                      <th className="py-2.5 px-3 text-center">Prospek</th>
                      <th className="py-2.5 px-3 text-center">Deal</th>
                      <th className="py-2.5 px-3 text-center">Pax</th>
                      <th className="py-2.5 px-3 text-right">Nilai Paket</th>
                      <th className="py-2.5 px-3 text-right">Terverifikasi</th>
                      <th className="py-2.5 px-4 text-center">Closing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {data.brandBreakdown.map((b: any) => (
                      <tr key={b.id} className="hover:bg-zinc-50/70 transition">
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => setHoldingScope(String(b.id))}
                            className="text-left group"
                          >
                            <span className="font-semibold text-zinc-900 group-hover:text-blue-600 transition">
                              {b.name}
                            </span>
                          </button>
                        </td>
                        <td className="py-3 px-3 text-center font-medium text-zinc-700">
                          {b.totalLeads}
                        </td>
                        <td className="py-3 px-3 text-center font-medium text-emerald-700">
                          {b.won}
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-medium text-zinc-800">
                          {b.totalPax}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-zinc-900 tabular-nums">
                          {moneyCompact(b.dealValue)}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-emerald-700 tabular-nums">
                          {moneyCompact(b.verifiedCash)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold text-zinc-700 bg-zinc-100">
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

          {/* Aktivitas Prospek Terbaru */}
          <section className="surface overflow-hidden">
            <div className="border-b border-zinc-200/90 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-950">Aktivitas Prospek Terbaru</h3>
                <p className="text-xs text-zinc-400">Follow-up CS dan status prospek terkini</p>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1 text-xs">
                {[
                  { key: 'all', label: 'Semua' },
                  { key: 'new', label: 'Baru' },
                  { key: 'won', label: 'Deal' },
                  { key: 'unassigned', label: 'Belum Ada CS' },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setActivityFilter(f.key as any)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                      activityFilter === f.key
                        ? 'bg-zinc-900 text-white'
                        : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Prospects List */}
            <div className="divide-y divide-zinc-100">
              {recentProspects.map((item: any) => {
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-zinc-50/70 transition"
                  >
                    <Link
                      to={`/prospects/${item.id}`}
                      className="flex items-center gap-3 min-w-0 flex-1 group"
                    >
                      <ProspectAvatar photoUrl={photoFor(item)} size="md" />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs sm:text-sm text-zinc-950 group-hover:text-blue-600 transition truncate">
                            {item.name}
                          </span>
                          {item.brand?.name && isHolding && (
                            <span className="text-[10px] text-zinc-500 bg-zinc-100 rounded px-1.5 py-0.2 shrink-0">
                              {item.brand.name}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400 mt-0.5">
                          <span>{item.phone}</span>
                          {item.city && <span>· {item.city}</span>}
                          <span>·</span>
                          {item.user ? (
                            <span className="text-zinc-600 font-medium">CS: {item.user.name}</span>
                          ) : (
                            <span className="text-amber-700 font-medium">Belum ada CS</span>
                          )}
                          {item.package?.name && (
                            <span className="text-zinc-500 truncate max-w-[140px]">
                              · {item.package.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] text-zinc-400 hidden sm:inline">
                        {formatRelativeTime(item.updatedAt || item.createdAt)}
                      </span>
                      <Badge value={item.status} />
                    </div>
                  </div>
                );
              })}

              {!recentProspects.length && (
                <div className="p-8">
                  <SectionEmpty
                    title="Belum ada aktivitas"
                    description="Tidak ada data prospek pada filter ini."
                  />
                </div>
              )}
            </div>

            <div className="border-t border-zinc-100 px-5 py-3 bg-zinc-50/40 flex items-center justify-between text-xs">
              <span className="text-zinc-400">
                Menampilkan {recentProspects.length} dari {totalCount} prospek
              </span>
              <Link
                to="/pipeline"
                className="font-medium text-zinc-700 hover:text-black inline-flex items-center gap-1 transition"
              >
                <span>Buka Pipeline &rarr;</span>
              </Link>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: WHATSAPP STATUS + PACKAGES QUOTA */}
        <div className="space-y-6">
          {/* WhatsApp Gateway Card */}
          <section className="surface p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone size={16} className="text-zinc-500" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-700">
                  WhatsApp Gateway
                </h4>
              </div>

              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border ${
                  data?.wa?.status === 'connected'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : data?.wa?.status === 'connecting'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    data?.wa?.status === 'connected'
                      ? 'bg-emerald-600'
                      : data?.wa?.status === 'connecting'
                      ? 'bg-amber-600'
                      : 'bg-zinc-400'
                  }`}
                />
                {data?.wa?.status === 'connected'
                  ? 'Terhubung'
                  : data?.wa?.status === 'connecting'
                  ? 'Menghubungkan'
                  : 'Terputus'}
              </span>
            </div>

            <p className="text-xs text-zinc-600 font-mono bg-zinc-50 rounded-lg p-2.5 border border-zinc-100">
              {data?.wa?.phoneNumber ?? 'Belum ada nomor yang dikonfigurasi.'}
            </p>

            <div className="flex items-center justify-between pt-1 text-xs">
              <span className="text-zinc-400">
                {isHolding
                  ? `${data?.wa?.connectedChannels ?? 0} dari ${data?.wa?.totalChannels ?? 0} channel CS aktif`
                  : 'Channel WhatsApp CS aktif'}
              </span>
              <Link to="/device" className="font-medium text-zinc-700 hover:text-black hover:underline">
                Kelola &rarr;
              </Link>
            </div>
          </section>

          {/* Kuota Paket Umroh Aktif */}
          {(data?.activePackages?.length ?? 0) > 0 && (
            <section className="surface p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
                <div className="flex items-center gap-2 text-zinc-800 font-semibold text-xs">
                  <Plane size={14} className="text-zinc-500" />
                  <span>Sisa Kuota Paket</span>
                </div>
                <Link to="/packages" className="text-xs font-medium text-zinc-500 hover:text-black hover:underline">
                  Lihat Semua &rarr;
                </Link>
              </div>

              <div className="space-y-2">
                {data.activePackages.map((pkg: any) => {
                  const remaining = pkg.quotaRemaining;
                  const isLow = remaining !== null && remaining !== undefined && remaining <= 5;

                  return (
                    <div
                      key={pkg.id}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-zinc-50 transition text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="font-medium text-zinc-900 truncate">{pkg.name}</p>
                        <p className="text-[10px] text-zinc-400">
                          {pkg.departureInfo ||
                            (pkg.departureDate
                              ? new Date(pkg.departureDate).toLocaleDateString('id-ID', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                })
                              : 'Jadwal Reguler')}
                          {isHolding && pkg.brand?.name ? ` · ${pkg.brand.name}` : ''}
                        </p>
                      </div>

                      <span
                        className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded border shrink-0 ${
                          isLow
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-zinc-100 text-zinc-700 border-zinc-200'
                        }`}
                      >
                        {remaining !== null && remaining !== undefined ? `Sisa ${remaining} seat` : 'Tersedia'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Akses Cepat */}
          <section className="surface p-4 text-xs space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block">
              Akses Cepat
            </span>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Link
                to="/contacts"
                className="p-2.5 rounded-lg border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 transition font-medium text-zinc-800 text-center"
              >
                Buku Kontak
              </Link>
              <Link
                to="/scripts"
                className="p-2.5 rounded-lg border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 transition font-medium text-zinc-800 text-center"
              >
                Script CS
              </Link>
              <Link
                to="/packages"
                className="p-2.5 rounded-lg border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 transition font-medium text-zinc-800 text-center"
              >
                Katalog Paket
              </Link>
              <Link
                to="/finance"
                className="p-2.5 rounded-lg border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 transition font-medium text-zinc-800 text-center"
              >
                Verifikasi Pembayaran
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

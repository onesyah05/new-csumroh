import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  MoreHorizontal,
  PackageOpen,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from 'lucide-react';
import { api, resolveMediaUrl } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { useUiStore } from '../../app/store';
import { Select } from '../../components/ui/select';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { StatGrid, StatCard } from '../../components/ui/stat-card';
import { StatusBadge } from '../../components/ui/status-badge';
import { PackageItem } from './PackageDetailPage';
import { showFeedback } from '../../app/toast';
import { ConfirmDialog } from '../../components/ui/modal';
import { EmptyState } from '../../components/ui/page-feedback';

/* ─── Thumbnail Component with Error Fallback ────────────────── */
function PackageThumbnail({
  src,
  alt,
  onClick,
}: {
  src?: string | null;
  alt: string;
  onClick?: () => void;
}) {
  const [hasError, setHasError] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 flex items-center justify-center text-zinc-500 hover:opacity-90 transition cursor-pointer shadow-2xs"
      title="Lihat detail paket"
    >
      {src && !hasError ? (
        <img
          src={resolveMediaUrl(src)}
          alt={alt}
          onError={() => setHasError(true)}
          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
        />
      ) : (
        <PackageOpen size={18} className="text-zinc-500 group-hover:text-zinc-600 transition-colors" />
      )}
    </button>
  );
}

export function PackagesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { activeBrandId, setActiveBrandId } = useUiStore();
  const isSuperadmin = user?.role === 'superadmin';
  const canManage = user?.role === 'superadmin' || user?.role === 'admin';

  // Brands list (for superadmin filter)
  const brandsQuery = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<any[]>('/catalog/brands'),
    enabled: isSuperadmin,
  });
  const brands = brandsQuery.data ?? [];

  // Selected brand for superadmin
  const [filterBrandId, setFilterBrandId] = useState<number | null>(
    isSuperadmin ? (activeBrandId ?? null) : null
  );

  // Filters state
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [quotaFilter, setQuotaFilter] = useState<'' | 'available' | 'low' | 'sold_out'>('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'archived'>('');

  // Pagination state
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Delete modal state
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<PackageItem | null>(null);

  // Query packages with filters
  const effectiveBrandId = isSuperadmin ? (filterBrandId || undefined) : user?.brandId;
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (effectiveBrandId) params.set('brandId', String(effectiveBrandId));
    if (search.trim()) params.set('q', search.trim());
    if (monthFilter) params.set('month', monthFilter);
    if (quotaFilter) params.set('quota', quotaFilter);
    if (statusFilter) params.set('status', statusFilter);
    const s = params.toString();
    return s ? `?${s}` : '';
  }, [effectiveBrandId, search, monthFilter, quotaFilter, statusFilter]);

  const packagesQuery = useQuery({
    queryKey: ['packages', effectiveBrandId, search, monthFilter, quotaFilter, statusFilter],
    queryFn: () => api.get<PackageItem[]>(`/catalog/packages${queryString}`),
  });

  const packages = packagesQuery.data ?? [];

  // Month list extracted from packages data for dropdown
  const monthList = useMemo(() => {
    const months = new Set<string>();
    packages.forEach((p) => {
      if (p.departureDate) {
        months.add(p.departureDate.slice(0, 7));
      }
    });
    return Array.from(months).sort();
  }, [packages]);

  // Toast state

  function showToast(msg: string) {
    showFeedback(msg);
  }

  // Mutations
  const toggleMutation = useMutation({
    mutationFn: (id: number) => api.patch<{ id: number; isActive: boolean }>(`/catalog/packages/${id}/toggle`, {}),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['packages'] });
      queryClient.setQueriesData<PackageItem[]>({ queryKey: ['packages'] }, (old) =>
        old?.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p))
      );
    },
    onSuccess: (data: any, id) => {
      const item = packages.find((p) => p.id === id);
      const isNowActive = data?.isActive !== undefined ? data.isActive : !item?.isActive;
      showToast(
        item
          ? `${item.name} berhasil ${isNowActive ? 'diaktifkan' : 'diarsipkan'}.`
          : `Paket berhasil ${isNowActive ? 'diaktifkan' : 'diarsipkan'}.`
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['packages'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/catalog/packages/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['packages'] });
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      const name = deleteConfirmItem?.name ?? 'Paket';
      setDeleteConfirmItem(null);
      showToast(`Paket "${name}" berhasil dihapus.`);
    },
    onError: (e: any) => showToast(e?.message || 'Gagal menghapus paket.'),
  });

  const hasActiveFilters = Boolean(search || monthFilter || quotaFilter || statusFilter || (isSuperadmin && filterBrandId));

  const resetFilters = () => {
    setSearch('');
    setMonthFilter('');
    setQuotaFilter('');
    setStatusFilter('');
    if (isSuperadmin) setFilterBrandId(null);
    setPage(1);
  };

  // Quick stats
  const totalSeats = useMemo(() => packages.reduce((acc, cur) => acc + (cur.quotaRemaining ?? 0), 0), [packages]);
  const totalPromo = useMemo(() => packages.filter((p) => p.isPromo).length, [packages]);
  const activeCount = useMemo(() => packages.filter((p) => p.isActive).length, [packages]);

  // Pagination calculations
  const totalItems = packages.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pagedPackages = useMemo(() => {
    return packages.slice(startIndex, startIndex + pageSize);
  }, [packages, startIndex, pageSize]);

  // Page numbers for pagination UI
  const pageNumbers = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | string)[] = [];
    if (currentPage <= 3) {
      pages.push(1, 2, 3, 4, '...', totalPages);
    } else if (currentPage >= totalPages - 2) {
      pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
    }
    return pages;
  }, [currentPage, totalPages]);

  return (
    <div className="app-page space-y-6">
      {/* Header */}
      <PageHeader
        title="Paket Umroh"
        subtitle="Kelola program perjalanan umroh, kuota seat, dan harga paket."
        actions={
          canManage ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => navigate('/packages/new')}
              icon={<Plus size={14} />}
            >
              Tambah Paket
            </Button>
          ) : undefined
        }
      />

      {/* 4 Metric Stats */}
      <StatGrid cols={4}>
        <StatCard label="Total Paket" value={packages.length} note="Semua program" />
        <StatCard label="Sisa Kuota" value={`${totalSeats} Seat`} note="Seat tersedia" />
        <StatCard label="Paket Promo" value={totalPromo} note="Program promo" />
        <StatCard label="Paket Aktif" value={activeCount} note="Status aktif" />
      </StatGrid>

      {/* Search & Filters Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-xs text-zinc-900 outline-none focus:border-black focus:ring-1 focus:ring-black transition placeholder:text-zinc-400 shadow-xs"
            placeholder="Cari nama paket, maskapai, hotel…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        {/* Brand Filter (Superadmin) */}
        {isSuperadmin && brands.length > 1 && (
          <Select
            value={filterBrandId ? String(filterBrandId) : 'all'}
            onValueChange={(val) => {
              const bId = val === 'all' ? null : Number(val);
              setFilterBrandId(bId);
              setActiveBrandId(bId);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'Semua Brand' },
              ...brands.map((b) => ({
                value: String(b.id),
                label: b.name,
              })),
            ]}
            className="h-9 min-w-[150px] text-xs font-medium rounded-lg border-zinc-200 shadow-xs focus:ring-1 focus:ring-zinc-950 py-0"
          />
        )}

        {/* Month Filter */}
        {monthList.length > 0 && (
          <Select
            value={monthFilter || 'all'}
            onValueChange={(val) => {
              setMonthFilter(val === 'all' ? '' : val);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'Semua Bulan' },
              ...monthList.map((m) => {
                const [y, mo] = m.split('-');
                const date = new Date(Number(y), Number(mo) - 1, 1);
                return {
                  value: m,
                  label: date.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' }),
                };
              }),
            ]}
            className="h-9 min-w-[130px] text-xs font-medium rounded-lg border-zinc-200 shadow-xs focus:ring-1 focus:ring-zinc-950 py-0"
          />
        )}

        {/* Quota Filter */}
        <Select
          value={quotaFilter || 'all'}
          onValueChange={(val) => {
            setQuotaFilter(val === 'all' ? '' : (val as any));
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'Semua Kuota' },
            { value: 'available', label: 'Tersedia (>0)' },
            { value: 'low', label: 'Menipis (≤5)' },
            { value: 'sold_out', label: 'Habis (0)' },
          ]}
          className="h-9 min-w-[130px] text-xs font-medium rounded-lg border-zinc-200 shadow-xs focus:ring-1 focus:ring-zinc-950 py-0"
        />

        {/* Status Pills Filter */}
        <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 shadow-xs shrink-0">
          {(['all', 'active', 'archived'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStatusFilter(s === 'all' ? '' : s);
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                (s === 'all' && !statusFilter) || statusFilter === s
                  ? 'bg-zinc-950 text-white font-semibold shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-950'
              }`}
            >
              {s === 'all' ? 'Semua' : s === 'active' ? 'Aktif' : 'Arsip'}
            </button>
          ))}
        </div>

        {/* Reset Filter Button */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:border-zinc-950 hover:text-black transition shadow-xs shrink-0 cursor-pointer"
            title="Reset filter"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        )}
      </div>

      {/* Packages Listing */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {packagesQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-zinc-500">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-xs">Memuat katalog paket…</span>
          </div>
        ) : packages.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title="Tidak ada paket ditemukan"
            description={hasActiveFilters ? 'Coba sesuaikan kata kunci pencarian atau filter yang aktif.' : 'Belum ada paket umroh yang terdaftar.'}
            action={hasActiveFilters ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={resetFilters}
                >
                  Reset Filter
                </Button>
              ) : canManage ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('/packages/new')}
                  icon={<Plus size={14} />}
                >
                  Tambah Paket
                </Button>
              ) : null}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              {/* Di bawah lg kolom Brand & Promo disembunyikan agar nyaman di split-screen; lengkap di Detail Paket. */}
              <table className="w-full text-left text-xs lg:min-w-[940px]">
                <thead className="border-b border-zinc-200 bg-zinc-50/75 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Paket Umroh</th>
                    <th className="hidden px-4 py-3 lg:table-cell">Brand</th>
                    <th className="px-4 py-3">Keberangkatan</th>
                    <th className="px-4 py-3">Harga (Quad)</th>
                    <th className="hidden px-4 py-3 lg:table-cell">Promo</th>
                    <th className="px-4 py-3 text-center">Sisa Kuota</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {pagedPackages.map((item) => {
                    const departureStr =
                      item.departureInfo ||
                      (item.departureDate
                        ? new Date(item.departureDate).toLocaleDateString('id-ID', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : 'Jadwal menyusul');
                    const quadPrice = item.priceQuad || item.price || '-';
                    const isLowSeat =
                      item.quotaRemaining !== null &&
                      item.quotaRemaining !== undefined &&
                      item.quotaRemaining <= 5;

                    return (
                      <tr key={item.id} className="group hover:bg-zinc-50/60 transition-colors">
                        {/* Package Info & Thumbnail */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <PackageThumbnail
                              src={item.flyerImage}
                              alt={item.name}
                              onClick={() => navigate(`/packages/${item.id}`)}
                            />
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => navigate(`/packages/${item.id}`)}
                                className="font-bold text-xs text-zinc-950 hover:underline text-left tracking-tight truncate max-w-xs sm:max-w-sm cursor-pointer block"
                              >
                                {item.name}
                              </button>
                              <p className="text-xs text-zinc-500 truncate mt-0.5">
                                {item.airline || 'Maskapai TBA'} · {item.flightType === 'transit' ? 'Transit' : 'Direct'}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Brand */}
                        <td className="hidden px-4 py-3 whitespace-nowrap lg:table-cell">
                          <span className="font-semibold text-zinc-800">
                            {item.brand?.name || '-'}
                          </span>
                        </td>

                        {/* Departure Date & Duration */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <b className="block font-bold text-zinc-900">{departureStr}</b>
                          <span className="text-xs text-zinc-500">{item.duration || '9 Hari'}</span>
                        </td>

                        {/* Quad Price */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-mono text-xs font-semibold text-zinc-950">{quadPrice}</span>
                        </td>

                        {/* Promo */}
                        <td className="hidden px-4 py-3 whitespace-nowrap lg:table-cell">
                          {item.isPromo ? (
                            <div>
                              <span className="block font-mono text-xs font-semibold text-zinc-950">
                                {item.promoDiscount
                                  ? (() => {
                                      const clean = item.promoDiscount.replace(/diskon\s*/gi, '').trim();
                                      return clean.startsWith('Rp') ? clean : `Rp ${clean}`;
                                    })()
                                  : 'Promo'}
                              </span>
                              {item.promoDeadline && (
                                <span className="block text-xs text-zinc-500">
                                  Hingga {new Date(item.promoDeadline).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-zinc-500 font-mono text-xs">-</span>
                          )}
                        </td>

                        {/* Remaining Quota */}
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-xs font-semibold ${
                              isLowSeat
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : 'bg-zinc-100 text-zinc-700 border border-zinc-200/60'
                            }`}
                          >
                            {item.quotaRemaining ?? 0} Seat
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <StatusBadge
                            status={item.isActive ? 'active' : 'archived'}
                            label={item.isActive ? 'Aktif' : 'Arsip'}
                            dot
                          />
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-zinc-500 hover:border-zinc-200 hover:bg-zinc-100 hover:text-zinc-700 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-zinc-950/15"
                                title="Menu opsi paket"
                                aria-label={`Aksi paket ${item.name}`}
                              >
                                <MoreHorizontal size={16} />
                              </button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                align="end"
                                sideOffset={4}
                                className="z-50 min-w-[165px] rounded-xl border border-zinc-200 bg-white p-1 text-xs shadow-lg shadow-zinc-950/5 animate-in fade-in-80"
                              >
                                <DropdownMenu.Item
                                  onSelect={() => navigate(`/packages/${item.id}`)}
                                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-700 outline-none hover:bg-zinc-100 hover:text-zinc-950 transition-colors"
                                >
                                  <Eye size={13} className="text-zinc-500" />
                                  <span>Lihat Detail</span>
                                </DropdownMenu.Item>

                                {canManage && (
                                  <>
                                    <DropdownMenu.Item
                                      onSelect={() => navigate(`/packages/${item.id}/edit`)}
                                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-700 outline-none hover:bg-zinc-100 hover:text-zinc-950 transition-colors"
                                    >
                                      <Pencil size={13} className="text-zinc-500" />
                                      <span>Edit Paket</span>
                                    </DropdownMenu.Item>

                                    <DropdownMenu.Item
                                      onSelect={() => toggleMutation.mutate(item.id)}
                                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-700 outline-none hover:bg-zinc-100 hover:text-zinc-950 transition-colors"
                                    >
                                      {item.isActive ? (
                                        <>
                                          <ToggleLeft size={14} className="text-zinc-500" />
                                          <span>Arsipkan Paket</span>
                                        </>
                                      ) : (
                                        <>
                                          <ToggleRight size={14} className="text-emerald-600" />
                                          <span>Aktifkan Paket</span>
                                        </>
                                      )}
                                    </DropdownMenu.Item>

                                    <DropdownMenu.Separator className="my-1 border-t border-zinc-100" />

                                    <DropdownMenu.Item
                                      onSelect={() => setDeleteConfirmItem(item)}
                                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 outline-none hover:bg-rose-50 hover:text-rose-700 transition-colors"
                                    >
                                      <Trash2 size={13} className="text-rose-500" />
                                      <span>Hapus Paket</span>
                                    </DropdownMenu.Item>
                                  </>
                                )}
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination & Count Footer */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50/50 px-4 py-3 text-xs text-zinc-600">
              <span className="text-xs text-zinc-500">
                Menampilkan <strong className="font-semibold text-zinc-900">{totalItems === 0 ? 0 : startIndex + 1}</strong>
                –<strong className="font-semibold text-zinc-900">{Math.min(startIndex + pageSize, totalItems)}</strong> dari{' '}
                <strong className="font-semibold text-zinc-900">{totalItems}</strong> paket
              </span>

              {totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-xs cursor-pointer"
                  >
                    <ChevronLeft size={14} />
                    Sebelumnya
                  </button>

                  <div className="flex items-center gap-1">
                    {pageNumbers.map((p, idx) =>
                      p === '...' ? (
                        <span key={`dots-${idx}`} className="px-1.5 text-zinc-500 select-none">
                          …
                        </span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPage(Number(p))}
                          className={`h-8 min-w-[32px] px-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                            currentPage === p
                              ? 'bg-zinc-950 text-white shadow-xs'
                              : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 shadow-xs'
                          }`}
                        >
                          {p}
                        </button>
                      )
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-xs cursor-pointer"
                  >
                    Berikutnya
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteConfirmItem)}
        onClose={() => setDeleteConfirmItem(null)}
        onConfirm={() => deleteConfirmItem && deleteMutation.mutate(deleteConfirmItem.id)}
        pending={deleteMutation.isPending}
        title="Hapus paket?"
        description={<>Paket <strong>{deleteConfirmItem?.name}</strong> akan dihapus. Tindakan ini tidak dapat dibatalkan.</>}
        confirmLabel="Hapus paket"
      />

    </div>
  );
}

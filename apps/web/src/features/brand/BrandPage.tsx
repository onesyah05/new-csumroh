import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Eye,
  Loader2,
  MapPin,
  PackageOpen,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Smartphone,
  Trash2,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { RowActions } from '../../components/ui/row-actions';
import { api, resolveMediaUrl } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { StatGrid, StatCard } from '../../components/ui/stat-card';
import { StatusBadge } from '../../components/ui/status-badge';
import { showFeedback } from '../../app/toast';
import { ConfirmDialog } from '../../components/ui/modal';
import { EmptyState } from '../../components/ui/page-feedback';

interface BrandItem {
  id: number;
  name: string;
  code: string;
  logoUrl?: string | null;
  ppiuNumber?: string | null;
  phone?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountHolder?: string | null;
  address?: string | null;
  gmapsUrl?: string | null;
  whatsappSession?: {
    id: number;
    status: string;
    phoneNumber?: string | null;
  } | null;
  _count?: {
    users: number;
    prospects: number;
    packages: number;
  };
}

export function BrandPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = user?.role === 'superadmin';

  // Filters & Search
  const [search, setSearch] = useState('');
  const [waFilter, setWaFilter] = useState<'all' | 'connected' | 'disconnected'>('all');

  // Pagination state
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Modals & Feedback
  const [deleteTarget, setDeleteTarget] = useState<BrandItem | null>(null);

  function showToast(msg: string) {
    showFeedback(msg);
  }

  // Fetch brands
  const brandsQuery = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<BrandItem[]>('/catalog/brands'),
  });

  const brands = brandsQuery.data ?? [];

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/catalog/brands/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      const deletedName = deleteTarget?.name ?? 'Brand';
      setDeleteTarget(null);
      showToast(`Brand "${deletedName}" berhasil dihapus.`);
    },
    onError: (err: any) => {
      showToast(err?.message || 'Gagal menghapus brand.');
    },
  });

  // Filtered brands
  const filtered = useMemo(() => {
    return brands.filter((b) => {
      const q = search.trim().toLowerCase();
      const matchQuery = !q || b.name.toLowerCase().includes(q) || b.code?.toLowerCase().includes(q);
      const isConnected = b.whatsappSession?.status === 'connected';
      const matchWa =
        waFilter === 'all' ||
        (waFilter === 'connected' && isConnected) ||
        (waFilter === 'disconnected' && !isConnected);

      return matchQuery && matchWa;
    });
  }, [brands, search, waFilter]);

  const hasActiveFilters = Boolean(search || waFilter !== 'all');

  const resetFilters = () => {
    setSearch('');
    setWaFilter('all');
    setPage(1);
  };

  // Quick stats
  const totalUsers = useMemo(() => brands.reduce((acc, b) => acc + (b._count?.users ?? 0), 0), [brands]);
  const totalPackages = useMemo(() => brands.reduce((acc, b) => acc + (b._count?.packages ?? 0), 0), [brands]);
  const connectedCount = useMemo(
    () => brands.filter((b) => b.whatsappSession?.status === 'connected').length,
    [brands]
  );

  // Pagination calculations
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pagedBrands = useMemo(() => {
    return filtered.slice(startIndex, startIndex + pageSize);
  }, [filtered, startIndex, pageSize]);

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
    <div className="app-page space-y-6 pb-16">
      {/* Header */}
      <PageHeader
        className="hidden md:flex"
        title="Brand Travel"
        subtitle="Profil biro travel umroh, legalitas PPIU, rekening resmi, dan status gateway WhatsApp."
        actions={
          canManage ? (
            <Button variant="primary" to="/brands/new" icon={<Plus size={14} />}>
              Tambah Brand
            </Button>
          ) : undefined
        }
      />

      {/* 4 Metric Stats */}
      <StatGrid cols={4} className="hidden md:grid">
        <StatCard label="Total Brand" value={brands.length} note="Biro terdaftar" />
        <StatCard label="Total Staf Tim" value={totalUsers} note="Tim sales & CS" />
        <StatCard label="Total Paket Umroh" value={totalPackages} note="Katalog program" />
        <StatCard label="WhatsApp Terhubung" value={`${connectedCount}/${brands.length}`} note="Status gateway aktif" />
      </StatGrid>

      {/* Search & Filters Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search Input */}
        <div className="flex items-center gap-2 sm:contents">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
            <input
              className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-xs text-zinc-900 outline-none focus:border-black focus:ring-1 focus:ring-black transition placeholder:text-zinc-500 shadow-xs"
              placeholder="Cari brand"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          {canManage && (
            <Button variant="primary" size="icon" to="/brands/new" className="md:hidden" aria-label="Tambah brand">
              <Plus size={18} />
            </Button>
          )}
        </div>

        {/* WhatsApp Status Pills */}
        <div className="segmented flex rounded-lg border border-zinc-200 bg-white p-0.5 shadow-xs sm:shrink-0 [&>button]:flex-1 sm:[&>button]:flex-none">
          {(['all', 'connected', 'disconnected'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setWaFilter(s);
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                waFilter === s ? 'bg-zinc-950 text-white font-semibold shadow-xs' : 'text-zinc-600 hover:text-zinc-950'
              }`}
            >
              {s === 'all' ? 'Semua' : s === 'connected' ? 'WA Terhubung' : 'WA Terputus'}
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

      {/* Brand Table Listing */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {brandsQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-zinc-500">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-xs">Memuat data brand travel…</span>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Tidak ada brand travel ditemukan"
            description={hasActiveFilters ? 'Ubah pencarian atau filter.' : 'Belum ada brand.'}
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
                <Button variant="primary" size="sm" to="/brands/new" icon={<Plus size={14} />}>
                  Tambah Brand
                </Button>
              ) : null}
          />
        ) : (
          <>
            <ul className="divide-y divide-zinc-100 md:hidden">
              {pagedBrands.map((brand) => {
                const waConnected = brand.whatsappSession?.status === 'connected';
                return (
                  <li key={brand.id} className="flex items-center gap-3 px-4 py-3">
                    {brand.logoUrl ? (
                      <img src={resolveMediaUrl(brand.logoUrl)} alt="" className="h-11 w-11 shrink-0 rounded-xl border border-zinc-200 object-cover" />
                    ) : (
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-zinc-950 text-xs font-extrabold text-white">{String(brand.code ?? 'BRD').slice(0, 3)}</span>
                    )}
                    <Link to={`/brands/${brand.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-950">{brand.name}</p>
                      <p className="truncate text-xs text-zinc-500">{brand.phone || '-'}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-zinc-600">
                        <span className={`h-1.5 w-1.5 rounded-full ${waConnected ? 'bg-emerald-500' : 'bg-zinc-400'}`} aria-hidden="true" />
                        <span>{waConnected ? 'Terhubung' : 'Terputus'}</span>
                        <span className="text-zinc-500">· {brand._count?.users ?? 0} staf · {brand._count?.packages ?? 0} paket</span>
                      </p>
                    </Link>
                    <RowActions label={`Aksi brand ${brand.name}`} actions={[
                      { label: 'Lihat detail', icon: Eye, to: `/brands/${brand.id}` },
                      { label: 'Kelola perangkat WhatsApp', icon: Smartphone, to: `/brands/${brand.id}?tab=perangkat` },
                      { label: 'Edit brand', icon: Pencil, to: `/brands/${brand.id}/edit`, hidden: !canManage },
                      { label: 'Hapus brand', icon: Trash2, onSelect: () => setDeleteTarget(brand), danger: true, hidden: !canManage },
                    ]} />
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              {/* Di bawah lg (split-screen ±700 px) kolom legalitas & rekening disembunyikan; lengkap di Detail Brand. */}
              <table className="w-full text-left text-xs lg:min-w-[820px]">
                <thead className="border-b border-zinc-200 bg-zinc-50/75 text-xs font-semibold text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Brand Travel</th>
                    <th className="hidden px-4 py-3 lg:table-cell">Legalitas & Kontak</th>
                    <th className="hidden px-4 py-3 lg:table-cell">Rekening Resmi</th>
                    <th className="px-4 py-3">Statistik Data</th>
                    <th className="px-4 py-3 text-center">Status WA</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {pagedBrands.map((brand) => {
                    const waConnected = brand.whatsappSession?.status === 'connected';

                    return (
                      <tr key={brand.id} className="group hover:bg-zinc-50/60 transition-colors">
                        {/* Brand Info */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            {brand.logoUrl ? (
                              <img
                                src={resolveMediaUrl(brand.logoUrl)}
                                alt={brand.name}
                                className="h-10 w-10 shrink-0 rounded-xl object-cover shadow-2xs border border-zinc-200"
                              />
                            ) : (
                              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-zinc-950 font-display text-xs font-extrabold text-white shadow-2xs">
                                {String(brand.code ?? 'BRD').slice(0, 3)}
                              </span>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <Link
                                  to={`/brands/${brand.id}`}
                                  className="font-bold text-xs text-zinc-950 hover:underline tracking-tight truncate max-w-xs"
                                >
                                  {brand.name}
                                </Link>
                                <span className="rounded-md border border-zinc-200 bg-zinc-100 px-1.5 py-0.2 font-mono text-xs font-semibold text-zinc-700">
                                  {brand.code}
                                </span>
                              </div>
                              <p className="text-xs text-zinc-500 truncate mt-0.5">
                                {brand.phone || 'Hotline belum diatur'}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Legal & Contact */}
                        <td className="hidden px-4 py-3.5 whitespace-nowrap lg:table-cell">
                          <b className="block font-mono text-zinc-900">{brand.ppiuNumber || 'PPIU -'}</b>
                          <span className="text-xs text-zinc-500 truncate max-w-[200px] block">
                            {brand.address || 'Alamat belum diatur'}
                          </span>
                        </td>

                        {/* Bank Account */}
                        <td className="hidden px-4 py-3.5 whitespace-nowrap lg:table-cell">
                          {brand.bankName ? (
                            <>
                              <b className="block font-mono text-zinc-900">
                                {brand.bankName} {brand.bankAccountNumber}
                              </b>
                              <span className="text-xs text-zinc-500">a/n {brand.bankAccountHolder || '-'}</span>
                            </>
                          ) : (
                            <span className="text-zinc-500 italic">Belum ada</span>
                          )}
                        </td>

                        {/* Stats Counts */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-3 text-xs text-zinc-600">
                            <span title="Total staf tim" className="flex items-center gap-1 font-medium">
                              <Users size={12} className="text-zinc-500" />
                              {brand._count?.users ?? 0}
                            </span>
                            <span title="Total paket umroh" className="flex items-center gap-1 font-medium">
                              <PackageOpen size={12} className="text-zinc-500" />
                              {brand._count?.packages ?? 0}
                            </span>
                          </div>
                        </td>

                        {/* WA Status */}
                        <td className="px-4 py-3.5 text-center whitespace-nowrap">
                          <StatusBadge
                            status={waConnected ? 'active' : 'neutral'}
                            label={waConnected ? 'Terhubung' : 'Terputus'}
                            dot
                          />
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <RowActions label={`Aksi brand ${brand.name}`} actions={[
                            { label: 'Lihat detail', icon: Eye, to: `/brands/${brand.id}` },
                            { label: 'Kelola perangkat WhatsApp', icon: Smartphone, to: `/brands/${brand.id}?tab=perangkat` },
                            { label: 'Edit brand', icon: Pencil, to: `/brands/${brand.id}/edit`, hidden: !canManage },
                            { label: 'Hapus brand', icon: Trash2, onSelect: () => setDeleteTarget(brand), danger: true, hidden: !canManage },
                          ]} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination & Count Footer */}
            <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50/50 px-4 py-3 text-xs text-zinc-600 ${totalPages <= 1 ? "max-sm:hidden" : ""}`}>
              <span className="hidden text-xs text-zinc-500 sm:inline">
                Menampilkan <strong className="font-semibold text-zinc-900">{totalItems === 0 ? 0 : startIndex + 1}</strong>
                –<strong className="font-semibold text-zinc-900">{Math.min(startIndex + pageSize, totalItems)}</strong> dari{' '}
                <strong className="font-semibold text-zinc-900">{totalItems}</strong> brand
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

                  <div className="hidden sm:flex items-center gap-1">
                    {pageNumbers.map((p, idx) =>
                      p === '...' ? (
                        <span key={`dots-${idx}`} className="px-2 text-zinc-500">
                          …
                        </span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPage(Number(p))}
                          className={`h-8 w-8 rounded-lg text-xs font-semibold transition cursor-pointer ${
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
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        pending={deleteMutation.isPending}
        error={deleteMutation.isError ? (deleteMutation.error as Error)?.message || 'Gagal menghapus brand.' : null}
        // API menolak menghapus brand yang masih punya prospek atau paket: jangan janjikan "hapus semua data".
        confirmDisabled={((deleteTarget?._count?.prospects ?? 0) + (deleteTarget?._count?.packages ?? 0)) > 0}
        title="Hapus Brand Travel?"
        description={<>Brand <strong>{deleteTarget?.name}</strong> ({deleteTarget?.code}) akan dihapus beserta sesi WhatsApp-nya. Tindakan ini tidak dapat dibatalkan.</>}
        confirmLabel="Hapus Brand"
      >
        {((deleteTarget?._count?.prospects ?? 0) + (deleteTarget?._count?.packages ?? 0)) > 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
            Brand ini masih punya <strong>{deleteTarget?._count?.prospects ?? 0}</strong> prospek dan <strong>{deleteTarget?._count?.packages ?? 0}</strong> paket,
            sehingga tidak dapat dihapus. Arsipkan paketnya atau hubungi tim holding.
          </p>
        ) : undefined}
      </ConfirmDialog>

    </div>
  );
}

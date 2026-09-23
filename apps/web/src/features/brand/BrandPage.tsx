import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
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
import { api } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { StatGrid, StatCard } from '../../components/ui/stat-card';
import { StatusBadge } from '../../components/ui/status-badge';

interface BrandItem {
  id: number;
  name: string;
  code: string;
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
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3600);
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
      <StatGrid cols={4}>
        <StatCard label="Total Brand" value={brands.length} note="Biro terdaftar" />
        <StatCard label="Total Staff Tim" value={totalUsers} note="Staff operasional" />
        <StatCard label="Total Paket Umroh" value={totalPackages} note="Katalog program" />
        <StatCard label="WhatsApp Terhubung" value={`${connectedCount}/${brands.length}`} note="Status gateway aktif" />
      </StatGrid>

      {/* Search & Filters Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-xs text-zinc-900 outline-none focus:border-black focus:ring-1 focus:ring-black transition placeholder:text-zinc-400 shadow-xs"
            placeholder="Cari nama atau kode brand…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        {/* WhatsApp Status Pills */}
        <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 shadow-xs shrink-0">
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
          <div className="flex items-center justify-center gap-2 py-20 text-zinc-400">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-xs">Memuat data brand travel…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
            <Building2 size={36} className="mb-3 opacity-25" />
            <p className="text-sm font-bold text-zinc-700">Tidak ada brand travel ditemukan</p>
            <p className="mt-1 text-xs text-zinc-400">
              {hasActiveFilters
                ? 'Coba sesuaikan kata kunci pencarian atau filter yang aktif.'
                : 'Belum ada data biro travel yang didaftarkan ke sistem.'}
            </p>
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={resetFilters}
                className="mt-4"
              >
                Reset Filter
              </Button>
            ) : canManage ? (
              <Button variant="primary" size="sm" to="/brands/new" icon={<Plus size={14} />} className="mt-4">
                Tambah Brand
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="border-b border-zinc-200 bg-zinc-50/75 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Brand Travel</th>
                    <th className="px-4 py-3">Legalitas & Kontak</th>
                    <th className="px-4 py-3">Rekening Resmi</th>
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
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-zinc-950 font-display text-xs font-extrabold text-white shadow-2xs">
                              {String(brand.code ?? 'BRD').slice(0, 3)}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Link
                                  to={`/brands/${brand.id}`}
                                  className="font-bold text-xs text-zinc-950 hover:underline tracking-tight truncate max-w-xs"
                                >
                                  {brand.name}
                                </Link>
                                <span className="rounded-md border border-zinc-200 bg-zinc-100 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-zinc-700">
                                  {brand.code}
                                </span>
                              </div>
                              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                                {brand.phone || 'Hotline belum diatur'}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Legal & Contact */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <b className="block font-mono text-zinc-900">{brand.ppiuNumber || 'PPIU -'}</b>
                          <span className="text-[11px] text-zinc-400 truncate max-w-[200px] block">
                            {brand.address || 'Alamat belum diatur'}
                          </span>
                        </td>

                        {/* Bank Account */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {brand.bankName ? (
                            <>
                              <b className="block font-mono text-zinc-900">
                                {brand.bankName} {brand.bankAccountNumber}
                              </b>
                              <span className="text-[11px] text-zinc-400">a/n {brand.bankAccountHolder || '-'}</span>
                            </>
                          ) : (
                            <span className="text-zinc-400 italic">Belum ada</span>
                          )}
                        </td>

                        {/* Stats Counts */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-3 text-[11px] text-zinc-600">
                            <span title="Total staff tim" className="flex items-center gap-1 font-medium">
                              <Users size={12} className="text-zinc-400" />
                              {brand._count?.users ?? 0}
                            </span>
                            <span title="Total paket umroh" className="flex items-center gap-1 font-medium">
                              <PackageOpen size={12} className="text-zinc-400" />
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
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              to={`/brands/${brand.id}`}
                              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition"
                              title="Lihat detail brand"
                            >
                              <Eye size={14} />
                            </Link>

                            <Link
                              to={`/devices/${brand.id}`}
                              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition"
                              title="Kelola perangkat WhatsApp"
                            >
                              <Smartphone size={14} />
                            </Link>

                            {canManage && (
                              <>
                                <Link
                                  to={`/brands/${brand.id}/edit`}
                                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition"
                                  title="Edit brand"
                                >
                                  <Pencil size={14} />
                                </Link>
                                <button
                                  type="button"
                                  onClick={() => setDeleteTarget(brand)}
                                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                                  title="Hapus brand"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
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
                        <span key={`dots-${idx}`} className="px-2 text-zinc-400">
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

      {/* Delete Confirmation Dialog */}
      <Dialog.Root open={Boolean(deleteTarget)} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl outline-none border border-zinc-200">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <AlertTriangle size={22} />
              <Dialog.Title className="text-base font-bold text-zinc-950 font-display">
                Hapus Brand Travel?
              </Dialog.Title>
            </div>

            <Dialog.Description className="text-xs text-zinc-600 leading-relaxed">
              Menghapus biro <strong>{deleteTarget?.name}</strong> ({deleteTarget?.code}) akan menghapus seluruh data turunan berikut:
            </Dialog.Description>

            <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50/60 p-3.5 text-xs text-rose-900 space-y-1">
              <p>• <strong>{deleteTarget?._count?.prospects ?? 0}</strong> data calon jamaah</p>
              <p>• <strong>{deleteTarget?._count?.packages ?? 0}</strong> paket umroh biro</p>
              <p>• Riwayat chat dan sesi WhatsApp gateway</p>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setDeleteTarget(null)}
              >
                Batal
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                loading={deleteMutation.isPending}
              >
                Hapus Brand
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-2xl bg-zinc-950 px-4 py-3 text-xs font-semibold text-white shadow-lift border border-zinc-800 animate-in fade-in-0 slide-in-from-bottom-2">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

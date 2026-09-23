import { useState, useEffect, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Building2, CalendarDays, CheckCircle2, CircleDollarSign,
  CreditCard, Edit2, ExternalLink, Eye, MapPin, PackageOpen, Pencil, Phone, Plus,
  Settings2, ToggleLeft, ToggleRight, Trash2, Users, X
} from 'lucide-react';
import { api } from '../../lib/api';
import { useBrandScope } from '../../lib/scope';
import { useAuth } from '../../app/auth';
import { useUiStore } from '../../app/store';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PageError, PageLoading, SectionEmpty } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { MetaSettingsPanel } from './MetaSettingsPanel';
import { WhatsAppDevicePanel } from './WhatsAppDevicePanel';
import { PackageDetailModal } from '../packages/PackageDetailModal';
import { PackageFormModal } from '../packages/PackageFormModal';

export function AdminPage() {
  const { user } = useAuth();
  const { brandId, query } = useBrandScope();
  const { setActiveBrandId } = useUiStore();
  const [tab, setTab] = useState<'brands' | 'packages' | 'users' | 'whatsapp' | 'meta'>(user?.role === 'superadmin' ? 'brands' : 'packages');
  const [dialog, setDialog] = useState<'brand' | 'package' | 'user' | null>(null);
  const [editingBrand, setEditingBrand] = useState<any | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [packageDetailItem, setPackageDetailItem] = useState<any | null>(null);
  const [packageEditingItem, setPackageEditingItem] = useState<any | null>(null);
  const [packageFormOpen, setPackageFormOpen] = useState(false);
  const [packageDeleteConfirm, setPackageDeleteConfirm] = useState<any | null>(null);

  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get<any[]>('/catalog/brands') });
  const packages = useQuery({ queryKey: ['packages', brandId], queryFn: () => api.get<any[]>(`/catalog/packages${query}`), enabled: !!brandId });
  const users = useQuery({ queryKey: ['users', brandId], queryFn: () => api.get<any[]>(`/catalog/users${query}`), enabled: !!brandId });
  const toggle = useMutation({
    mutationFn: (id: number) => api.patch(`/catalog/users/${id}/toggle`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] })
  });
  const assignBrands = useMutation({
    mutationFn: ({ userId, brandIds }: { userId: number; brandIds: number[] }) =>
      api.put(`/catalog/users/${userId}/brands`, { brandIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      showToast('Brand CS berhasil diperbarui.');
    },
    onError: (err: any) => showToast(err?.message || 'Gagal memperbarui brand CS'),
  });
  const togglePackage = useMutation({
    mutationFn: (id: number) => api.patch(`/catalog/packages/${id}/toggle`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['packages'] });
      showToast('Status publikasi paket berhasil diubah.');
    },
  });
  const deletePackage = useMutation({
    mutationFn: (id: number) => api.delete(`/catalog/packages/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['packages'] });
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      setPackageDeleteConfirm(null);
      showToast('Paket umroh berhasil dihapus.');
    },
  });

  const activeBrand = brands.data?.find((b) => b.id === brandId) ?? brands.data?.[0];
  const activeQuery = tab === 'brands' || tab === 'meta' || tab === 'whatsapp' ? brands : tab === 'packages' ? packages : users;

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  }

  function handleOpenCreateBrand() {
    setEditingBrand(null);
    setDialog('brand');
  }

  function handleOpenEditBrand(brand: any) {
    setEditingBrand(brand);
    setDialog('brand');
  }

  if (activeQuery.isLoading) return <PageLoading label="Memuat administrasi" />;
  if (activeQuery.isError) return <PageError description={activeQuery.error.message} onRetry={() => void activeQuery.refetch()} />;
  if (tab !== 'brands' && !brandId) return <PageError title="Belum ada brand aktif" description="Buat brand terlebih dahulu pada tab Brand sebelum mengelola paket dan anggota tim." />;

  return (
    <div className="app-page">
      {toastMessage && (
        <div role="status" className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-2xl border border-emerald-600/30 bg-zinc-950 px-4 py-3 text-sm font-semibold text-white shadow-lift animate-fade-up">
          <CheckCircle2 size={18} className="text-emerald-500" />
          <span>{toastMessage}</span>
        </div>
      )}

      <PageHeader
        kicker="Administration center"
        kickerIcon={<Settings2 size={14} />}
        title="Kelola Operasional"
        subtitle={
          user?.role === 'superadmin'
            ? 'Kontrol seluruh brand, legalitas, paket, dan akun dari satu tempat.'
            : 'Pengaturan tim, paket, dan integrasi untuk brand Anda.'
        }
        actions={
          tab !== 'meta' && tab !== 'whatsapp' ? (
            <Button
              variant="primary"
              onClick={() => {
                if (tab === 'brands') handleOpenCreateBrand();
                else if (tab === 'packages') {
                  setPackageEditingItem(null);
                  setPackageFormOpen(true);
                } else {
                  setDialog('user');
                }
              }}
              icon={<Plus size={16} />}
            >
              {tab === 'brands' ? 'Brand baru' : tab === 'packages' ? 'Paket baru' : 'User baru'}
            </Button>
          ) : undefined
        }
      />

      <section className="grid gap-3 sm:grid-cols-3">
        {[[Building2, brands.data?.length ?? 0, user?.role === 'superadmin' ? 'Brand dikelola' : activeBrand?.name ?? 'Brand'], [PackageOpen, packages.data?.length ?? 0, 'Paket aktif'], [Users, users.data?.filter((u) => u.isActive).length ?? 0, 'Anggota aktif']].map(([Icon, value, label]) => {
          const I = Icon as typeof Building2;
          return (
            <article key={String(label)} className="surface flex items-center gap-4 p-5">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-zinc-100"><I size={20} /></span>
              <div>
                <p className="font-display text-2xl font-extrabold">{String(value)}</p>
                <p className="text-xs text-zinc-400">{String(label)}</p>
              </div>
            </article>
          );
        })}
      </section>

      <div className="thin-scrollbar flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="Data administrasi">
        {(user?.role === 'superadmin' ? [['brands', 'Brand'], ['whatsapp', 'Perangkat WhatsApp'], ['packages', 'Paket'], ['users', 'Tim & akun'], ['meta', 'Meta Pixel & CAPI']] : [['whatsapp', 'Perangkat WhatsApp'], ['packages', 'Paket'], ['users', 'Tim CS'], ['meta', 'Meta Pixel & CAPI']]).map(([value, label]) => (
          <button role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value as typeof tab)} className={`whitespace-nowrap border-b-2 px-4 py-3 text-xs font-bold transition-colors ${tab === value ? 'border-zinc-950 text-zinc-950' : 'border-transparent text-zinc-400 hover:text-zinc-700'}`}>{label}</button>
        ))}
      </div>

      {tab === 'brands' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {brands.data?.map((brand) => {
            const isCurrentWorkspace = brand.id === brandId;
            return (
              <article key={brand.id} className={`surface overflow-hidden transition-all ${isCurrentWorkspace ? 'ring-2 ring-zinc-950 shadow-md' : ''}`}>
                <div className="flex items-start gap-4 p-5">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-zinc-950 font-display text-xs font-extrabold text-white shadow-sm">
                    {String(brand.code ?? 'BRD').slice(0, 3)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-display font-bold text-zinc-950">{brand.name}</h3>
                        <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-zinc-600">
                          {brand.code}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isCurrentWorkspace ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                            Aktif di Workspace
                          </span>
                        ) : (
                          user?.role === 'superadmin' && (
                            <button
                              onClick={() => {
                                setActiveBrandId(brand.id);
                                showToast(`Workspace beralih ke brand "${brand.name}".`);
                              }}
                              className="rounded-lg border border-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition"
                            >
                              Pilih Workspace
                            </button>
                          )
                        )}
                        {user?.role === 'superadmin' && (
                          <button
                            onClick={() => handleOpenEditBrand(brand)}
                            title="Edit data brand"
                            className="rounded-lg border border-zinc-200 p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition"
                          >
                            <Edit2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                      <span className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${brand.whatsappSession?.status === 'connected' ? 'bg-emerald-600' : 'bg-zinc-300'}`} />
                        <span className="text-zinc-600">{brand.whatsappSession?.status === 'connected' ? 'WA Terhubung' : 'WA Belum Terhubung'}</span>
                      </span>
                      {brand.phone && (
                        <span className="flex items-center gap-1 text-zinc-600">
                          <Phone size={12} className="text-zinc-400" />
                          {brand.phone}
                        </span>
                      )}
                      <span className="text-zinc-500">
                        PPIU: <strong className="font-semibold text-zinc-700">{brand.ppiuNumber || '—'}</strong>
                      </span>
                    </div>

                    <div className="mt-2.5 rounded-xl border border-zinc-100 bg-zinc-50/80 p-2.5 text-xs text-zinc-600">
                      <div className="flex items-start gap-1.5">
                        <CreditCard size={13} className="mt-0.5 shrink-0 text-zinc-400" />
                        <div>
                          {brand.bankName ? (
                            <span>
                              <strong className="text-zinc-800">{brand.bankName}</strong> — <span className="font-mono font-semibold text-zinc-800">{brand.bankAccountNumber}</span> (a.n. {brand.bankAccountHolder})
                            </span>
                          ) : (
                            <span className="italic text-zinc-400">Rekening bank belum diatur (diperlukan untuk skrip DP jamaah)</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {brand.address && (
                      <p className="mt-2 flex items-start gap-1 text-xs text-zinc-400">
                        <MapPin size={12} className="mt-0.5 shrink-0" />
                        <span className="line-clamp-1">{brand.address}</span>
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 divide-x border-t bg-zinc-50 py-3 text-center">
                  <div><b className="block text-sm text-zinc-900">{brand._count?.users ?? 0}</b><span className="text-[9px] uppercase tracking-wider text-zinc-400">User Tim</span></div>
                  <div><b className="block text-sm text-zinc-900">{brand._count?.packages ?? 0}</b><span className="text-[9px] uppercase tracking-wider text-zinc-400">Paket Umroh</span></div>
                  <div><b className="block text-sm text-zinc-900">{brand._count?.prospects ?? 0}</b><span className="text-[9px] uppercase tracking-wider text-zinc-400">Total Prospek</span></div>
                </div>
              </article>
            );
          })}
          {!brands.data?.length && (
            <div className="lg:col-span-2">
              <SectionEmpty title="Belum ada brand" description="Tambahkan brand travel pertama untuk mulai mengelola operasional." />
            </div>
          )}
        </div>
      )}

      {tab === 'packages' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4">
            <div>
              <b className="block text-sm text-zinc-900">Katalog & Manajemen Paket Umroh</b>
              <p className="text-xs text-zinc-500">Kelola skema harga kamar, fasilitas, dan materi penawaran untuk CS.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/packages">
                <Button variant="secondary" className="text-xs">
                  Buka Katalog Penuh & Filter <ExternalLink size={13} />
                </Button>
              </Link>
              <Button
                onClick={() => {
                  setPackageEditingItem(null);
                  setPackageFormOpen(true);
                }}
                className="text-xs"
              >
                <Plus size={14} /> Tambah Paket
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {packages.data?.map((item) => (
              <article key={item.id} className="surface overflow-hidden flex flex-col justify-between">
                <div>
                  <div className="h-2 bg-zinc-950" />
                  <div className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[9px] font-bold uppercase text-zinc-500">
                          {item.isPromo ? 'Promo' : 'Reguler'}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                            item.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-400'
                          }`}
                        >
                          {item.isActive ? 'Aktif' : 'Arsip'}
                        </span>
                      </div>
                      <span
                        className={`text-xs font-bold ${
                          item.quotaRemaining && item.quotaRemaining <= 5 ? 'text-rose-600 font-extrabold' : 'text-zinc-900'
                        }`}
                      >
                        {item.quotaRemaining ?? 0} seat
                      </span>
                    </div>

                    <h3
                      onClick={() => setPackageDetailItem(item)}
                      className="mt-3 font-display text-base font-bold leading-snug text-zinc-950 hover:underline cursor-pointer tracking-tight"
                    >
                      {item.name}
                    </h3>

                    <div className="mt-3 space-y-2 text-xs text-zinc-500">
                      <p className="flex items-center gap-2">
                        <CalendarDays size={14} className="text-zinc-400" />
                        {item.departureDate ? new Date(item.departureDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Jadwal menyusul'}
                      </p>
                      <p className="flex items-center gap-2">
                        <CircleDollarSign size={14} className="text-zinc-400" />
                        {item.priceQuad || item.price} · DP {item.dp}
                      </p>
                    </div>

                    <div className="mt-4 border-t pt-3 text-xs text-zinc-400 flex items-center justify-between">
                      <span>{item.airline || 'Maskapai TBA'} · {item.duration || '9 Hari'}</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-zinc-100 bg-zinc-50/70 p-3 flex items-center justify-between gap-1.5">
                  <Button variant="secondary" onClick={() => setPackageDetailItem(item)} className="flex-1 text-xs h-8">
                    <Eye size={13} /> Detail & Salin WA
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPackageEditingItem(item);
                      setPackageFormOpen(true);
                    }}
                    className="h-8 px-2.5 text-xs"
                    title="Sunting Paket"
                  >
                    <Pencil size={13} />
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => togglePackage.mutate(item.id)}
                    className="h-8 px-2.5 text-xs"
                    title={item.isActive ? 'Arsipkan' : 'Aktifkan'}
                  >
                    {item.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setPackageDeleteConfirm(item)}
                    className="h-8 px-2.5 text-xs text-rose-600 hover:bg-rose-50"
                    title="Hapus Paket"
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left">
              <thead className="border-b bg-zinc-50 text-[10px] uppercase tracking-[.1em] text-zinc-400">
                <tr><th className="px-5 py-3">Pengguna</th><th className="px-4">Role</th><th className="px-4">Brand Terkait</th><th className="px-4">Status</th><th className="px-5 text-right">Aksi</th></tr>
              </thead>
              <tbody className="divide-y">
                {users.data?.map((item: any) => {
                  const allBrands: { id: number; name: string }[] = [
                    ...(item.brand ? [item.brand] : []),
                    ...(item.userBrands?.map((ub: any) => ub.brand).filter((b: any) => b.id !== item.brand?.id) ?? []),
                  ];
                  return (
                    <tr key={item.id} className="text-sm">
                      <td className="px-5 py-4"><b>{item.name}</b><p className="mt-1 text-xs text-zinc-400">{item.email}</p></td>
                      <td className="px-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          item.role === 'superadmin' ? 'bg-purple-50 text-purple-700' :
                          item.role === 'admin' ? 'bg-amber-50 text-amber-700' :
                          'bg-emerald-50 text-emerald-700'
                        }`}>
                          {item.role === 'cs' ? 'Customer Service' : item.role === 'admin' ? 'Admin Brand' : 'Superadmin'}
                        </span>
                      </td>
                      <td className="px-4 text-xs">
                        {item.role === 'cs' ? (
                          <div className="flex flex-wrap gap-1">
                            {allBrands.length > 0 ? allBrands.map((b) => (
                              <span key={b.id} className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600">{b.name}</span>
                            )) : (
                              <span className="text-zinc-400 italic">Belum dikaitkan brand</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-500">{item.brand?.name ?? 'Lintas brand'}</span>
                        )}
                      </td>
                      <td className="px-4">
                        <span className={`inline-flex items-center gap-1.5 text-xs ${item.isActive ? 'text-zinc-800' : 'text-zinc-400'}`}>
                          <span className={`h-2 w-2 rounded-full ${item.isActive ? 'bg-emerald-600' : 'bg-zinc-300'}`} />
                          {item.isActive ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="px-5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {item.role === 'cs' && user?.role === 'superadmin' && (
                            <BrandAssignButton
                              user={item}
                              brands={brands.data ?? []}
                              currentBrandIds={allBrands.map((b) => b.id)}
                              onAssign={(brandIds) => assignBrands.mutate({ userId: item.id, brandIds })}
                            />
                          )}
                          <button disabled={item.id === user?.id} onClick={() => toggle.mutate(item.id)} className="text-zinc-500 disabled:opacity-20">
                            {item.isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'whatsapp' && brandId && <WhatsAppDevicePanel brandId={brandId} brandName={activeBrand?.name ?? 'Brand terpilih'} canManage={user?.role === 'superadmin'} />}
      {tab === 'meta' && brandId && <MetaSettingsPanel brandId={brandId} />}

      <AdminDialog
        kind={dialog}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setEditingBrand(null);
          }
        }}
        brandId={brandId}
        superadmin={user?.role === 'superadmin'}
        brands={brands.data ?? []}
        editingBrand={editingBrand}
        onSuccess={showToast}
      />

      <PackageDetailModal
        pkg={packageDetailItem}
        open={Boolean(packageDetailItem)}
        onOpenChange={(open) => !open && setPackageDetailItem(null)}
        canManage={true}
        onEdit={(pkg) => {
          setPackageDetailItem(null);
          setPackageEditingItem(pkg);
          setPackageFormOpen(true);
        }}
      />

      <PackageFormModal
        pkg={packageEditingItem}
        open={packageFormOpen}
        onOpenChange={(open) => {
          setPackageFormOpen(open);
          if (!open) setPackageEditingItem(null);
        }}
        brandId={brandId}
        brands={brands.data ?? []}
        isSuperadmin={user?.role === 'superadmin'}
      />

      {packageDeleteConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-zinc-200">
            <h3 className="font-display text-lg font-bold text-zinc-900">Hapus Paket Umroh?</h3>
            <p className="mt-2 text-xs text-zinc-600 leading-relaxed">
              Apakah Anda yakin ingin menghapus paket <strong>{packageDeleteConfirm.name}</strong>? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setPackageDeleteConfirm(null)}>
                Batal
              </Button>
              <Button
                onClick={() => deletePackage.mutate(packageDeleteConfirm.id)}
                disabled={deletePackage.isPending}
                className="bg-rose-600 hover:bg-rose-700 text-white"
              >
                {deletePackage.isPending ? 'Menghapus...' : 'Ya, Hapus Paket'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminDialog({
  kind,
  onOpenChange,
  brandId,
  superadmin,
  brands,
  editingBrand,
  onSuccess,
}: {
  kind: 'brand' | 'package' | 'user' | null;
  onOpenChange(open: boolean): void;
  brandId: number | null | undefined;
  superadmin: boolean;
  brands: any[];
  editingBrand?: any | null;
  onSuccess?(message: string): void;
}) {
  const { setActiveBrandId } = useUiStore();
  const [form, setForm] = useState<Record<string, any>>({});

  useEffect(() => {
    if (kind === 'brand') {
      if (editingBrand) {
        setForm({
          name: editingBrand.name ?? '',
          code: editingBrand.code ?? '',
          ppiuNumber: editingBrand.ppiuNumber ?? '',
          phone: editingBrand.phone ?? '',
          bankName: editingBrand.bankName ?? '',
          bankAccountNumber: editingBrand.bankAccountNumber ?? '',
          bankAccountHolder: editingBrand.bankAccountHolder ?? '',
          address: editingBrand.address ?? '',
          gmapsUrl: editingBrand.gmapsUrl ?? '',
        });
      } else {
        setForm({
          name: '',
          code: '',
          ppiuNumber: '',
          phone: '',
          bankName: '',
          bankAccountNumber: '',
          bankAccountHolder: '',
          address: '',
          gmapsUrl: '',
        });
      }
    } else if (kind === 'package') {
      setForm({ brandId: brandId ? String(brandId) : '' });
    } else if (kind === 'user') {
      setForm({ role: 'cs', brandId: brandId ? String(brandId) : '' });
    }
  }, [kind, editingBrand, brandId]);

  const save = useMutation({
    mutationFn: async () => {
      if (kind === 'brand') {
        const payload = {
          name: form.name?.trim(),
          code: form.code?.trim().toUpperCase(),
          ppiuNumber: form.ppiuNumber?.trim() || null,
          phone: form.phone?.trim() || null,
          bankName: form.bankName?.trim() || null,
          bankAccountNumber: form.bankAccountNumber?.trim() || null,
          bankAccountHolder: form.bankAccountHolder?.trim() || null,
          address: form.address?.trim() || null,
          gmapsUrl: form.gmapsUrl?.trim() || null,
        };
        if (editingBrand) {
          return api.patch(`/catalog/brands/${editingBrand.id}`, payload);
        }
        return api.post('/catalog/brands', payload);
      }
      if (kind === 'package') {
        return api.post('/catalog/packages', {
          name: form.name,
          price: form.price,
          dp: form.dp,
          departureDate: form.departureDate || undefined,
          quotaRemaining: Number(form.quotaRemaining || 0),
          ...(superadmin ? { brandId: Number(form.brandId || brandId) } : {}),
        });
      }
      return api.post('/catalog/users', {
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        ...(superadmin ? { brandId: Number(form.brandId || brandId) } : {}),
      });
    },
    onSuccess: (res: any) => {
      void queryClient.invalidateQueries({ queryKey: kind === 'brand' ? ['brands'] : kind === 'package' ? ['packages'] : ['users'] });
      if (kind === 'brand') {
        const brandData = res?.id ? res : res?.data;
        if (!editingBrand && brandData?.id) {
          setActiveBrandId(brandData.id);
          onSuccess?.(`Brand "${brandData.name || form.name}" berhasil dibuat dan diaktifkan di workspace.`);
        } else {
          onSuccess?.(`Brand "${form.name}" berhasil diperbarui.`);
        }
      } else {
        onSuccess?.(kind === 'package' ? 'Paket umroh berhasil ditambahkan.' : 'Pengguna tim baru berhasil didaftarkan.');
      }
      onOpenChange(false);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const title = kind === 'brand' ? (editingBrand ? 'Ubah Informasi Brand' : 'Brand Travel Baru') : kind === 'package' ? 'Paket Umroh Baru' : 'Akun Tim Baru';
  const description = kind === 'brand'
    ? (editingBrand ? 'Perbarui legalitas, kontak, dan rekening resmi brand travel ini.' : 'Lengkapi identitas, kontak, dan rekening resmi untuk menambahkan brand travel baru.')
    : 'Lengkapi data di bawah untuk menambahkan master baru.';

  return (
    <Dialog.Root open={!!kind} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-white p-6 shadow-lift">
          <div className="flex items-start justify-between">
            <div>
              <Dialog.Title className="font-display text-xl font-extrabold">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-zinc-500">{description}</Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-2 hover:bg-zinc-100 text-zinc-400 hover:text-zinc-900 transition">
              <X size={18} />
            </Dialog.Close>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {superadmin && kind !== 'brand' && (
              <Field label="Brand" id="select-brand">
                <Select
                  value={form.brandId}
                  onValueChange={(brandId) => setForm({ ...form, brandId })}
                  options={brands.map((b) => ({ value: String(b.id), label: b.name }))}
                  className="w-full"
                  placeholder="Pilih brand"
                />
              </Field>
            )}

            {kind === 'brand' && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nama Brand" id="brand-name" required>
                    <input
                      id="brand-name"
                      className="field"
                      value={form.name ?? ''}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="contoh: Azhan Tour & Travel"
                      required
                    />
                  </Field>
                  <Field
                    label="Kode Brand"
                    id="brand-code"
                    hint="A-Z, 0-9, strip (-), garis bawah (_)"
                    required
                  >
                    <input
                      id="brand-code"
                      className="field uppercase font-mono"
                      value={form.code ?? ''}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                      placeholder="AZHAN"
                      pattern="^[A-Za-z0-9_-]+$"
                      title="Hanya huruf kapital, angka, tanda strip (-), dan garis bawah (_)"
                      required
                    />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nomor Izin PPIU" id="brand-ppiu" hint="Opsional">
                    <input
                      id="brand-ppiu"
                      className="field"
                      value={form.ppiuNumber ?? ''}
                      onChange={(e) => setForm({ ...form, ppiuNumber: e.target.value })}
                      placeholder="contoh: 123/PPIU/2024"
                    />
                  </Field>
                  <Field label="Hotline / No. Telepon" id="brand-phone" hint="Opsional">
                    <input
                      id="brand-phone"
                      className="field"
                      value={form.phone ?? ''}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="contoh: 08123456789"
                    />
                  </Field>
                </div>

                {/* Seksi Rekening Bank Resmi */}
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-700 uppercase tracking-wider">
                    <CreditCard size={14} className="text-zinc-500" />
                    <span>Rekening Bank Resmi Travel</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    Otomatis digunakan oleh Copilot & Smart Script saat CS mengirim penagihan DP / pelunasan ke calon jamaah.
                  </p>
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    <div className="space-y-1 sm:col-span-1">
                      <label htmlFor="brand-bank-name" className="label text-[10px]">Nama Bank</label>
                      <input
                        id="brand-bank-name"
                        className="field bg-white"
                        value={form.bankName ?? ''}
                        onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                        placeholder="BSI / Mandiri"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-1">
                      <label htmlFor="brand-bank-acc" className="label text-[10px]">No. Rekening</label>
                      <input
                        id="brand-bank-acc"
                        className="field bg-white font-mono"
                        value={form.bankAccountNumber ?? ''}
                        onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })}
                        placeholder="7123456789"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-1">
                      <label htmlFor="brand-bank-holder" className="label text-[10px]">Atas Nama</label>
                      <input
                        id="brand-bank-holder"
                        className="field bg-white"
                        value={form.bankAccountHolder ?? ''}
                        onChange={(e) => setForm({ ...form, bankAccountHolder: e.target.value })}
                        placeholder="PT Azhan Wisata"
                      />
                    </div>
                  </div>
                </div>

                <Field label="Alamat Kantor Pusat" id="brand-address" hint="Opsional">
                  <textarea
                    id="brand-address"
                    rows={2}
                    className="w-full rounded-xl border border-zinc-200 bg-white p-3 text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-900/10"
                    value={form.address ?? ''}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="Alamat kantor biro umroh..."
                  />
                </Field>

                <Field label="Link Google Maps (GMaps)" id="brand-gmaps" hint="Opsional">
                  <input
                    id="brand-gmaps"
                    className="field"
                    value={form.gmapsUrl ?? ''}
                    onChange={(e) => setForm({ ...form, gmapsUrl: e.target.value })}
                    placeholder="https://maps.app.goo.gl/..."
                  />
                </Field>
              </>
            )}

            {kind === 'package' && (
              <>
                <Field label="Nama Paket" id="pkg-name" required>
                  <input
                    id="pkg-name"
                    className="field"
                    value={form.name ?? ''}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Harga Mulai" id="pkg-price" required>
                    <input
                      id="pkg-price"
                      className="field"
                      value={form.price ?? ''}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                      placeholder="Rp 30.000.000"
                      required
                    />
                  </Field>
                  <Field label="DP" id="pkg-dp" required>
                    <input
                      id="pkg-dp"
                      className="field"
                      value={form.dp ?? ''}
                      onChange={(e) => setForm({ ...form, dp: e.target.value })}
                      placeholder="Rp 5.000.000"
                      required
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Keberangkatan" id="pkg-departure">
                    <input
                      id="pkg-departure"
                      type="date"
                      className="field"
                      value={form.departureDate ?? ''}
                      onChange={(e) => setForm({ ...form, departureDate: e.target.value })}
                    />
                  </Field>
                  <Field label="Kuota Seat" id="pkg-quota">
                    <input
                      id="pkg-quota"
                      type="number"
                      min="0"
                      className="field"
                      value={form.quotaRemaining ?? ''}
                      onChange={(e) => setForm({ ...form, quotaRemaining: e.target.value })}
                    />
                  </Field>
                </div>
              </>
            )}

                {kind === 'user' && (
                  <>
                    <Field label="Nama Lengkap" id="user-name" required>
                      <input
                        id="user-name"
                        className="field"
                        value={form.name ?? ''}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        required
                      />
                    </Field>
                    <Field label="Email" id="user-email" required>
                      <input
                        id="user-email"
                        type="email"
                        className="field"
                        value={form.email ?? ''}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        required
                      />
                    </Field>
                    <Field label="Kata Sandi Awal" id="user-password" hint="Minimal 8 karakter" required>
                      <input
                        id="user-password"
                        type="password"
                        minLength={8}
                        className="field"
                        value={form.password ?? ''}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        required
                      />
                    </Field>
                    {superadmin && (
                      <Field label="Role Pengguna" id="user-role">
                        <Select
                          value={form.role}
                          onValueChange={(role) => setForm({ ...form, role, brandIds: [] })}
                          options={[{ value: 'cs', label: 'Customer Service (CS)' }, { value: 'admin', label: 'Admin Brand' }]}
                          className="w-full"
                        />
                      </Field>
                    )}
                    {/* Multi-brand assignment for CS */}
                    {superadmin && form.role === 'cs' && brands.length > 1 && (
                      <Field label="Brand yang Diakses CS" id="user-brand-access">
                        <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3">
                          <p className="text-[11px] text-zinc-400">Pilih brand yang dapat diakses oleh CS ini (bisa lebih dari satu):</p>
                          {brands.map((b: any) => {
                            const selectedIds: number[] = form.brandIds ?? [];
                            const isChecked = selectedIds.includes(b.id);
                            return (
                              <label key={b.id} className="flex items-center gap-2.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...selectedIds, b.id]
                                      : selectedIds.filter((id) => id !== b.id);
                                    const primaryBrand = next[0] ?? null;
                                    setForm({ ...form, brandIds: next, brandId: primaryBrand ? String(primaryBrand) : '' });
                                  }}
                                  className="h-4 w-4 rounded border-zinc-300 accent-zinc-900"
                                />
                                <span className="text-sm font-medium text-zinc-800">{b.name}</span>
                                <span className="text-[10px] text-zinc-400">{b.code}</span>
                              </label>
                            );
                          })}
                        </div>
                      </Field>
                    )}
                  </>
                )}

            {save.error && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
                {save.error.message}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" disabled={save.isPending}>Batal</Button>
              </Dialog.Close>
              <Button disabled={save.isPending}>
                {save.isPending ? 'Menyimpan…' : editingBrand ? 'Simpan Perubahan' : 'Simpan Data'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  label,
  id,
  children,
  hint,
  required,
}: {
  label: string;
  id?: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="label mb-0 cursor-pointer">
          {label} {required && <span className="text-red-500 font-bold">*</span>}
        </label>
        {hint && <span className="text-[10px] font-medium text-zinc-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function BrandAssignButton({
  user: csUser,
  brands,
  currentBrandIds,
  onAssign,
}: {
  user: any;
  brands: any[];
  currentBrandIds: number[];
  onAssign(brandIds: number[]): void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>(currentBrandIds);

  // Sync when parent changes
  useEffect(() => {
    setSelected(currentBrandIds);
  }, [currentBrandIds.join(',')]);

  function toggle(id: number) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function save() {
    onAssign(selected);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Atur brand yang diakses CS ini"
        className="rounded-lg border border-zinc-200 px-2 py-1 text-[10px] font-semibold text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition flex items-center gap-1"
      >
        <Building2 size={12} />
        Brand
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
              Brand akses — {csUser.name}
            </p>
            <div className="space-y-1.5">
              {brands.map((b: any) => (
                <label key={b.id} className="flex items-center gap-2.5 cursor-pointer select-none rounded-lg px-2 py-1 hover:bg-zinc-50 transition">
                  <input
                    type="checkbox"
                    checked={selected.includes(b.id)}
                    onChange={() => toggle(b.id)}
                    className="h-3.5 w-3.5 rounded border-zinc-300 accent-zinc-900"
                  />
                  <span className="text-xs font-medium text-zinc-800">{b.name}</span>
                  <span className="ml-auto text-[9px] text-zinc-400 font-mono">{b.code}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-1.5 mt-3 pt-2 border-t border-zinc-100">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={save}
                className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-white bg-zinc-900 hover:bg-zinc-700 transition"
              >
                Simpan
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

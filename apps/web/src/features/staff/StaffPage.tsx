import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Edit2,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  User,
  UserCircle2,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { queryClient } from '../../app/query';
import { Select } from '../../components/ui/select';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { StatGrid, StatCard } from '../../components/ui/stat-card';
import { StatusBadge } from '../../components/ui/status-badge';
import { showFeedback } from '../../app/toast';
import { ConfirmDialog, Modal } from '../../components/ui/modal';
import { EmptyState } from '../../components/ui/page-feedback';

/* ─── Types ─────────────────────────────────────────────────── */
interface Brand {
  id: number;
  name: string;
  code: string;
}

type StaffRole = 'superadmin' | 'admin' | 'cs' | 'finance';
/** Role yang dapat dipilih superadmin di form; superadmin sendiri tidak dapat ditetapkan/diubah lewat UI. */
const ASSIGNABLE_ROLES = ['cs', 'admin', 'finance'] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

interface StaffUser {
  id: number;
  name: string;
  email: string;
  role: StaffRole;
  brandId: number | null;
  isActive: boolean;
  createdAt: string;
  brand: Brand | null;
  userBrands: { brand: Brand }[];
}

/* ─── Helpers ────────────────────────────────────────────────── */
const roleBadge = (role: string) =>
  role === 'superadmin'
    ? 'border-zinc-200 bg-zinc-50/80 text-zinc-800'
    : role === 'admin'
    ? 'border-amber-200 bg-amber-50/80 text-amber-800'
    : role === 'finance'
    ? 'border-zinc-200 bg-zinc-50/80 text-zinc-800'
    : 'border-emerald-200 bg-emerald-50/80 text-emerald-800';

const roleLabel = (role: string) =>
  role === 'superadmin' ? 'Superadmin' : role === 'admin' ? 'Admin Brand' : role === 'finance' ? 'Finance' : 'Customer Service';

/* ─── Brand Multi-Checkbox Component ────────────────────────── */
/** Catatan toast saat prospek terbuka milik CS dilepas ke antrean (nonaktif, dihapus, atau akses brand dicabut). */
const releasedNote = (count?: number) =>
  count ? ` ${count} prospek terbuka kembali ke antrean "Belum ada PIC".` : '';

function BrandCheckList({
  brands,
  selected,
  onChange,
  radio = false,
}: {
  brands: Brand[];
  selected: number[];
  onChange: (ids: number[]) => void;
  radio?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const filtered = brands.filter(
    (b) =>
      b.name.toLowerCase().includes(filter.toLowerCase()) ||
      b.code.toLowerCase().includes(filter.toLowerCase())
  );

  function toggle(id: number) {
    if (radio) {
      onChange([id]);
      return;
    }
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      {brands.length > 4 && (
        <div className="relative border-b border-zinc-100 p-2">
          <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            className="w-full rounded-md border border-zinc-200 bg-zinc-50/50 pl-8 pr-3 py-1.5 text-xs text-zinc-800 placeholder-zinc-400 outline-none focus:bg-white focus:border-zinc-950 transition"
            placeholder="Cari brand..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      <div className="divide-y divide-zinc-100 max-h-44 overflow-y-auto thin-scrollbar">
        {filtered.map((b) => {
          const checked = selected.includes(b.id);
          return (
            <label
              key={b.id}
              className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition select-none ${
                checked ? 'bg-zinc-50 font-medium' : 'hover:bg-zinc-50/60'
              }`}
            >
              <input
                type={radio ? 'radio' : 'checkbox'}
                checked={checked}
                onChange={() => toggle(b.id)}
                className={`h-4 w-4 text-zinc-950 focus:ring-zinc-950 cursor-pointer accent-zinc-950 ${
                  radio ? 'rounded-full' : 'rounded'
                }`}
              />
              <span className="flex-1 text-xs text-zinc-800 truncate">{b.name}</span>
            </label>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-xs text-zinc-500 text-center py-3">
            {filter ? 'Tidak ada brand yang cocok' : 'Tidak ada brand tersedia'}
          </p>
        )}
      </div>
    </div>
  );
}



/* ─── Staf Form Modal (Create & Edit) ───────────────────────── */
function StaffFormModal({
  open,
  onClose,
  brands,
  editing,
  isSuperadmin,
  defaultBrandId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  brands: Brand[];
  editing: StaffUser | null;
  isSuperadmin: boolean;
  defaultBrandId: number | null;
  onSaved: (msg: string) => void;
}) {
  const isEdit = Boolean(editing);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'cs' as StaffRole,
    brandIds: [] as number[],
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setShowPassword(false);
    if (editing) {
      const ids = [
        ...(editing.brand ? [editing.brand.id] : []),
        ...(editing.userBrands?.map((ub) => ub.brand.id).filter((id) => id !== editing.brand?.id) ?? []),
      ];
      setForm({
        name: editing.name,
        email: editing.email,
        password: '',
        // Role tampil apa adanya; tidak pernah dipetakan ulang (dulu finance/superadmin berubah jadi cs).
        role: editing.role,
        brandIds: ids,
      });
    } else {
      setForm({
        name: '',
        email: '',
        password: '',
        role: 'cs',
        brandIds: defaultBrandId ? [defaultBrandId] : brands[0]?.id ? [brands[0].id] : [],
      });
    }
  }, [open, editing?.id, defaultBrandId, brands]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Nama lengkap wajib diisi.');
      if (!form.email.trim()) throw new Error('Alamat email wajib diisi.');
      if (!isEdit && form.password.length < 8) throw new Error('Kata sandi minimal 8 karakter.');
      if (isEdit && form.password && form.password.length < 8)
        throw new Error('Kata sandi baru minimal 8 karakter.');
      if (form.brandIds.length === 0) throw new Error('Pilih minimal 1 brand yang dikaitkan.');

      if (isEdit && editing) {
        return api.patch<{ releasedProspects?: number }>(`/catalog/users/${editing.id}`, {
          name: form.name.trim(),
          email: form.email.trim(),
          ...(form.password ? { password: form.password } : {}),
          // Role hanya dikirim bila benar-benar diubah, dan tidak pernah untuk akun superadmin.
          ...(isSuperadmin && editing.role !== 'superadmin' && form.role !== editing.role ? { role: form.role } : {}),
          brandIds: form.brandIds,
        });
      } else {
        return api.post<{ releasedProspects?: number }>('/catalog/users', {
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
          brandIds: form.brandIds,
        });
      }
    },
    onSuccess: (data) => {
      onSaved(isEdit ? `Data staf berhasil diperbarui.${releasedNote(data?.releasedProspects)}` : 'Akun staf baru berhasil dibuat.');
      onClose();
    },
    onError: (e: any) => setError(e?.message || 'Gagal menyimpan data staf.'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Edit Akun Staf' : 'Tambah Staf Baru'}
      description={isEdit ? 'Perbarui data dan hak akses staf.' : 'Tambah akun staf dan atur hak akses brand.'}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>Batal</Button>
          <Button type="button" onClick={() => save.mutate()} loading={save.isPending} disabled={save.isPending}>
            {isEdit ? 'Simpan' : 'Tambah Staf'}
          </Button>
        </>
      }
    >
          <div className="space-y-3.5">
            {/* Profil: Nama & Email (2 Kolom) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="sf-name" className="text-xs font-semibold text-zinc-800">
                  Nama Lengkap <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  <input
                    id="sf-name"
                    className="w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950 transition placeholder:text-zinc-400"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Nama staf"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="sf-email" className="text-xs font-semibold text-zinc-800">
                  Email <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  <input
                    id="sf-email"
                    type="email"
                    className="w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950 transition placeholder:text-zinc-400"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="nama@email.com"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Kata Sandi */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label htmlFor="sf-pass" className="text-xs font-semibold text-zinc-800">
                  {isEdit ? 'Kata Sandi Baru' : 'Kata Sandi'}{' '}
                  {!isEdit && <span className="text-rose-500">*</span>}
                </label>
                <span className="text-xs text-zinc-500">
                  {isEdit ? 'Kosongkan jika tidak diubah' : 'Min. 8 karakter'}
                </span>
              </div>
              <div className="relative">
                <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                <input
                  id="sf-pass"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-9 py-2 text-xs font-mono text-zinc-900 outline-none focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950 transition"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={isEdit ? '•••••••• (opsional)' : 'Minimal 8 karakter'}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 transition"
                  title={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {!isEdit && form.password.length > 0 && form.password.length < 8 && (
                <p className="text-xs text-amber-600 font-medium">
                  Minimal 8 karakter ({form.password.length}/8)
                </p>
              )}
            </div>

            {/* Role Selector (Segmented Toggle, superadmin only; role superadmin terkunci) */}
            {isSuperadmin && editing?.role === 'superadmin' && (
              <p className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-xs text-zinc-800">
                Role Superadmin terkunci dan tidak dapat diubah dari form ini.
              </p>
            )}
            {isSuperadmin && editing?.role !== 'superadmin' && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-800">
                  Role Staf
                </label>
                <div className="grid grid-cols-3 p-1 bg-zinc-100 rounded-lg gap-1 border border-zinc-200/50">
                  {ASSIGNABLE_ROLES.map((role: AssignableRole) => {
                    const Icon = role === 'cs' ? UserCircle2 : role === 'admin' ? ShieldCheck : Wallet;
                    const active = form.role === role;
                    return (
                      <button
                        key={role}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setForm({ ...form, role })}
                        className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs transition ${
                          active ? 'bg-white text-zinc-950 font-semibold shadow-xs' : 'text-zinc-600 hover:text-zinc-950 font-medium'
                        }`}
                      >
                        <Icon size={14} className={active ? 'text-zinc-950' : 'text-zinc-500'} />
                        <span>{role === 'cs' ? 'CS' : roleLabel(role)}</span>
                      </button>
                    );
                  })}
                </div>
                {isEdit && editing && form.role !== editing.role && (
                  <p className="text-xs text-amber-700">
                    Role akan diubah dari {roleLabel(editing.role)} menjadi {roleLabel(form.role)}.
                  </p>
                )}
              </div>
            )}

            {/* Akses Brand */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-800">
                  Akses Brand <span className="text-rose-500">*</span>
                </label>
                {brands.length > 1 && (
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, brandIds: brands.map((b) => b.id) })}
                      className="font-medium text-zinc-600 hover:text-zinc-950 hover:underline"
                    >
                      Pilih Semua
                    </button>
                    <span className="text-zinc-500">·</span>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, brandIds: [] })}
                      className="text-zinc-500 hover:text-zinc-700"
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>

              <BrandCheckList
                brands={brands}
                selected={form.brandIds}
                onChange={(ids) => setForm({ ...form, brandIds: ids })}
                radio={false}
              />

              <div className="flex items-center justify-between text-xs">
                {form.brandIds.length > 0 ? (
                  <span className="font-medium text-zinc-500">
                    {form.brandIds.length} brand dipilih
                  </span>
                ) : (
                  <span className="font-medium text-rose-600">
                    Pilih minimal 1 brand
                  </span>
                )}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 animate-shake">
                <AlertCircle size={14} className="text-rose-600 mt-0.5 shrink-0" />
                <p className="font-medium">{error}</p>
              </div>
            )}
          </div>
    </Modal>
  );
}

/* ─── Main Staf Page ────────────────────────────────────────── */
export function StaffPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isSuperadmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin';

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'cs' | 'admin' | 'finance'>('all');
  const [brandFilter, setBrandFilter] = useState<number | 'all'>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null);
  // Superadmin memilih brand di halaman ini ("Semua Brand" = semua staf). Admin melihat staf brand utamanya
  // (bawaan API), karena Admin hanya dapat mengelola CS brand sendiri. Pemilih brand header tidak dipakai di sini.
  const staffQuery = isSuperadmin && brandFilter !== 'all' ? `?brandId=${brandFilter}` : '';

  function showToast(msg: string) {
    showFeedback(msg);
  }

  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<Brand[]>('/catalog/brands'),
  });

  const staffList = useQuery({
    queryKey: ['staff', staffQuery],
    queryFn: () => api.get<StaffUser[]>(`/catalog/users${staffQuery}`),
  });

  const toggleActive = useMutation({
    mutationFn: (id: number) => api.patch<{ id: number; isActive: boolean; releasedProspects?: number }>(`/catalog/users/${id}/toggle`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['staff'] });
      const prev = queryClient.getQueryData<StaffUser[]>(['staff', staffQuery]);
      queryClient.setQueriesData<StaffUser[]>({ queryKey: ['staff'] }, (old) =>
        old?.map((s) => (s.id === id ? { ...s, isActive: !s.isActive } : s))
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['staff', staffQuery], ctx.prev);
    },
    onSuccess: (data: any, id) => {
      const staff = staffList.data?.find((s) => s.id === id);
      const isNowActive = data?.isActive !== undefined ? data.isActive : !staff?.isActive;
      showToast(
        staff
          ? `${staff.name} berhasil ${isNowActive ? 'diaktifkan' : 'dinonaktifkan'}.${releasedNote(data?.releasedProspects)}`
          : `Staf berhasil ${isNowActive ? 'diaktifkan' : 'dinonaktifkan'}.${releasedNote(data?.releasedProspects)}`
      );
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });



  const deleteStaff = useMutation({
    mutationFn: (id: number) => api.delete<{ releasedProspects?: number }>(`/catalog/users/${id}`),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      const name = deleteTarget?.name ?? 'Staf';
      setDeleteTarget(null);
      showToast(`Staf "${name}" berhasil dihapus.${releasedNote(data?.releasedProspects)}`);
    },
    onError: (e: any) => showToast(e?.message || 'Gagal menghapus staf.'),
  });

  // Filter staf list
  const filtered = (staffList.data ?? []).filter((s) => {
    const q = search.toLowerCase();
    const matchQuery = !search || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
    const matchRole = roleFilter === 'all' || s.role === roleFilter;

    let matchBrand = true;
    if (brandFilter !== 'all') {
      const allUserBrandIds = [
        ...(s.brand ? [s.brand.id] : []),
        ...(s.userBrands?.map((ub) => ub.brand.id) ?? []),
      ];
      matchBrand = s.role === 'superadmin' || allUserBrandIds.includes(Number(brandFilter));
    }

    return matchQuery && matchRole && matchBrand;
  });

  const total = staffList.data?.length ?? 0;
  const csCount = staffList.data?.filter((s) => s.role === 'cs').length ?? 0;
  const adminCount = staffList.data?.filter((s) => s.role === 'admin').length ?? 0;
  const activeCount = staffList.data?.filter((s) => s.isActive).length ?? 0;

  return (
    <div className="app-page space-y-6">
      {/* Header */}
      <PageHeader
        title="Staf"
        subtitle="Kelola akun dan hak akses tim sales, CS, dan admin."
        actions={
          (isSuperadmin || isAdmin) ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              icon={<Plus size={14} />}
            >
              Tambah Staf
            </Button>
          ) : undefined
        }
      />

      {/* 4 Metric Stats */}
      <StatGrid cols={4}>
        <StatCard label="Total Staf" value={total} note="Semua akun" />
        <StatCard label="Customer Service" value={csCount} note="Tim CS" />
        <StatCard label="Admin Brand" value={adminCount} note="Admin brand" />
        <StatCard label="Akun Aktif" value={activeCount} note="Status aktif" />
      </StatGrid>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-xs text-zinc-900 outline-none focus:border-black focus:ring-1 focus:ring-black transition placeholder:text-zinc-400 shadow-xs"
            placeholder="Cari nama atau email staf…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Brand Filter (for superadmin) */}
        {isSuperadmin && brands.data && brands.data.length > 1 && (
          <Select
            value={String(brandFilter)}
            onValueChange={(val) => setBrandFilter(val === 'all' ? 'all' : Number(val))}
            options={[
              { value: 'all', label: 'Semua Brand' },
              ...brands.data.map((b) => ({
                value: String(b.id),
                label: b.name,
              })),
            ]}
            className="h-9 min-w-[170px] text-xs font-medium rounded-lg border-zinc-200 shadow-xs focus:ring-1 focus:ring-zinc-950 py-0"
          />
        )}

        {/* Role Pills Filter */}
        <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 shadow-xs shrink-0">
          {(['all', 'cs', 'admin', 'finance'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                roleFilter === r ? 'bg-zinc-950 text-white font-semibold shadow-xs' : 'text-zinc-600 hover:text-zinc-950'
              }`}
            >
              {r === 'all' ? 'Semua' : r === 'cs' ? 'CS' : r === 'admin' ? 'Admin' : 'Finance'}
            </button>
          ))}
        </div>
      </div>

      {/* Staf Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {staffList.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-zinc-500">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-xs">Memuat data staf…</span>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Tidak ada staf ditemukan"
            description={search || roleFilter !== 'all' || brandFilter !== 'all' ? 'Coba ubah kata kunci pencarian atau filter role/brand.' : 'Belum ada akun staf. Tambahkan lewat tombol Tambah Staf.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs lg:min-w-[720px]">
              <thead className="border-b border-zinc-200 bg-zinc-50/75 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Staf</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Akses Brand</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map((staff) => {
                  const allBrands: Brand[] = [
                    ...(staff.brand ? [staff.brand] : []),
                    ...(staff.userBrands?.map((ub) => ub.brand).filter((b) => b.id !== staff.brand?.id) ?? []),
                  ];
                  const isSelf = staff.id === user?.id;
                  const canManage = isSuperadmin || (isAdmin && staff.role === 'cs');

                  return (
                    <tr key={staff.id} className="group hover:bg-zinc-50/60 transition-colors">
                      {/* Name & Email */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 shrink-0 rounded-lg bg-zinc-950 flex items-center justify-center text-white text-xs font-extrabold shadow-xs">
                            {staff.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-bold text-zinc-900 text-xs truncate">{staff.name}</p>
                              {isSelf && (
                                <span className="shrink-0 text-xs font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.2 rounded">
                                  Anda
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-zinc-500 truncate">{staff.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Role Badge */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium shadow-2xs ${roleBadge(
                            staff.role
                          )}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                              staff.role === 'superadmin'
                                ? 'bg-zinc-500'
                                : staff.role === 'admin'
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                          />
                          {roleLabel(staff.role)}
                        </span>
                      </td>

                      {/* Brand Access Badges */}
                      <td className="px-4 py-3">
                        {staff.role === 'superadmin' ? (
                          <span className="text-xs text-zinc-500">Semua brand</span>
                        ) : allBrands.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {allBrands.map((b) => (
                              <span
                                key={b.id}
                                title={b.name}
                                className="inline-flex items-center rounded-md border border-zinc-200/80 bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-zinc-700"
                              >
                                {b.code}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-500">Belum ada brand</span>
                        )}
                      </td>

                      {/* Status Indicator */}
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={staff.isActive ? 'active' : 'neutral'}
                          label={staff.isActive ? 'Aktif' : 'Nonaktif'}
                          dot
                        />
                      </td>

                      {/* Action Buttons */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">

                          {/* Edit button */}
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(staff);
                                setFormOpen(true);
                              }}
                              title="Edit staf"
                              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition"
                            >
                              <Edit2 size={13} />
                            </button>
                          )}

                          {/* Toggle Active status */}
                          {canManage && !isSelf && (
                            <button
                              type="button"
                              onClick={() => toggleActive.mutate(staff.id)}
                              title={staff.isActive ? 'Nonaktifkan akun' : 'Aktifkan akun'}
                              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 transition"
                            >
                              {staff.isActive ? (
                                <ToggleRight size={17} className="text-emerald-600" />
                              ) : (
                                <ToggleLeft size={17} className="text-zinc-500" />
                              )}
                            </button>
                          )}

                          {/* Delete button */}
                          {canManage && !isSelf && staff.role !== 'superadmin' && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(staff)}
                              title="Hapus staf"
                              className="rounded-lg p-1.5 text-zinc-500 hover:bg-rose-50 hover:text-rose-600 transition"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Staf Form Modal */}
      <StaffFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        brands={brands.data ?? []}
        editing={editing}
        isSuperadmin={isSuperadmin}
        defaultBrandId={isSuperadmin ? (typeof brandFilter === 'number' ? brandFilter : null) : (user?.brandId ?? null)}
        onSaved={(msg) => {
          void queryClient.invalidateQueries({ queryKey: ['staff'] });
          showToast(msg);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteStaff.mutate(deleteTarget.id)}
        pending={deleteStaff.isPending}
        title="Hapus staf?"
        description={<>Akun <strong>{deleteTarget?.name}</strong> ({deleteTarget?.email}) dihapus permanen. Prospek terbukanya kembali ke antrean "Belum ada PIC".</>}
        confirmLabel="Hapus staf"
      />

    </div>
  );
}

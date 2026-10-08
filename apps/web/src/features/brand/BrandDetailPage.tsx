import { useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  MapPin,
  MoreVertical,
  Pencil,
  Phone,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api, resolveMediaUrl } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { StatGrid, StatCard } from '../../components/ui/stat-card';
import { StatusBadge } from '../../components/ui/status-badge';
import { showFeedback } from '../../app/toast';
import { ConfirmDialog } from '../../components/ui/modal';
import { cn } from '../../lib/cn';
import { WhatsAppDevicePanel } from '../admin/WhatsAppDevicePanel';
import { MetaCapiPage } from '../meta/MetaCapiPage';
import { onRovingKey, rovingTabIndex } from '../custom/roving';

/** Semua pengaturan satu brand di satu tempat (dulu menu Perangkat WhatsApp & Meta CAPI terpisah). */
const BRAND_TABS = [
  { id: 'profil', label: 'Profil & rekening', short: 'Profil' },
  { id: 'perangkat', label: 'Perangkat WhatsApp', short: 'Perangkat' },
  { id: 'meta', label: 'Meta CAPI', short: 'Meta CAPI' },
] as const;
type BrandTab = (typeof BRAND_TABS)[number]['id'];

interface BrandDetail {
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
    pushName?: string | null;
  } | null;
  _count?: {
    users: number;
    prospects: number;
    packages: number;
  };
  users?: Array<{
    id: number;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
  }>;
}

export function BrandDetailPage() {
  const { brandId } = useParams<{ brandId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: BrandTab = BRAND_TABS.some((t) => t.id === tabParam) ? (tabParam as BrandTab) : 'profil';
  const setTab = (next: BrandTab) => setSearchParams(next === 'profil' ? {} : { tab: next }, { replace: true });
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = user?.role === 'superadmin';
  // Admin ikut menautkan/memutus device WhatsApp; ubah data brand tetap khusus Super Admin.
  const canManageDevice = canManage || user?.role === 'admin';

  const [copiedBank, setCopiedBank] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  function showToast(msg: string) {
    showFeedback(msg);
  }

  // Query brand details
  const brandQuery = useQuery({
    queryKey: ['brand', brandId],
    queryFn: () => api.get<BrandDetail>(`/catalog/brands/${brandId}`),
    enabled: Boolean(brandId),
  });

  const brand = brandQuery.data;

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/catalog/brands/${brandId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      navigate('/brands', { replace: true });
    },
    onError: (err: any) => {
      showToast(err?.message || 'Gagal menghapus brand travel.');
    },
  });

  const copyBankNumber = async () => {
    if (!brand?.bankAccountNumber) return;
    try {
      await navigator.clipboard.writeText(brand.bankAccountNumber);
      setCopiedBank(true);
      setTimeout(() => setCopiedBank(false), 2000);
      showToast('Nomor rekening berhasil disalin.');
    } catch {
      showToast('Gagal menyalin nomor rekening.');
    }
  };

  if (brandQuery.isLoading) return <PageLoading label="Memuat rincian brand travel…" />;
  if (brandQuery.isError || !brand) {
    return (
      <PageError
        title="Brand tidak ditemukan"
        description={(brandQuery.error as Error)?.message || 'Data brand travel tidak ditemukan atau telah dihapus.'}
        onRetry={() => void brandQuery.refetch()}
      />
    );
  }

  const waConnected = brand.whatsappSession?.status === 'connected';

  return (
    <div className="app-page space-y-6 pb-16">
      {/* Header */}
      {/* Mobile: layar detail ala aplikasi (app bar + kartu profil); desktop memakai PageHeader di bawah. */}
      <div className="space-y-3 md:hidden">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/brands')}
            className="-ml-2 grid h-11 w-11 place-items-center rounded-full text-zinc-900 transition active:bg-zinc-200"
            aria-label="Kembali"
          >
            <ArrowLeft size={22} aria-hidden="true" />
          </button>
          <span className="text-base font-semibold text-zinc-950">Detail brand</span>
          {canManage ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-zinc-900 transition active:bg-zinc-200"
                  aria-label="Menu brand"
                >
                  <MoreVertical size={22} aria-hidden="true" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={4} className="z-50 w-52 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl">
                  <DropdownMenu.Item
                    onSelect={() => setDeleteConfirmOpen(true)}
                    className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-rose-700 outline-none data-[highlighted]:bg-rose-50"
                  >
                    <Trash2 size={16} aria-hidden="true" />Hapus brand
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <span className="h-11 w-11" aria-hidden="true" />
          )}
        </div>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-3.5">
            {brand.logoUrl ? (
              <img src={resolveMediaUrl(brand.logoUrl)} alt="" className="h-14 w-14 shrink-0 rounded-2xl border border-zinc-200 object-cover" />
            ) : (
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-zinc-100 text-zinc-500"><Building2 size={24} aria-hidden="true" /></span>
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-bold leading-tight tracking-tight text-zinc-950">{brand.name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-md border border-zinc-200 bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-zinc-700">{brand.code}</span>
                <StatusBadge status={waConnected ? 'active' : 'neutral'} label={waConnected ? 'WA Terhubung' : 'WA Terputus'} dot />
              </div>
            </div>
          </div>
          {canManage && (
            <Button to={`/brands/${brand.id}/edit`} variant="primary" size="lg" icon={<Pencil size={15} />} className="mt-4 w-full">
              Edit Brand
            </Button>
          )}
        </section>
      </div>

      <PageHeader
        className="hidden md:flex"
        backUrl="/brands"
        title={
          <span className="flex items-center gap-3">
            {brand.logoUrl ? (
              <img
                src={resolveMediaUrl(brand.logoUrl)}
                alt={brand.name}
                className="h-9 w-9 rounded-lg object-cover border border-zinc-200 shadow-xs"
              />
            ) : null}
            {brand.name}
          </span>
        }
        badges={
          <>
            <span className="rounded-md border border-zinc-200 bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-zinc-700">
              {brand.code}
            </span>
            <StatusBadge
              status={waConnected ? 'active' : 'neutral'}
              label={waConnected ? 'WA Terhubung' : 'WA Terputus'}
              dot
            />
          </>
        }
        subtitle={
          <span className="flex flex-col gap-0.5">
            <span className="line-clamp-2">{brand.address || 'Kantor Pusat'}</span>
            <span className="tabular-nums">{brand.phone || 'Nomor resmi belum diisi'}</span>
          </span>
        }
        actions={
          <>
            {canManage && (
              <>
                <Button
                  variant="primary"
                  size="md"
                  to={`/brands/${brand.id}/edit`}
                  icon={<Pencil size={13} />}
                >
                  Edit Brand
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="text-zinc-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50"
                  title="Hapus brand"
                >
                  <Trash2 size={14} />
                </Button>
              </>
            )}
          </>
        }
      />

      {/* Statistik: mobile satu kartu 3 kolom; desktop 4 kartu */}
      <dl className="grid grid-cols-3 divide-x divide-zinc-100 rounded-2xl border border-zinc-200 bg-white py-3 text-center md:hidden">
        {([["Staf", brand._count?.users ?? 0], ["Paket", brand._count?.packages ?? 0], ["Prospek", brand._count?.prospects ?? 0]] as const).map(([label, value]) => (
          <div key={label}>
            <dd className="text-xl font-bold tabular-nums text-zinc-950">{value}</dd>
            <dt className="text-xs text-zinc-500">{label}</dt>
          </div>
        ))}
      </dl>
      <StatGrid cols={4} className="hidden md:grid">
        <StatCard label="Total Staf Tim" value={brand._count?.users ?? 0} note="Akses sales & CS" />
        <StatCard label="Total Paket Umroh" value={brand._count?.packages ?? 0} note="Katalog program" />
        <StatCard label="Total Prospek" value={brand._count?.prospects ?? 0} note="Pipeline prospek" />
        <StatCard
          label="Sesi WhatsApp"
          value={waConnected ? 'Terhubung' : 'Terputus'}
          note="Status gateway"
        />
      </StatGrid>

      <div role="tablist" aria-label="Pengaturan brand" className="segmented grid grid-cols-3 gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 md:hidden" onKeyDown={(e) => onRovingKey(e, BRAND_TABS.map((t) => t.id), tab, setTab)}>
        {BRAND_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            tabIndex={rovingTabIndex(t.id, tab, 'profil')}
            onClick={() => setTab(t.id)}
            className={cn('rounded-lg px-2 text-sm font-medium transition', tab === t.id ? 'bg-white font-semibold text-zinc-950 shadow-xs' : 'text-zinc-600')}
          >
            {t.short}
          </button>
        ))}
      </div>
      <div role="tablist" aria-label="Pengaturan brand" className="scroll-row hidden gap-2 border-b border-zinc-200 md:flex" onKeyDown={(e) => onRovingKey(e, BRAND_TABS.map((t) => t.id), tab, setTab)}>
        {BRAND_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`brand-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`brand-panel-${t.id}`}
            tabIndex={rovingTabIndex(t.id, tab, 'profil')}
            onClick={() => setTab(t.id)}
            className={cn('-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-xs font-medium', tab === t.id ? 'border-zinc-950 font-semibold text-zinc-950' : 'border-transparent text-zinc-500 hover:text-zinc-950')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'perangkat' && (
        <div role="tabpanel" id="brand-panel-perangkat" aria-labelledby="brand-tab-perangkat">
          <WhatsAppDevicePanel brandId={brand.id} brandName={brand.name} canManage={canManageDevice} />
        </div>
      )}
      {tab === 'meta' && (
        <div role="tabpanel" id="brand-panel-meta" aria-labelledby="brand-tab-meta">
          <MetaCapiPage brandId={brand.id} />
        </div>
      )}

      {/* 2-Column Responsive Layout */}
      {tab === 'profil' && (
      <>
      {/* Mobile: daftar berkelompok ala aplikasi (label bagian di luar kartu, baris 48px). */}
      <div role="tabpanel" aria-labelledby="brand-tab-profil" className="space-y-6 md:hidden">
        <section aria-label="Kontak dan legalitas" className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Kontak & legalitas</h2>
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            <li className="px-4 py-3">
              <p className="text-xs text-zinc-500">Izin PPIU Kemenag</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-950">{brand.ppiuNumber || 'Belum didaftarkan'}</p>
            </li>
            <li className="px-4 py-3">
              <p className="text-xs text-zinc-500">Telepon</p>
              {brand.phone ? (
                <a href={`tel:+${brand.phone.replace(/\D/g, '')}`} className="mt-0.5 block text-sm font-semibold tabular-nums text-zinc-950">{brand.phone}</a>
              ) : (
                <p className="mt-0.5 text-sm text-zinc-500">Belum diisi</p>
              )}
            </li>
            <li className="px-4 py-3">
              <p className="text-xs text-zinc-500">Alamat kantor</p>
              <p className="mt-0.5 text-sm leading-relaxed text-zinc-900">{brand.address || 'Belum dicantumkan'}</p>
            </li>
            {brand.gmapsUrl && /^https?:\/\//i.test(brand.gmapsUrl) && (
              <li>
                <a href={brand.gmapsUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-between gap-3 px-4 text-sm font-semibold text-zinc-950 active:bg-zinc-50">
                  <span className="flex items-center gap-2.5"><MapPin size={18} className="text-zinc-500" aria-hidden="true" />Buka di Google Maps</span>
                  <ExternalLink size={16} className="text-zinc-400" aria-hidden="true" />
                </a>
              </li>
            )}
          </ul>
        </section>

        <section aria-label="Rekening bank" className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Rekening bank</h2>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            {brand.bankName ? (
              <>
                <p className="text-xs text-zinc-500">{brand.bankName}</p>
                <p className="mt-1 font-mono text-xl font-bold tracking-tight text-zinc-950">{brand.bankAccountNumber}</p>
                <p className="mt-1 text-sm text-zinc-700">a.n. {brand.bankAccountHolder || '-'}</p>
                {brand.bankAccountNumber && (
                  <Button type="button" variant="outline" size="lg" onClick={copyBankNumber} icon={copiedBank ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />} className="mt-3 w-full">
                    {copiedBank ? 'Tersalin' : 'Salin nomor rekening'}
                  </Button>
                )}
              </>
            ) : (
              <p className="text-sm text-zinc-500">Belum ada rekening resmi.</p>
            )}
          </div>
        </section>

        <section aria-label="WhatsApp" className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">WhatsApp</h2>
          <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs text-zinc-500">Nomor</p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-950">{brand.whatsappSession?.phoneNumber || '-'}</p>
              </div>
              <StatusBadge status={waConnected ? 'active' : 'neutral'} label={waConnected ? 'Aktif' : 'Terputus'} dot />
            </div>
            <button type="button" onClick={() => setTab('perangkat')} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm font-semibold text-zinc-950 active:bg-zinc-50">
              <span className="flex items-center gap-2.5"><Smartphone size={18} className="text-zinc-500" aria-hidden="true" />Pengaturan perangkat</span>
              <ChevronRight size={18} className="text-zinc-400" aria-hidden="true" />
            </button>
          </div>
        </section>

        <section aria-label="Staf tim" className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Staf tim ({brand.users?.length ?? 0})</h2>
            <Link to="/staff" className="flex min-h-11 items-center text-sm font-semibold text-zinc-950">Kelola</Link>
          </div>
          {brand.users && brand.users.length > 0 ? (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
              {brand.users.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-950">{member.name}</p>
                    <p className="truncate text-xs text-zinc-500">{member.email}</p>
                  </div>
                  <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">{member.role === 'admin' ? 'Admin' : 'CS'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">Belum ada staf di brand ini.</p>
          )}
        </section>
      </div>

      <div role="tabpanel" id="brand-panel-profil" aria-labelledby="brand-tab-profil" className="hidden gap-6 md:grid lg:grid-cols-2 items-start">
        {/* Left Column */}
        <div className="space-y-5">
          {/* 1. Legalitas & Kontak Kantor */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
              <ShieldCheck size={17} className="text-zinc-600" />
              <div>
                <h3 className="font-display text-xs font-extrabold text-zinc-700">
                  Legalitas & Kontak Resmi
                </h3>
                <p className="text-xs text-zinc-500">Identitas resmi biro dan alamat kantor.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 text-xs">
              <div>
                <span className="text-xs text-zinc-500 block font-medium">Izin PPIU Kemenag</span>
                <span className="font-bold text-zinc-900 text-xs block font-mono mt-0.5">
                  {brand.ppiuNumber || 'Belum didaftarkan'}
                </span>
              </div>

              <div>
                <span className="text-xs text-zinc-500 block font-medium">Hotline / No. Telepon</span>
                <span className="font-bold text-zinc-900 text-xs block font-mono mt-0.5">
                  {brand.phone || 'Belum diisi'}
                </span>
              </div>

              <div className="sm:col-span-2 pt-2 border-t border-zinc-100">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-zinc-500 font-medium">Alamat Kantor</span>
                  {brand.gmapsUrl && /^https?:\/\//i.test(brand.gmapsUrl) && (
                    <a
                      href={brand.gmapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-700 hover:text-zinc-950 transition"
                    >
                      <MapPin size={11} className="text-zinc-500" />
                      <span>Buka Google Maps</span>
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
                <p className="text-xs text-zinc-800 leading-relaxed">
                  {brand.address || 'Alamat kantor biro belum dicantumkan.'}
                </p>
              </div>
            </div>
          </Card>

          {/* 2. Rekening Resmi Bank */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <CreditCard size={17} className="text-zinc-600" />
                <div>
                  <h3 className="font-display text-xs font-extrabold text-zinc-700">
                    Rekening Resmi Bank
                  </h3>
                  <p className="text-xs text-zinc-500">Rekening tujuan pembayaran jamaah (DP atau lunas).</p>
                </div>
              </div>

              {brand.bankAccountNumber && (
                <button
                  type="button"
                  onClick={copyBankNumber}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-950 hover:underline cursor-pointer"
                >
                  {copiedBank ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                  <span>{copiedBank ? 'Tersalin!' : 'Salin No. Rekening'}</span>
                </button>
              )}
            </div>

            {brand.bankName ? (
              <div className="space-y-1 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-zinc-900">
                    {brand.bankName}
                  </span>
                  <span className="font-mono text-sm font-bold text-zinc-950 tracking-tight">
                    {brand.bankAccountNumber}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  Atas Nama: <strong className="text-zinc-900 font-semibold">{brand.bankAccountHolder || '-'}</strong>
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 italic py-2">Belum ada data rekening resmi yang didaftarkan.</p>
            )}
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-5">
          {/* Status WhatsApp Gateway */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
              <h3 className="text-xs font-extrabold text-zinc-700 flex items-center gap-1.5">
                <Smartphone size={14} className="text-zinc-500" />
                WhatsApp Gateway
              </h3>
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold ${
                  waConnected ? 'text-emerald-700' : 'text-zinc-500'
                }`}
              >
                {waConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
                {waConnected ? 'Aktif' : 'Terputus'}
              </span>
            </div>

            <div className="space-y-1.5 text-xs text-zinc-700">
              <div className="flex justify-between">
                <span className="text-zinc-500">Nomor WhatsApp:</span>
                <strong className="font-mono text-zinc-900">{brand.whatsappSession?.phoneNumber || '-'}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Nama Device:</span>
                <strong className="text-zinc-900 truncate max-w-[150px]">{brand.whatsappSession?.pushName || brand.name}</strong>
              </div>
            </div>

            <Button
              variant="outline"
              size="md"
              onClick={() => setTab('perangkat')}
              icon={<Smartphone size={13} />}
              className="w-full"
            >
              Buka Pengaturan Perangkat
            </Button>
          </Card>

          {/* Tim Sales & Staf */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
              <h3 className="text-xs font-extrabold text-zinc-700 flex items-center gap-1.5">
                <Users size={14} className="text-zinc-500" />
                Staf Tim ({brand.users?.length ?? 0})
              </h3>
              <Link to="/staff" className="text-xs font-bold text-zinc-950 hover:underline">
                Kelola Staf
              </Link>
            </div>

            {brand.users && brand.users.length > 0 ? (
              <div className="divide-y divide-zinc-100">
                {brand.users.map((member) => (
                  <div key={member.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-xs text-zinc-900 truncate">{member.name}</p>
                      <p className="text-xs text-zinc-500 truncate">{member.email}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold ${
                        member.role === 'admin'
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      }`}
                    >
                      {member.role === 'admin' ? 'Admin' : 'CS'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500 italic py-2">Belum ada staf yang ditugaskan ke brand ini.</p>
            )}
          </Card>
        </div>
      </div>
      </>
      )}

      <ConfirmDialog
        open={Boolean(deleteConfirmOpen)}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        pending={deleteMutation.isPending}
        error={deleteMutation.isError ? (deleteMutation.error as Error)?.message || 'Gagal menghapus brand.' : null}
        // API menolak menghapus brand yang masih punya prospek atau paket: jangan janjikan "hapus semua data".
        confirmDisabled={((brand?._count?.prospects ?? 0) + (brand?._count?.packages ?? 0)) > 0}
        title="Hapus Brand Travel?"
        description={<>Brand <strong>{brand?.name}</strong> ({brand?.code}) akan dihapus beserta sesi WhatsApp-nya. Tindakan ini tidak dapat dibatalkan.</>}
        confirmLabel="Hapus Brand"
      >
        {((brand?._count?.prospects ?? 0) + (brand?._count?.packages ?? 0)) > 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
            Brand ini masih punya <strong>{brand?._count?.prospects ?? 0}</strong> prospek dan <strong>{brand?._count?.packages ?? 0}</strong> paket,
            sehingga tidak dapat dihapus. Arsipkan paketnya atau hubungi tim holding.
          </p>
        ) : undefined}
      </ConfirmDialog>

    </div>
  );
}

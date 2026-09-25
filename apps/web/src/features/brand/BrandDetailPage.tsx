import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  MapPin,
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = user?.role === 'superadmin';

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
      <PageHeader
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
        subtitle={`${brand.address || 'Kantor Pusat'} · ${brand.phone || 'Nomor resmi belum diisi'}`}
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              to={`/devices/${brand.id}`}
              icon={<Smartphone size={13} className="text-zinc-500" />}
            >
              Perangkat WA
            </Button>

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

      {/* 4 Metric Stats */}
      <StatGrid cols={4}>
        <StatCard label="Total Staf Tim" value={brand._count?.users ?? 0} note="Akses sales & CS" />
        <StatCard label="Total Paket Umroh" value={brand._count?.packages ?? 0} note="Katalog program" />
        <StatCard label="Total Prospek" value={brand._count?.prospects ?? 0} note="Pipeline prospek" />
        <StatCard
          label="Sesi WhatsApp"
          value={waConnected ? 'Terhubung' : 'Terputus'}
          note="Status gateway"
        />
      </StatGrid>

      {/* 2-Column Responsive Layout */}
      <div className="grid gap-6 lg:grid-cols-2 items-start">
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
                  <p className="text-xs text-zinc-500">Rekening tujuan pembayaran awal jamaah (DP atau lunas).</p>
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
              to={`/devices/${brand.id}`}
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

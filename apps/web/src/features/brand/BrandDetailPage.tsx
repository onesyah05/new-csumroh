import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
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
import { api } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { StatGrid, StatCard } from '../../components/ui/stat-card';
import { StatusBadge } from '../../components/ui/status-badge';

interface BrandDetail {
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
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3600);
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
        title={brand.name}
        badges={
          <>
            <span className="rounded-md border border-zinc-200 bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-zinc-700">
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
                  className="text-zinc-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50"
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
        <StatCard label="Total Staff Tim" value={brand._count?.users ?? 0} note="Akses operasional" />
        <StatCard label="Total Paket Umroh" value={brand._count?.packages ?? 0} note="Katalog program" />
        <StatCard label="Total Prospek" value={brand._count?.prospects ?? 0} note="Database jamaah" />
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
                <h3 className="font-display text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                  Legalitas & Kontak Resmi
                </h3>
                <p className="text-[11px] text-zinc-400">Identitas resmi Kemenag dan alamat operasional kantor biro.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 text-xs">
              <div>
                <span className="text-[11px] text-zinc-400 block font-medium">Izin PPIU Kemenag</span>
                <span className="font-bold text-zinc-900 text-xs block font-mono mt-0.5">
                  {brand.ppiuNumber || 'Belum didaftarkan'}
                </span>
              </div>

              <div>
                <span className="text-[11px] text-zinc-400 block font-medium">Hotline / No. Telepon</span>
                <span className="font-bold text-zinc-900 text-xs block font-mono mt-0.5">
                  {brand.phone || 'Belum diisi'}
                </span>
              </div>

              <div className="sm:col-span-2 pt-2 border-t border-zinc-100">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-zinc-400 font-medium">Alamat Kantor</span>
                  {brand.gmapsUrl && /^https?:\/\//i.test(brand.gmapsUrl) && (
                    <a
                      href={brand.gmapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-700 hover:text-zinc-950 transition"
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
                  <h3 className="font-display text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                    Rekening Resmi Bank
                  </h3>
                  <p className="text-[11px] text-zinc-400">Rekening tujuan transfer DP dan pelunasan paket jamaah.</p>
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
                  <span className="text-xs font-extrabold uppercase text-zinc-900 tracking-wider">
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
              <p className="text-xs text-zinc-400 italic py-2">Belum ada data rekening resmi yang didaftarkan.</p>
            )}
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-5">
          {/* Status WhatsApp Gateway */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700 flex items-center gap-1.5">
                <Smartphone size={14} className="text-zinc-500" />
                WhatsApp Gateway
              </h3>
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                  waConnected ? 'text-emerald-700' : 'text-zinc-400'
                }`}
              >
                {waConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
                {waConnected ? 'Aktif' : 'Terputus'}
              </span>
            </div>

            <div className="space-y-1.5 text-xs text-zinc-700">
              <div className="flex justify-between">
                <span className="text-zinc-400">Nomor WhatsApp:</span>
                <strong className="font-mono text-zinc-900">{brand.whatsappSession?.phoneNumber || '-'}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Nama Device:</span>
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

          {/* Tim Staff Operasional */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700 flex items-center gap-1.5">
                <Users size={14} className="text-zinc-500" />
                Staff Tim ({brand.users?.length ?? 0})
              </h3>
              <Link to="/staff" className="text-xs font-bold text-zinc-950 hover:underline">
                Kelola Staff
              </Link>
            </div>

            {brand.users && brand.users.length > 0 ? (
              <div className="divide-y divide-zinc-100">
                {brand.users.map((member) => (
                  <div key={member.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-xs text-zinc-900 truncate">{member.name}</p>
                      <p className="text-[11px] text-zinc-400 truncate">{member.email}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
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
              <p className="text-xs text-zinc-400 italic py-2">Belum ada staff yang ditugaskan ke brand ini.</p>
            )}
          </Card>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog.Root open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
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
              Menghapus biro <strong>{brand.name}</strong> ({brand.code}) akan menghapus seluruh data turunan berikut:
            </Dialog.Description>

            <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50/60 p-3.5 text-xs text-rose-900 space-y-1">
              <p>• <strong>{brand._count?.prospects ?? 0}</strong> data calon jamaah (prospek)</p>
              <p>• <strong>{brand._count?.packages ?? 0}</strong> paket umroh biro</p>
              <p>• Riwayat chat dan sesi WhatsApp gateway</p>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setDeleteConfirmOpen(false)}
              >
                Batal
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => deleteMutation.mutate()}
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

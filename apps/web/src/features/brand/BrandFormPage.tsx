import { useState, useEffect, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CreditCard,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';

interface BrandFormData {
  name: string;
  code: string;
  ppiuNumber: string;
  phone: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  address: string;
  gmapsUrl: string;
}

export function BrandFormPage() {
  const { brandId } = useParams<{ brandId: string }>();
  const isEditing = Boolean(brandId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const backUrl = isEditing ? `/brands/${brandId}` : '/brands';

  const [form, setForm] = useState<BrandFormData>({
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

  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<any[]>('/catalog/brands'),
  });

  const currentBrand = brands.data?.find((b) => String(b.id) === brandId);

  // Pre-fill form if editing
  useEffect(() => {
    if (isEditing && currentBrand) {
      setForm({
        name: currentBrand.name ?? '',
        code: currentBrand.code ?? '',
        ppiuNumber: currentBrand.ppiuNumber ?? '',
        phone: currentBrand.phone ?? '',
        bankName: currentBrand.bankName ?? '',
        bankAccountNumber: currentBrand.bankAccountNumber ?? '',
        bankAccountHolder: currentBrand.bankAccountHolder ?? '',
        address: currentBrand.address ?? '',
        gmapsUrl: currentBrand.gmapsUrl ?? '',
      });
    }
  }, [isEditing, currentBrand]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        ppiuNumber: form.ppiuNumber.trim() || null,
        phone: form.phone.trim() || null,
        bankName: form.bankName.trim() || null,
        bankAccountNumber: form.bankAccountNumber.trim() || null,
        bankAccountHolder: form.bankAccountHolder.trim() || null,
        address: form.address.trim() || null,
        gmapsUrl: form.gmapsUrl.trim() || null,
      };

      if (isEditing) {
        return api.patch<any>(`/catalog/brands/${brandId}`, payload);
      }
      return api.post<any>('/catalog/brands', payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      if (isEditing) {
        void queryClient.invalidateQueries({ queryKey: ['brand', brandId] });
        navigate(`/brands/${brandId}`);
      } else {
        navigate('/brands');
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/catalog/brands/${brandId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      navigate('/brands', { replace: true });
    },
  });

  if (isEditing && brands.isLoading) {
    return <PageLoading label="Memuat informasi brand…" />;
  }

  if (isEditing && brands.isError) {
    return <PageError description={brands.error.message} onRetry={() => void brands.refetch()} />;
  }

  if (isEditing && brands.data && !currentBrand) {
    return (
      <PageError
        title="Brand tidak ditemukan"
        description="Brand dengan ID tersebut tidak ditemukan di sistem."
        onRetry={() => navigate('/brands')}
      />
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    saveMutation.mutate();
  }

  const avatarPreview = (form.code?.trim() || form.name?.trim() || 'BRD').slice(0, 3).toUpperCase();
  const canDelete = isEditing && user?.role === 'superadmin';

  return (
    <div className="app-page max-w-4xl pb-16">
      {/* Header */}
      <PageHeader
        backUrl={backUrl}
        title={isEditing ? `Ubah Profil: ${currentBrand?.name ?? ''}` : 'Tambah Brand Baru'}
        subtitle={
          isEditing
            ? 'Perbarui legalitas, kontak resmi, rekening, dan alamat kantor biro travel.'
            : 'Daftarkan profil biro umroh baru ke dalam sistem CRM multi-brand.'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(backUrl)}
              disabled={saveMutation.isPending || deleteMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              loading={saveMutation.isPending}
              disabled={saveMutation.isPending || deleteMutation.isPending}
              icon={!saveMutation.isPending ? <Save size={14} /> : undefined}
            >
              {isEditing ? 'Simpan Perubahan' : 'Buat Brand Baru'}
            </Button>
          </div>
        }
      />

      {/* Form Content */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {saveMutation.isError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
            <strong>Gagal menyimpan:</strong> {(saveMutation.error as Error)?.message || 'Terjadi kesalahan sistem.'}
          </div>
        )}

        <Card className="p-6 space-y-6">
          {/* 1. Identitas Brand */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
              <Building2 size={17} className="text-zinc-600" />
              <div>
                <h3 className="font-display text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                  Identitas Brand
                </h3>
                <p className="text-[11px] text-zinc-400">Nama resmi biro dan kode identifikasi sistem.</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-5 items-start">
              {/* Avatar Preview */}
              <div className="flex flex-col items-center gap-1.5 shrink-0 self-center sm:self-start">
                <span className="grid h-14 w-14 place-items-center rounded-xl bg-zinc-950 font-display text-base font-extrabold text-white shadow-xs">
                  {avatarPreview}
                </span>
                <span className="text-[10px] font-mono uppercase text-zinc-400">Avatar</span>
              </div>

              <div className="grid gap-4 flex-1 w-full sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="brand-name" className="label text-xs font-semibold">
                    Nama Brand Travel <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="brand-name"
                    className="field"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="contoh: Azhan Tour & Travel"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="brand-code" className="label text-xs font-semibold">
                    Kode Brand <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="brand-code"
                    className="field uppercase font-mono"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    placeholder="AZHAN"
                    pattern="^[A-Za-z0-9_-]+$"
                    title="Hanya huruf kapital, angka, strip (-), dan garis bawah (_)"
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 2. Legalitas & Kontak Resmi */}
          <div className="border-t border-zinc-100 pt-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
              <ShieldCheck size={17} className="text-zinc-600" />
              <div>
                <h3 className="font-display text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                  Legalitas & Kontak Resmi
                </h3>
                <p className="text-[11px] text-zinc-400">Izin Kemenag dan kontak layanan jamaah.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="brand-ppiu" className="label text-xs font-semibold">
                  Nomor Izin PPIU (Kemenag)
                </label>
                <div className="relative">
                  <FileText size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                  <input
                    id="brand-ppiu"
                    className="field pl-9"
                    value={form.ppiuNumber}
                    onChange={(e) => setForm({ ...form, ppiuNumber: e.target.value })}
                    placeholder="contoh: 123/PPIU/2024"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="brand-phone" className="label text-xs font-semibold">
                  Hotline / No. Telepon Kantor
                </label>
                <div className="relative">
                  <Phone size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                  <input
                    id="brand-phone"
                    className="field pl-9"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="contoh: 08123456789"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 3. Rekening Resmi Bank */}
          <div className="border-t border-zinc-100 pt-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
              <CreditCard size={17} className="text-zinc-600" />
              <div>
                <h3 className="font-display text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                  Rekening Resmi Bank
                </h3>
                <p className="text-[11px] text-zinc-400">Rekening tujuan transfer DP dan pelunasan paket umroh.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label htmlFor="brand-bank-name" className="label text-xs font-semibold">
                  Nama Bank
                </label>
                <input
                  id="brand-bank-name"
                  className="field"
                  value={form.bankName}
                  onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                  placeholder="Bank Syariah Indonesia (BSI)"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="brand-bank-acc" className="label text-xs font-semibold">
                  Nomor Rekening
                </label>
                <input
                  id="brand-bank-acc"
                  className="field font-mono"
                  value={form.bankAccountNumber}
                  onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })}
                  placeholder="7123456789"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="brand-bank-holder" className="label text-xs font-semibold">
                  Atas Nama Rekening
                </label>
                <input
                  id="brand-bank-holder"
                  className="field"
                  value={form.bankAccountHolder}
                  onChange={(e) => setForm({ ...form, bankAccountHolder: e.target.value })}
                  placeholder="PT Azhan Wisata Mandiri"
                />
              </div>
            </div>
          </div>

          {/* 4. Alamat Kantor & Lokasi Google Maps */}
          <div className="border-t border-zinc-100 pt-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
              <MapPin size={17} className="text-zinc-600" />
              <div>
                <h3 className="font-display text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                  Alamat Kantor & Lokasi Google Maps
                </h3>
                <p className="text-[11px] text-zinc-400">Alamat operasional biro dan tautan peta lokasi.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="brand-address" className="label text-xs font-semibold">
                  Alamat Kantor
                </label>
                <textarea
                  id="brand-address"
                  rows={3}
                  className="w-full rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-900 outline-none transition focus:border-black focus:ring-1 focus:ring-black placeholder:text-zinc-400 shadow-xs"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Jl. Sudirman No. 123, Lantai 4, Jakarta..."
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="brand-gmaps" className="label text-xs font-semibold">
                    Tautan Google Maps
                  </label>
                  {form.gmapsUrl && form.gmapsUrl.startsWith('http') && (
                    <a
                      href={form.gmapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      <ExternalLink size={12} /> Buka Peta ↗
                    </a>
                  )}
                </div>
                <div className="relative">
                  <MapPin size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                  <input
                    id="brand-gmaps"
                    className="field pl-9"
                    value={form.gmapsUrl}
                    onChange={(e) => setForm({ ...form, gmapsUrl: e.target.value })}
                    placeholder="https://maps.app.goo.gl/..."
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-zinc-200/80 pt-6">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate(backUrl)}
                disabled={saveMutation.isPending || deleteMutation.isPending}
              >
                Batal
              </Button>
              {canDelete && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setConfirmDeleteOpen(true)}
                  disabled={saveMutation.isPending || deleteMutation.isPending}
                  className="bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 border border-rose-200 gap-1.5"
                >
                  <Trash2 size={14} />
                  Hapus Brand
                </Button>
              )}
            </div>

            <Button
              type="submit"
              disabled={saveMutation.isPending || deleteMutation.isPending}
              className="w-full sm:w-auto gap-2"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Menyimpan…
                </>
              ) : (
                <>
                  <Save size={15} />
                  {isEditing ? 'Simpan Perubahan' : 'Buat Brand Baru'}
                </>
              )}
            </Button>
          </div>
        </Card>
      </form>

      {/* Confirmation Dialog Hapus Brand via Radix */}
      <Dialog.Root open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
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
              Tindakan ini tidak dapat dibatalkan. Menghapus brand{' '}
              <strong>{currentBrand?.name}</strong> ({currentBrand?.code}) akan otomatis menghapus data prospek, paket umroh, dan sesi WhatsApp biro ini.
            </Dialog.Description>

            {deleteMutation.isError && (
              <p className="mt-3 text-xs text-rose-600">
                {(deleteMutation.error as Error)?.message || 'Gagal menghapus brand.'}
              </p>
            )}

            <div className="mt-6 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deleteMutation.isPending}
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
                Ya, Hapus Brand
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

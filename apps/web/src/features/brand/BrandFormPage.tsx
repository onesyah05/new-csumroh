import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Camera,
  CreditCard,
  ExternalLink,
  FileText,
  ImagePlus,
  Loader2,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { resolveMediaUrl } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/modal';
import { showFeedback } from '../../app/toast';

interface BrandFormData {
  name: string;
  code: string;
  logoUrl: string;
  ppiuNumber: string;
  phone: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  address: string;
  gmapsUrl: string;
}

interface UploadResponse {
  url: string;
  originalSize: number;
  compressedSize: number;
  filename: string;
}

export function BrandFormPage() {
  const { brandId } = useParams<{ brandId: string }>();
  const isEditing = Boolean(brandId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadInfo, setUploadInfo] = useState<{ original: number; compressed: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const backUrl = isEditing ? `/brands/${brandId}` : '/brands';

  const [form, setForm] = useState<BrandFormData>({
    name: '',
    code: '',
    logoUrl: '',
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
        logoUrl: currentBrand.logoUrl ?? '',
        ppiuNumber: currentBrand.ppiuNumber ?? '',
        phone: currentBrand.phone ?? '',
        bankName: currentBrand.bankName ?? '',
        bankAccountNumber: currentBrand.bankAccountNumber ?? '',
        bankAccountHolder: currentBrand.bankAccountHolder ?? '',
        address: currentBrand.address ?? '',
        gmapsUrl: currentBrand.gmapsUrl ?? '',
      });
      if (currentBrand.logoUrl) {
        setLogoPreview(resolveMediaUrl(currentBrand.logoUrl));
      }
    }
  }, [isEditing, currentBrand]);

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      return new Promise<UploadResponse>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const result = await api.post<UploadResponse>('/catalog/brands/upload-logo', {
              image: reader.result as string,
            });
            resolve(result);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error('Gagal membaca file.'));
        reader.readAsDataURL(file);
      });
    },
    onSuccess: (data) => {
      setForm((prev) => ({ ...prev, logoUrl: data.url }));
      setLogoPreview(resolveMediaUrl(data.url));
      setUploadInfo({ original: data.originalSize, compressed: data.compressedSize });
      showFeedback('Logo berhasil diupload dan dikompresi ke WebP.');
    },
    onError: (err: Error) => {
      showFeedback(err.message || 'Gagal mengupload logo.');
    },
  });

  function handleFileSelect(file: File) {
    if (!file.type.startsWith('image/')) {
      showFeedback('File harus berupa gambar (JPG, PNG, atau WebP).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showFeedback('Ukuran file maksimal 10 MB.');
      return;
    }
    uploadLogoMutation.mutate(file);
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }

  function removeLogo() {
    setForm((prev) => ({ ...prev, logoUrl: '' }));
    setLogoPreview(null);
    setUploadInfo(null);
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        logoUrl: form.logoUrl.trim() || null,
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
                <h3 className="font-display text-xs font-extrabold text-zinc-700">
                  Identitas Brand
                </h3>
                <p className="text-xs text-zinc-500">Nama resmi biro dan kode identifikasi sistem.</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-5 items-start">
              {/* Logo Upload / Avatar Preview */}
              <div className="flex flex-col items-center gap-2 shrink-0 self-center sm:self-start">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileInputChange}
                />
                <div
                  className={`relative group cursor-pointer ${isDragging ? 'ring-2 ring-emerald-500 ring-offset-2' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadLogoMutation.isPending ? (
                    <span className="grid h-20 w-20 place-items-center rounded-xl bg-zinc-100 border-2 border-dashed border-zinc-300 shadow-xs">
                      <Loader2 size={20} className="animate-spin text-zinc-400" />
                    </span>
                  ) : logoPreview ? (
                    <div className="relative">
                      <img
                        src={logoPreview}
                        alt="Logo brand"
                        className="h-20 w-20 rounded-xl object-cover border border-zinc-200 shadow-xs"
                      />
                      <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <Camera size={18} className="text-white" />
                      </div>
                    </div>
                  ) : (
                    <span className="grid h-20 w-20 place-items-center rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100 transition-all shadow-xs group">
                      <div className="flex flex-col items-center gap-0.5">
                        <ImagePlus size={20} className="text-zinc-400 group-hover:text-zinc-600 transition" />
                        <span className="text-xs text-zinc-400 group-hover:text-zinc-600 font-medium transition">Logo</span>
                      </div>
                    </span>
                  )}
                </div>

                {logoPreview && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeLogo(); }}
                    className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-800 font-medium cursor-pointer transition"
                  >
                    <X size={11} />
                    Hapus
                  </button>
                )}

                {!logoPreview && !uploadLogoMutation.isPending && (
                  <span className="text-xs text-zinc-400 text-center leading-tight">
                    JPG, PNG, WebP
                    <br />
                    Maks. 10 MB
                  </span>
                )}

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
                <h3 className="font-display text-xs font-extrabold text-zinc-700">
                  Legalitas & Kontak Resmi
                </h3>
                <p className="text-xs text-zinc-500">Izin Kemenag dan kontak layanan jamaah.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="brand-ppiu" className="label text-xs font-semibold">
                  Nomor Izin PPIU (Kemenag)
                </label>
                <div className="relative">
                  <FileText size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
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
                  <Phone size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
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
                <h3 className="font-display text-xs font-extrabold text-zinc-700">
                  Rekening Resmi Bank
                </h3>
                <p className="text-xs text-zinc-500">Rekening tujuan pembayaran awal jamaah (DP atau lunas).</p>
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
                  placeholder="PT Nama Legal Perusahaan"
                />
              </div>
            </div>
          </div>

          {/* 4. Alamat Kantor & Lokasi Google Maps */}
          <div className="border-t border-zinc-100 pt-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
              <MapPin size={17} className="text-zinc-600" />
              <div>
                <h3 className="font-display text-xs font-extrabold text-zinc-700">
                  Alamat Kantor & Lokasi Google Maps
                </h3>
                <p className="text-xs text-zinc-500">Alamat kantor biro dan tautan peta lokasi.</p>
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
                  className="w-full rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-900 outline-none transition focus:border-black focus:ring-1 focus:ring-black placeholder:text-zinc-500 shadow-xs"
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
                      className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-800 hover:underline"
                    >
                      <ExternalLink size={12} /> Buka Peta ↗
                    </a>
                  )}
                </div>
                <div className="relative">
                  <MapPin size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
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

      <ConfirmDialog
        open={Boolean(confirmDeleteOpen)}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        pending={deleteMutation.isPending}
        error={deleteMutation.isError ? (deleteMutation.error as Error)?.message || 'Gagal menghapus brand.' : null}
        // API menolak menghapus brand yang masih punya prospek atau paket: jangan janjikan "hapus semua data".
        confirmDisabled={(((currentBrand as any)?._count?.prospects ?? 0) + ((currentBrand as any)?._count?.packages ?? 0)) > 0}
        title="Hapus Brand Travel?"
        description={<>Brand <strong>{(currentBrand as any)?.name}</strong> ({(currentBrand as any)?.code}) akan dihapus beserta sesi WhatsApp-nya. Tindakan ini tidak dapat dibatalkan.</>}
        confirmLabel="Hapus Brand"
      >
        {(((currentBrand as any)?._count?.prospects ?? 0) + ((currentBrand as any)?._count?.packages ?? 0)) > 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
            Brand ini masih punya <strong>{(currentBrand as any)?._count?.prospects ?? 0}</strong> prospek dan <strong>{(currentBrand as any)?._count?.packages ?? 0}</strong> paket,
            sehingga tidak dapat dihapus. Arsipkan paketnya atau hubungi tim holding.
          </p>
        ) : undefined}
      </ConfirmDialog>
    </div>
  );
}

import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  PackageOpen,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  UploadCloud,
  X,
} from 'lucide-react';
import { api, resolveMediaUrl } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { useUiStore } from '../../app/store';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { Select } from '../../components/ui/select';
import { PageHeader } from '../../components/ui/page-header';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { StatusBadge } from '../../components/ui/status-badge';
import type { PackageItem } from './PackageDetailPage';

function toRupiah(val: string | number): string {
  const digits = String(val).replace(/\D/g, '');
  if (!digits) return '';
  return 'Rp ' + Number(digits).toLocaleString('id-ID');
}

function RupiahInput({
  value,
  onChange,
  placeholder,
  className,
  required,
  id,
}: {
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  id?: string;
}) {
  const [display, setDisplay] = useState(value ?? '');
  const skipRef = useRef(false);

  useEffect(() => {
    if (!skipRef.current) setDisplay(value ?? '');
    skipRef.current = false;
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const formatted = toRupiah(raw);
    skipRef.current = true;
    setDisplay(formatted);
    onChange(formatted);
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      className={className}
      value={display}
      onChange={handleChange}
      placeholder={placeholder}
      required={required}
    />
  );
}

const DEFAULT_INCLUDED = `Tiket Pesawat PP Internasional
Visa Umroh & Asuransi Perjalanan
Hotel Makkah & Madinah Sesuai Paket
Makan 3x Sehari (Fullboard Menu Indonesia)
Bus AC Eksekutif Selama di Arab Saudi
Muthawwif & Pembimbing Berpengalaman
Air Zamzam & Perlengkapan Umroh Lengkap
Handling Bandara Jakarta & Saudi PP`;

const DEFAULT_EXCLUDED = `Paspor & Buku Vaksin Meningitis
Pengeluaran Pribadi (Laundry, Telp, Room Service)
Kelebihan Bagasi Pesawat
Tiket Domestik Menuju Jakarta (Jika Dari Luar Daerah)`;

const DEFAULT_ITINERARY = `Hari 1: Kumpul di Bandara Soekarno-Hatta (CGK), penerbangan menuju Arab Saudi.
Hari 2: Tiba di Madinah, check-in hotel dan ibadah di Masjid Nabawi.
Hari 3: Ziarah Kota Madinah (Masjid Quba, Jabal Uhud, Kebun Kurma, Masjid Qiblatain).
Hari 4: Ziarah Raudhah & Makam Rasulullah SAW, manasik persiapan umroh.
Hari 5: Miqat di Bir Ali, menuju Makkah, check-in hotel dan pelaksanaan Umroh Pertama.
Hari 6: Ibadah mandiri dan memperbanyak thawaf sunnah di Masjidil Haram.
Hari 7: Ziarah Kota Makkah (Jabal Tsur, Padang Arafah, Muzdalifah, Mina, Miqat Ji'ranah).
Hari 8: Thawaf Wada' dan persiapan bertolak menuju Bandara Jeddah.
Hari 9: Penerbangan kepulangan ke Tanah Air dan tiba di Bandara Soekarno-Hatta.`;

// ── WebP Autocompression helper ────────────────────────────────────────────────
async function compressImageToWebp(file: File): Promise<{
  dataUrl: string;
  originalSize: number;
  compressedSize: number;
  savingsPercent: number;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('File gambar tidak valid.'));
      img.onload = () => {
        const maxW = 1200;
        const maxH = 1600;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > maxW || height > maxH) {
          const ratio = Math.min(maxW / width, maxH / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas tidak didukung oleh peramban.'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/webp', 0.82);
        const base64Length = dataUrl.length - (dataUrl.indexOf(',') + 1);
        const compressedSize = Math.round((base64Length * 3) / 4);
        const originalSize = file.size;
        const savingsPercent = Math.max(0, Math.round(((originalSize - compressedSize) / originalSize) * 100));

        resolve({ dataUrl, originalSize, compressedSize, savingsPercent });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PackageFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeBrandId } = useUiStore();
  const isSuperadmin = user?.role === 'superadmin';

  // Flyer upload state & ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFlyer, setUploadingFlyer] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Brands list (for superadmin selection)
  const brandsQuery = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<Array<{ id: number; name: string; code: string }>>('/catalog/brands'),
    enabled: isSuperadmin,
  });
  const brands = brandsQuery.data || [];

  // Form State
  const [form, setForm] = useState({
    brandId: '',
    name: '',
    price: 'Rp 29.500.000',
    dp: 'Rp 5.000.000',
    priceQuad: 'Rp 29.500.000',
    priceTriple: 'Rp 31.500.000',
    priceDouble: 'Rp 33.500.000',
    priceInfant: 'Rp 10.000.000',
    quotaRemaining: '45',
    departureDate: '',
    duration: '9',
    airline: 'Saudia Airlines',
    flightType: 'direct',
    hotelMakkah: 'Pullman Zamzam / Setaraf',
    hotelMadinah: 'Rove Al Madinah / Setaraf',
    facilitiesIncluded: DEFAULT_INCLUDED,
    facilitiesExcluded: DEFAULT_EXCLUDED,
    itinerary: DEFAULT_ITINERARY,
    flyerImage: '',
    isPromo: false,
    promoDiscount: 'Rp 1.000.000',
    promoDeadline: '',
    isActive: true,
  });

  const [errorMessage, setErrorMessage] = useState('');

  // Package query if in edit mode
  const packageQuery = useQuery({
    queryKey: ['package', id],
    queryFn: () => api.get<PackageItem>(`/catalog/packages/${id}`),
    enabled: isEdit,
  });

  // Pre-fill form if editing
  useEffect(() => {
    if (isEdit && packageQuery.data) {
      const p = packageQuery.data;
      setForm({
        brandId: String(p.brandId || ''),
        name: p.name || '',
        price: p.price || '',
        dp: p.dp || 'Rp 5.000.000',
        priceQuad: p.priceQuad || p.price || '',
        priceTriple: p.priceTriple || '',
        priceDouble: p.priceDouble || '',
        priceInfant: p.priceInfant || '',
        quotaRemaining: p.quotaRemaining !== null && p.quotaRemaining !== undefined ? String(p.quotaRemaining) : '45',
        departureDate: p.departureDate ? p.departureDate.slice(0, 10) : '',
        duration: p.duration ? String(p.duration).replace(/\D/g, '') || '9' : '9',
        airline: p.airline || '',
        flightType: p.flightType || 'direct',
        hotelMakkah: p.hotelMakkah || '',
        hotelMadinah: p.hotelMadinah || '',
        facilitiesIncluded: p.facilitiesIncluded || DEFAULT_INCLUDED,
        facilitiesExcluded: p.facilitiesExcluded || DEFAULT_EXCLUDED,
        itinerary: p.itinerary || DEFAULT_ITINERARY,
        flyerImage: p.flyerImage || '',
        isPromo: Boolean(p.isPromo),
        promoDiscount: p.promoDiscount || '',
        promoDeadline: p.promoDeadline ? p.promoDeadline.slice(0, 10) : '',
        isActive: p.isActive ?? true,
      });
    } else if (!isEdit) {
      const defaultBrand = activeBrandId ? String(activeBrandId) : (brands[0]?.id ? String(brands[0].id) : '');
      setForm((prev) => ({
        ...prev,
        brandId: isSuperadmin ? defaultBrand : String(user?.brandId ?? ''),
      }));
    }
  }, [isEdit, packageQuery.data, isSuperadmin, activeBrandId, brands, user?.brandId]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage('');
      if (uploadingFlyer) throw new Error('Harap tunggu hingga proses upload flyer selesai.');
      if (!form.name.trim()) throw new Error('Nama paket wajib diisi.');
      if (!form.duration.trim() || Number(form.duration) <= 0) throw new Error('Durasi perjalanan wajib diisi angka.');
      if (!form.priceQuad.trim()) throw new Error('Harga kamar Quad wajib diisi.');
      if (!form.dp.trim()) throw new Error('Minimal DP wajib diisi.');

      const payload = {
        name: form.name.trim(),
        price: form.priceQuad.trim(),
        dp: form.dp.trim(),
        priceQuad: form.priceQuad.trim(),
        priceTriple: form.priceTriple.trim() || null,
        priceDouble: form.priceDouble.trim() || null,
        priceInfant: form.priceInfant.trim() || null,
        quotaRemaining: form.quotaRemaining !== '' ? Number(form.quotaRemaining) : 0,
        departureDate: form.departureDate || null,
        duration: form.duration ? `${form.duration} Hari` : '9 Hari',
        airline: form.airline.trim() || null,
        flightType: form.flightType || 'direct',
        hotelMakkah: form.hotelMakkah.trim() || null,
        hotelMadinah: form.hotelMadinah.trim() || null,
        facilitiesIncluded: form.facilitiesIncluded.trim() || null,
        facilitiesExcluded: form.facilitiesExcluded.trim() || null,
        itinerary: form.itinerary.trim() || null,
        flyerImage: form.flyerImage.trim() || null,
        isPromo: Boolean(form.isPromo),
        promoDiscount: form.isPromo ? form.promoDiscount.trim() || null : null,
        promoDeadline: form.isPromo && form.promoDeadline ? form.promoDeadline : null,
        isActive: Boolean(form.isActive),
        ...(isSuperadmin && form.brandId ? { brandId: Number(form.brandId) } : {}),
      };

      if (isEdit && id) {
        return api.patch<PackageItem>(`/catalog/packages/${id}`, payload);
      }
      return api.post<PackageItem>('/catalog/packages', payload);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['packages'] });
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      if (saved?.id) {
        void queryClient.invalidateQueries({ queryKey: ['package', String(saved.id)] });
        navigate(`/packages/${saved.id}`, { replace: true });
      } else {
        navigate('/packages', { replace: true });
      }
    },
    onError: (err: any) => {
      setErrorMessage(err?.message || 'Gagal menyimpan paket.');
    },
  });

  const handleFileSelect = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Hanya file gambar (JPG, PNG, WEBP) yang dapat diunggah.');
      return;
    }

    try {
      const localUrl = URL.createObjectURL(file);
      setPreviewUrl(localUrl);
      setUploadingFlyer(true);
      setUploadError(null);

      const { dataUrl } = await compressImageToWebp(file);

      const res = await api.post<{ url: string; size?: number; filename?: string }>('/catalog/packages/upload-flyer', {
        image: dataUrl,
      });

      const uploadedUrl = (res as any)?.url || (res as any)?.data?.url;

      if (uploadedUrl) {
        setForm((prev) => ({ ...prev, flyerImage: uploadedUrl }));
        setPreviewUrl(uploadedUrl);
      } else {
        throw new Error('Respon upload server tidak menyertakan tautan gambar.');
      }
    } catch (err: any) {
      setPreviewUrl(form.flyerImage || null);
      setUploadError(err?.message || 'Gagal mengunggah gambar flyer.');
    } finally {
      setUploadingFlyer(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  if (isEdit && packageQuery.isLoading) return <PageLoading label="Memuat data paket umroh…" />;
  if (isEdit && (packageQuery.isError || !packageQuery.data)) {
    return (
      <PageError
        title="Paket tidak ditemukan"
        description="Data paket yang akan disunting tidak ditemukan."
        onRetry={() => void packageQuery.refetch()}
      />
    );
  }

  const backUrl = isEdit && id ? `/packages/${id}` : '/packages';

  return (
    <div className="app-page space-y-5 pb-16">
      <PageHeader
        backUrl={backUrl}
        title={isEdit ? 'Sunting Paket Umroh' : 'Tambah Paket Umroh'}
        subtitle={
          isEdit
            ? 'Perbarui jadwal keberangkatan, akomodasi hotel, dan skema harga kamar.'
            : 'Buat program perjalanan umroh baru dengan kuota seat dan skema harga kamar.'
        }
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(backUrl)}
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSubmit}
              loading={saveMutation.isPending}
            >
              Simpan Paket
            </Button>
          </>
        }
      />

      {/* Global Error Banner */}
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          {errorMessage}
        </div>
      )}

      {/* Form Content: 2-Column Responsive Layout */}
      <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-12 items-start">
        {/* Main Column (8 cols) — Hanya 2 Card Proporsional */}
        <div className="space-y-5 lg:col-span-8">
          {/* Card 1: Informasi Dasar, Harga & Akomodasi */}
          <Card className="p-5 space-y-5">
            {/* Bagian 1: Informasi Dasar */}
            <div className="space-y-3.5">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                Informasi Dasar & Jadwal
              </h3>

              <div>
                <label className="text-xs font-semibold text-zinc-700 block mb-1">
                  Nama Paket <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Umroh Reguler Syawal 1447H"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs focus:border-zinc-950 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {isSuperadmin && (
                  <div>
                    <label className="text-xs font-semibold text-zinc-700 block mb-1">
                      Brand Travel <span className="text-rose-500">*</span>
                    </label>
                    <Select
                      value={form.brandId}
                      onValueChange={(val) => setForm((prev) => ({ ...prev, brandId: val }))}
                      options={brands.map((b) => ({ value: String(b.id), label: b.name }))}
                      placeholder="Pilih Brand Travel"
                      className="h-9 w-full text-xs rounded-lg border-zinc-200"
                    />
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">
                    Tanggal Keberangkatan
                  </label>
                  <input
                    type="date"
                    value={form.departureDate}
                    onChange={(e) => setForm({ ...form, departureDate: e.target.value })}
                    className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-xs focus:border-zinc-950 focus:outline-none bg-white"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">
                    Durasi (Hari) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      required
                      value={form.duration}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setForm((prev) => ({ ...prev, duration: val }));
                      }}
                      placeholder="9"
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs font-mono font-medium focus:border-zinc-950 focus:outline-none pr-12"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 pointer-events-none select-none font-sans">
                      Hari
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">
                    Sisa Kuota Seat
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.quotaRemaining}
                    onChange={(e) => setForm({ ...form, quotaRemaining: e.target.value })}
                    placeholder="45"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs focus:border-zinc-950 focus:outline-none font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Bagian 2: Skema Harga Kamar & DP */}
            <div className="border-t border-zinc-100 pt-5 space-y-3.5">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                Skema Harga Kamar & DP
              </h3>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">
                    Quad (Ber-4) <span className="text-rose-500">*</span>
                  </label>
                  <RupiahInput
                    required
                    value={form.priceQuad}
                    onChange={(val) => setForm({ ...form, priceQuad: val, price: val })}
                    placeholder="Rp 29.500.000"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs font-mono font-medium focus:border-zinc-950 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">
                    Triple (Ber-3)
                  </label>
                  <RupiahInput
                    value={form.priceTriple}
                    onChange={(val) => setForm({ ...form, priceTriple: val })}
                    placeholder="Rp 31.500.000"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs font-mono font-medium focus:border-zinc-950 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">
                    Double (Ber-2)
                  </label>
                  <RupiahInput
                    value={form.priceDouble}
                    onChange={(val) => setForm({ ...form, priceDouble: val })}
                    placeholder="Rp 33.500.000"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs font-mono font-medium focus:border-zinc-950 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">
                    Infant (&lt; 2 Thn)
                  </label>
                  <RupiahInput
                    value={form.priceInfant}
                    onChange={(val) => setForm({ ...form, priceInfant: val })}
                    placeholder="Rp 10.000.000"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs font-mono font-medium focus:border-zinc-950 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-700 block mb-1">
                  Minimal Transfer DP (Uang Muka) <span className="text-rose-500">*</span>
                </label>
                <RupiahInput
                  required
                  value={form.dp}
                  onChange={(val) => setForm({ ...form, dp: val })}
                  placeholder="Rp 5.000.000"
                  className="w-full sm:w-1/2 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-mono font-medium focus:border-zinc-950 focus:outline-none"
                />
              </div>
            </div>

            {/* Bagian 3: Penerbangan & Hotel */}
            <div className="border-t border-zinc-100 pt-5 space-y-3.5">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                Penerbangan & Hotel
              </h3>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">
                    Maskapai Penerbangan
                  </label>
                  <input
                    type="text"
                    value={form.airline}
                    onChange={(e) => setForm({ ...form, airline: e.target.value })}
                    placeholder="Contoh: Saudia Airlines"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs focus:border-zinc-950 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">
                    Rute Penerbangan
                  </label>
                  <Select
                    value={form.flightType}
                    onValueChange={(val) => setForm((prev) => ({ ...prev, flightType: val }))}
                    options={[
                      { value: 'direct', label: 'Direct (Langsung)' },
                      { value: 'transit', label: 'Transit' },
                    ]}
                    placeholder="Pilih Rute"
                    className="h-9 w-full text-xs rounded-lg border-zinc-200"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">
                    Hotel Makkah
                  </label>
                  <input
                    type="text"
                    value={form.hotelMakkah}
                    onChange={(e) => setForm({ ...form, hotelMakkah: e.target.value })}
                    placeholder="Contoh: Pullman Zamzam / Setaraf"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs focus:border-zinc-950 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1">
                    Hotel Madinah
                  </label>
                  <input
                    type="text"
                    value={form.hotelMadinah}
                    onChange={(e) => setForm({ ...form, hotelMadinah: e.target.value })}
                    placeholder="Contoh: Rove Al Madinah / Setaraf"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs focus:border-zinc-950 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Card 2: Fasilitas & Itinerary */}
          <Card className="p-5 space-y-5">
            {/* Bagian 1: Fasilitas */}
            <div className="space-y-3.5">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                Fasilitas Paket
              </h3>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-emerald-800 block mb-1">
                    Termasuk (Include)
                  </label>
                  <textarea
                    rows={7}
                    value={form.facilitiesIncluded}
                    onChange={(e) => setForm({ ...form, facilitiesIncluded: e.target.value })}
                    placeholder="Satu fasilitas per baris"
                    className="w-full rounded-lg border border-zinc-200 p-2.5 text-xs leading-relaxed focus:border-zinc-950 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">
                    Tidak Termasuk (Exclude)
                  </label>
                  <textarea
                    rows={7}
                    value={form.facilitiesExcluded}
                    onChange={(e) => setForm({ ...form, facilitiesExcluded: e.target.value })}
                    placeholder="Satu fasilitas per baris"
                    className="w-full rounded-lg border border-zinc-200 p-2.5 text-xs leading-relaxed focus:border-zinc-950 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Bagian 2: Itinerary */}
            <div className="border-t border-zinc-100 pt-5 space-y-3.5">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                Itinerary Perjalanan
              </h3>
              <textarea
                rows={7}
                value={form.itinerary}
                onChange={(e) => setForm({ ...form, itinerary: e.target.value })}
                placeholder="Rundown harian agenda perjalanan..."
                className="w-full rounded-lg border border-zinc-200 p-2.5 text-xs leading-relaxed focus:border-zinc-950 focus:outline-none"
              />
            </div>
          </Card>
        </div>

        {/* Kolom Sidebar (4 cols) */}
        <div className="space-y-5 lg:col-span-4">
          {/* Card 1: Poster Flyer (Direct Upload & WebP Autocompress) */}
          <Card className="p-4 space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700 pb-2 border-b border-zinc-100">
              Poster Flyer
            </h3>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/jpg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  void handleFileSelect(f);
                  e.target.value = '';
                }
              }}
            />

            {previewUrl || form.flyerImage ? (
              <div className="space-y-3">
                <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 aspect-3/4">
                  <img
                    key={previewUrl || form.flyerImage}
                    src={resolveMediaUrl(previewUrl || form.flyerImage)}
                    alt="Preview Flyer"
                    className="h-full w-full object-cover"
                  />
                  {uploadingFlyer && (
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex flex-col items-center justify-center text-white p-3 text-center">
                      <Loader2 size={24} className="animate-spin mb-1.5 text-white" />
                      <span className="text-xs font-semibold">Mengunggah…</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    icon={<UploadCloud size={13} />}
                    className="w-full"
                  >
                    Ganti
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPreviewUrl(null);
                      setForm((prev) => ({ ...prev, flyerImage: '' }));
                    }}
                    icon={<X size={13} />}
                    className="w-full text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                  >
                    Hapus
                  </Button>
                </div>
              </div>
            ) : uploadingFlyer ? (
              <div className="grid aspect-3/4 place-items-center rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-center">
                <div className="space-y-2">
                  <Loader2 size={24} className="mx-auto animate-spin text-zinc-800" />
                  <p className="text-xs font-semibold text-zinc-800">Mengunggah gambar…</p>
                </div>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                aria-label="Unggah flyer paket"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleFileSelect(f);
                }}
                className={`grid aspect-3/4 place-items-center rounded-xl border-2 border-dashed p-4 text-center transition cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 ${
                  isDragging
                    ? 'border-zinc-950 bg-zinc-100'
                    : 'border-zinc-200 bg-zinc-50/60 hover:border-zinc-950 hover:bg-zinc-50'
                }`}
              >
                <div className="space-y-1.5">
                  <UploadCloud size={24} className="mx-auto text-zinc-500" />
                  <p className="text-xs font-semibold text-zinc-800">Upload Poster Flyer</p>
                  <p className="text-xs text-zinc-500">Klik atau seret gambar ke sini</p>
                </div>
              </div>
            )}

            {uploadError && (
              <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2">
                {uploadError}
              </p>
            )}
          </Card>

          {/* Card 2: Pengaturan Publikasi & Promo */}
          <Card className="p-4 space-y-3.5">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700 pb-2 border-b border-zinc-100">
              Pengaturan
            </h3>

            {/* Status Publikasi */}
            <div className="space-y-2">
              <label className="flex items-center justify-between cursor-pointer select-none">
                <span className="text-xs font-semibold text-zinc-800">Status Publikasi</span>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950 accent-zinc-950 cursor-pointer"
                />
              </label>
              <div className="flex items-center gap-1.5">
                <StatusBadge
                  status={form.isActive ? 'active' : 'archived'}
                  label={form.isActive ? 'Aktif di Katalog' : 'Arsip'}
                  dot
                />
              </div>
            </div>

            {/* Program Promo */}
            <div className="border-t border-zinc-100 pt-3 space-y-2.5">
              <label className="flex items-center justify-between cursor-pointer select-none">
                <span className="text-xs font-semibold text-zinc-800">Program Promo</span>
                <input
                  type="checkbox"
                  checked={form.isPromo}
                  onChange={(e) => setForm({ ...form, isPromo: e.target.checked })}
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950 accent-zinc-950 cursor-pointer"
                />
              </label>

              {form.isPromo && (
                <div className="space-y-2 pt-1">
                  <div>
                    <label className="text-xs font-semibold text-zinc-600 block mb-1">
                      Potongan Harga Promo
                    </label>
                    <input
                      type="text"
                      value={form.promoDiscount}
                      onChange={(e) => setForm({ ...form, promoDiscount: e.target.value })}
                      placeholder="Contoh: Rp 1.000.000"
                      className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs focus:border-zinc-950 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-zinc-600 block mb-1">
                      Batas Waktu Promo
                    </label>
                    <input
                      type="date"
                      value={form.promoDeadline}
                      onChange={(e) => setForm({ ...form, promoDeadline: e.target.value })}
                      className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs focus:border-zinc-950 focus:outline-none bg-white"
                    />
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Card 3: Tombol Aksi */}
          <Card className="p-4 space-y-2">
            <Button
              type="submit"
              variant="primary"
              loading={saveMutation.isPending || uploadingFlyer}
              disabled={uploadingFlyer}
              className="w-full"
            >
              {uploadingFlyer ? 'Mengunggah Flyer…' : 'Simpan Paket'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(backUrl)}
              className="w-full"
            >
              Batal
            </Button>
          </Card>
        </div>
      </form>
    </div>
  );
}

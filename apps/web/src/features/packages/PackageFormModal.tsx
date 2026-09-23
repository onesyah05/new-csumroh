import { useEffect, useRef, useState } from 'react';

// ── Rupiah helpers ────────────────────────────────────────────────────────────
function toRupiah(raw: string): string {
  const digits = raw.replace(/\D/g, '');
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

  // sync external value → display (e.g. on form reset)
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
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Check,
  Hotel,
  ImageIcon,
  Luggage,
  Plane,
  Save,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react';
import { api, resolveMediaUrl } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PackageItem } from './PackageDetailModal';

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

const DEFAULT_ITINERARY = `Hari 1: Kumpul di Bandara Soekarno-Hatta (CGK), proses check-in dan penerbangan menuju Arab Saudi.
Hari 2: Tiba di Madinah, check-in hotel, istirahat dan ibadah di Masjid Nabawi.
Hari 3: Ziarah Kota Madinah (Masjid Quba, Jabal Uhud, Kebun Kurma, Masjid Qiblatain).
Hari 4: Ziarah Raudhah & Makam Rasulullah SAW, kajian manasik persiapan umroh.
Hari 5: Mengambil Miqat di Bir Ali, perjalanan menuju Makkah dengan Kereta Cepat/Bus, check-in hotel dan pelaksanaan Umroh Pertama.
Hari 6: Istirahat dan memperbanyak ibadah thawaf sunnah di Masjidil Haram.
Hari 7: Ziarah Kota Makkah (Jabal Tsur, Padang Arafah, Muzdalifah, Mina, Jabal Rahmah, Miqat Ji'ranah untuk Umroh Kedua).
Hari 8: Thawaf Wada' (perpisahan) dan persiapan bertolak menuju Bandara Jeddah.
Hari 9: Penerbangan kepulangan ke Tanah Air dan tiba di Bandara Soekarno-Hatta dengan selamat.`;

interface PackageFormModalProps {
  pkg: PackageItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId?: number | null;
  brands?: Array<{ id: number; name: string }>;
  isSuperadmin?: boolean;
}

export function PackageFormModal({
  pkg,
  open,
  onOpenChange,
  brandId,
  brands = [],
  isSuperadmin = false,
}: PackageFormModalProps) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(pkg?.id);

  const [activeTab, setActiveTab] = useState<'info' | 'pricing' | 'content' | 'promo'>('info');
  const [form, setForm] = useState<Record<string, any>>({});
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (pkg) {
      setForm({
        brandId: pkg.brandId || brandId || '',
        name: pkg.name || '',
        price: pkg.price || '',
        dp: pkg.dp || 'Rp 5.000.000',
        priceQuad: pkg.priceQuad || pkg.price || '',
        priceTriple: pkg.priceTriple || '',
        priceDouble: pkg.priceDouble || '',
        priceInfant: pkg.priceInfant || '',
        quotaRemaining: pkg.quotaRemaining !== null && pkg.quotaRemaining !== undefined ? String(pkg.quotaRemaining) : '45',
        departureDate: pkg.departureDate ? pkg.departureDate.slice(0, 10) : '',
        duration: pkg.duration || '9 Hari',
        airline: pkg.airline || '',
        flightType: pkg.flightType || 'direct',
        hotelMakkah: pkg.hotelMakkah || '',
        hotelMadinah: pkg.hotelMadinah || '',
        facilitiesIncluded: pkg.facilitiesIncluded || DEFAULT_INCLUDED,
        facilitiesExcluded: pkg.facilitiesExcluded || DEFAULT_EXCLUDED,
        itinerary: pkg.itinerary || DEFAULT_ITINERARY,
        flyerImage: pkg.flyerImage || '',
        isPromo: Boolean(pkg.isPromo),
        promoDiscount: pkg.promoDiscount || '',
        promoDeadline: pkg.promoDeadline ? pkg.promoDeadline.slice(0, 10) : '',
        isActive: pkg.isActive ?? true,
      });
    } else {
      setForm({
        brandId: brandId || (brands[0]?.id ? String(brands[0].id) : ''),
        name: '',
        price: 'Rp 29.500.000',
        dp: 'Rp 5.000.000',
        priceQuad: 'Rp 29.500.000',
        priceTriple: 'Rp 31.500.000',
        priceDouble: 'Rp 33.500.000',
        priceInfant: 'Rp 10.000.000',
        quotaRemaining: '45',
        departureDate: '',
        duration: '9 Hari',
        airline: 'Saudia Airlines',
        flightType: 'direct',
        hotelMakkah: 'Pullman Zamzam / Setaraf (Bintang 5)',
        hotelMadinah: 'Rove Al Madinah / Setaraf (Bintang 5)',
        facilitiesIncluded: DEFAULT_INCLUDED,
        facilitiesExcluded: DEFAULT_EXCLUDED,
        itinerary: DEFAULT_ITINERARY,
        flyerImage: '',
        isPromo: false,
        promoDiscount: 'Rp 1.000.000',
        promoDeadline: '',
        isActive: true,
      });
    }
    setActiveTab('info');
    setErrorMsg('');
  }, [pkg, open, brandId, brands]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg('');
      if (!form.name?.trim()) throw new Error('Nama paket umroh wajib diisi.');
      if (!form.price?.trim()) throw new Error('Harga acuan (Quad) wajib diisi.');
      if (!form.dp?.trim()) throw new Error('Minimal DP wajib diisi.');

      const payload = {
        name: form.name.trim(),
        price: form.price.trim(),
        dp: form.dp.trim(),
        priceQuad: form.priceQuad?.trim() || form.price.trim(),
        priceTriple: form.priceTriple?.trim() || null,
        priceDouble: form.priceDouble?.trim() || null,
        priceInfant: form.priceInfant?.trim() || null,
        quotaRemaining: form.quotaRemaining !== '' ? Number(form.quotaRemaining) : 0,
        departureDate: form.departureDate || null,
        duration: form.duration?.trim() || '9 Hari',
        airline: form.airline?.trim() || null,
        flightType: form.flightType || 'direct',
        hotelMakkah: form.hotelMakkah?.trim() || null,
        hotelMadinah: form.hotelMadinah?.trim() || null,
        facilitiesIncluded: form.facilitiesIncluded?.trim() || null,
        facilitiesExcluded: form.facilitiesExcluded?.trim() || null,
        itinerary: form.itinerary?.trim() || null,
        flyerImage: form.flyerImage?.trim() || null,
        isPromo: Boolean(form.isPromo),
        promoDiscount: form.isPromo ? form.promoDiscount?.trim() || null : null,
        promoDeadline: form.isPromo && form.promoDeadline ? form.promoDeadline : null,
        isActive: Boolean(form.isActive),
        ...(isSuperadmin && form.brandId ? { brandId: Number(form.brandId) } : {}),
      };

      if (isEdit && pkg?.id) {
        return api.patch(`/catalog/packages/${pkg.id}`, payload);
      }
      return api.post('/catalog/packages', payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['packages'] });
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      setErrorMsg(err?.message || 'Gagal menyimpan data paket.');
    },
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl border border-zinc-200 focus:outline-none sm:p-7">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
            <div>
              <Dialog.Title className="font-display text-xl font-bold text-zinc-900">
                {isEdit ? 'Sunting Paket Umroh' : 'Terbitkan Paket Umroh Baru'}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-zinc-500 mt-0.5">
                Kelola jadwal, akomodasi hotel, skema harga kamar, dan materi penawaran untuk CS.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Tutup"
                className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          {errorMsg && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              {errorMsg}
            </div>
          )}

          {/* Tab Navigation */}
          <div className="mt-5 flex gap-1 overflow-x-auto border-b border-zinc-200 pb-px">
            {[
              { id: 'info', label: '1. Identitas & Jadwal', icon: CalendarDays },
              { id: 'pricing', label: '2. Harga Kamar & DP', icon: UsersRound },
              { id: 'content', label: '3. Fasilitas & Itinerary', icon: Luggage },
              { id: 'promo', label: '4. Promo & Media Flyer', icon: Sparkles },
            ].map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id as any)}
                  className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-xs font-bold transition ${
                    isActive ? 'border-zinc-950 text-zinc-950' : 'border-transparent text-zinc-400 hover:text-zinc-700'
                  }`}
                >
                  <Icon size={14} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Tab 1: Identitas, Penerbangan & Hotel */}
          {activeTab === 'info' && (
            <div className="mt-5 space-y-4">
              {isSuperadmin && brands.length > 0 && (
                <div className="block">
                  <span className="label">Brand Travel Penyelenggara</span>
                  <Select
                    className="w-full"
                    aria-label="Brand Travel Penyelenggara"
                    value={form.brandId ? String(form.brandId) : undefined}
                    onValueChange={(brandId) => setForm({ ...form, brandId })}
                    options={brands.map((b) => ({ value: String(b.id), label: b.name }))}
                  />
                </div>
              )}

              <label className="block">
                <span className="label">Nama Paket Umroh *</span>
                <input
                  className="field"
                  value={form.name ?? ''}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Contoh: Paket Umroh Syawal Bintang 5 Promo"
                  required
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="label">Tanggal Keberangkatan</span>
                  <input
                    type="date"
                    className="field"
                    value={form.departureDate ?? ''}
                    onChange={(e) => setForm({ ...form, departureDate: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="label">Durasi Paket</span>
                  <input
                    className="field"
                    value={form.duration ?? ''}
                    onChange={(e) => setForm({ ...form, duration: e.target.value })}
                    placeholder="9 Hari / 12 Hari"
                  />
                </label>
                <label className="block">
                  <span className="label">Sisa Kuota Seat</span>
                  <input
                    type="number"
                    min="0"
                    className="field"
                    value={form.quotaRemaining ?? ''}
                    onChange={(e) => setForm({ ...form, quotaRemaining: e.target.value })}
                    placeholder="45"
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4 space-y-3">
                <h5 className="flex items-center gap-1.5 font-display text-xs font-bold text-zinc-700 uppercase tracking-wider">
                  <Plane size={14} /> Penerbangan & Rute
                </h5>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="label">Maskapai Penerbangan</span>
                    <input
                      className="field"
                      value={form.airline ?? ''}
                      onChange={(e) => setForm({ ...form, airline: e.target.value })}
                      placeholder="Contoh: Saudia Airlines / Garuda Indonesia"
                    />
                  </label>
                  <div className="block">
                    <span className="label">Tipe Penerbangan</span>
                    <Select
                      className="w-full"
                      aria-label="Tipe Penerbangan"
                      value={form.flightType ?? 'direct'}
                      onValueChange={(flightType) => setForm({ ...form, flightType })}
                      options={[
                        { value: 'direct', label: 'Direct (Langsung Jakarta - Jeddah/Madinah)' },
                        { value: 'transit', label: 'Transit (1x Transit)' },
                      ]}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4 space-y-3">
                <h5 className="flex items-center gap-1.5 font-display text-xs font-bold text-zinc-700 uppercase tracking-wider">
                  <Hotel size={14} /> Akomodasi Hotel
                </h5>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="label">Hotel Makkah</span>
                    <input
                      className="field"
                      value={form.hotelMakkah ?? ''}
                      onChange={(e) => setForm({ ...form, hotelMakkah: e.target.value })}
                      placeholder="Contoh: Pullman Zamzam / Setaraf (★5)"
                    />
                  </label>
                  <label className="block">
                    <span className="label">Hotel Madinah</span>
                    <input
                      className="field"
                      value={form.hotelMadinah ?? ''}
                      onChange={(e) => setForm({ ...form, hotelMadinah: e.target.value })}
                      placeholder="Contoh: Rove Al Madinah / Setaraf (★5)"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Skema Harga Kamar & DP */}
          {activeTab === 'pricing' && (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-900 leading-relaxed">
                <strong>Tips Penentuan Harga:</strong> Harga Quad digunakan sebagai harga dasar (starting price) dan
                menjadi acuan perhitungan otomatis kalkulasi deal value di pipeline CRM.
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Harga Kamar Quad (Ber-4) * [Acuan Dasar]</span>
                  <RupiahInput
                    className="field font-bold text-zinc-900"
                    value={form.priceQuad ?? form.price ?? ''}
                    onChange={(v) => setForm({ ...form, priceQuad: v, price: v })}
                    placeholder="Rp 29.500.000"
                    required
                  />
                </label>
                <label className="block">
                  <span className="label">Minimal Uang Muka (DP) *</span>
                  <RupiahInput
                    className="field font-bold text-zinc-900"
                    value={form.dp ?? ''}
                    onChange={(v) => setForm({ ...form, dp: v })}
                    placeholder="Rp 5.000.000"
                    required
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="label">Harga Kamar Triple (Ber-3)</span>
                  <RupiahInput
                    className="field"
                    value={form.priceTriple ?? ''}
                    onChange={(v) => setForm({ ...form, priceTriple: v })}
                    placeholder="Rp 31.500.000"
                  />
                </label>
                <label className="block">
                  <span className="label">Harga Kamar Double (Ber-2)</span>
                  <RupiahInput
                    className="field"
                    value={form.priceDouble ?? ''}
                    onChange={(v) => setForm({ ...form, priceDouble: v })}
                    placeholder="Rp 33.500.000"
                  />
                </label>
                <label className="block">
                  <span className="label">Harga Infant (&lt; 2 Thn)</span>
                  <RupiahInput
                    className="field"
                    value={form.priceInfant ?? ''}
                    onChange={(v) => setForm({ ...form, priceInfant: v })}
                    placeholder="Rp 10.000.000"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Tab 3: Fasilitas & Itinerary */}
          {activeTab === 'content' && (
            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="label mb-0">Fasilitas Termasuk (Include)</span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, facilitiesIncluded: DEFAULT_INCLUDED })}
                    className="text-[11px] font-semibold text-zinc-600 hover:text-black underline"
                  >
                    Gunakan Template Standar
                  </button>
                </div>
                <textarea
                  rows={5}
                  className="field resize-none font-sans text-xs leading-relaxed"
                  value={form.facilitiesIncluded ?? ''}
                  onChange={(e) => setForm({ ...form, facilitiesIncluded: e.target.value })}
                  placeholder="Satu fasilitas per baris..."
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="label mb-0">Fasilitas Tidak Termasuk (Exclude)</span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, facilitiesExcluded: DEFAULT_EXCLUDED })}
                    className="text-[11px] font-semibold text-zinc-600 hover:text-black underline"
                  >
                    Gunakan Template Standar
                  </button>
                </div>
                <textarea
                  rows={4}
                  className="field resize-none font-sans text-xs leading-relaxed"
                  value={form.facilitiesExcluded ?? ''}
                  onChange={(e) => setForm({ ...form, facilitiesExcluded: e.target.value })}
                  placeholder="Satu fasilitas per baris..."
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="label mb-0">Itinerary Agenda Perjalanan</span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, itinerary: DEFAULT_ITINERARY })}
                    className="text-[11px] font-semibold text-zinc-600 hover:text-black underline"
                  >
                    Gunakan Template 9 Hari
                  </button>
                </div>
                <textarea
                  rows={6}
                  className="field resize-none font-sans text-xs leading-relaxed"
                  value={form.itinerary ?? ''}
                  onChange={(e) => setForm({ ...form, itinerary: e.target.value })}
                  placeholder="Hari 1: ...\nHari 2: ..."
                />
              </div>
            </div>
          )}

          {/* Tab 4: Promo & Media Flyer */}
          {activeTab === 'promo' && (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <b className="block text-sm text-zinc-900">Program Promo Khusus</b>
                    <p className="text-xs text-zinc-500">Tampilkan badge promo dan potongan harga pada paket ini.</p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
                    checked={form.isPromo ?? false}
                    onChange={(e) => setForm({ ...form, isPromo: e.target.checked })}
                  />
                </div>

                {form.isPromo && (
                  <div className="grid gap-3 pt-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="label">Nominal Diskon Promo</span>
                      <input
                        className="field"
                        value={form.promoDiscount ?? ''}
                        onChange={(e) => setForm({ ...form, promoDiscount: e.target.value })}
                        placeholder="Contoh: Potongan Rp 1.500.000 / Free Kereta Cepat"
                      />
                    </label>
                    <label className="block">
                      <span className="label">Batas Waktu Promo</span>
                      <input
                        type="date"
                        className="field"
                        value={form.promoDeadline ?? ''}
                        onChange={(e) => setForm({ ...form, promoDeadline: e.target.value })}
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4 space-y-3">
                <h5 className="flex items-center gap-1.5 font-display text-xs font-bold text-zinc-700 uppercase tracking-wider">
                  <ImageIcon size={14} /> URL Flyer Poster
                </h5>
                <label className="block">
                  <span className="label">Tautan Gambar / Flyer (URL)</span>
                  <input
                    className="field"
                    value={form.flyerImage ?? ''}
                    onChange={(e) => setForm({ ...form, flyerImage: e.target.value })}
                    placeholder="https://... atau /flyers/paket-syawal.webp"
                  />
                </label>
                {form.flyerImage && (
                  <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 max-w-xs aspect-3/4">
                    <img
                      src={resolveMediaUrl(form.flyerImage)}
                      alt="Preview Flyer"
                      className="h-full w-full object-cover"
                      onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                    />
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4 flex items-center justify-between">
                <div>
                  <b className="block text-sm text-zinc-900">Publikasi Paket</b>
                  <p className="text-xs text-zinc-500">Paket aktif akan muncul pada opsi CS dan formulir prospek.</p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
                  checked={form.isActive ?? true}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="mt-7 flex items-center justify-between border-t border-zinc-100 pt-4">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <div className="flex items-center gap-2">
              {activeTab !== 'promo' && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const order: Array<'info' | 'pricing' | 'content' | 'promo'> = ['info', 'pricing', 'content', 'promo'];
                    const idx = order.indexOf(activeTab);
                    const nextTab = order[idx + 1];
                    if (nextTab) setActiveTab(nextTab);
                  }}
                >
                  Lanjutkan
                </Button>
              )}
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                <Save size={15} />
                {saveMutation.isPending ? 'Menyimpan...' : isEdit ? 'Simpan Perubahan' : 'Terbitkan Paket'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

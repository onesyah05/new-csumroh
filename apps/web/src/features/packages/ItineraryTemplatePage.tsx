import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ImageIcon, Loader2, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useAuth } from '../../app/auth';
import { showFeedback } from '../../app/toast';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';

type Tone = 'light' | 'dark';
interface BrandRow { id: number; name: string; code: string; itineraryTemplate?: string | null; itineraryTone?: Tone }

/** Angka sama dengan ITINERARY_ZONES di API (modules/catalog/itinerary-image.ts); panduan unduhan memakai angka yang sama. */
const SPEC = [
  ['Kanvas', '1080 × 1350 px (rasio 4:5), PNG/JPG/WEBP, maks. 15 MB'],
  ['Area designer atas', 'y 0–150: logo, nama brand, ornamen'],
  ['Nama paket', 'x 60, y 165, 960 × 170 px: maks. 2 baris'],
  ['Tanggal berangkat · durasi', 'x 60, y 345, 960 × 56 px: 1 baris'],
  ['Agenda per hari', 'x 60, y 415, 960 × 805 px'],
  ['Area designer bawah', 'y 1230–1350: kontak, alamat, ornamen'],
  ['Jarak tepi', 'Teks menempel di tepi area: beri ±24 px ruang kosong di sekeliling area teks'],
];

const TONES: { value: Tone; label: string; hint: string }[] = [
  { value: 'light', label: 'Banner terang', hint: 'Teks gelap' },
  { value: 'dark', label: 'Banner gelap', hint: 'Teks terang' },
];

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
  reader.onload = () => resolve(reader.result as string);
  reader.readAsDataURL(file);
});

/** Pratinjau: gambar itinerary contoh yang dirender server di atas template brand, dengan warna teks pilihan banner. */
function useTemplatePreview(brand: BrandRow) {
  const query = useQuery({
    queryKey: ['itinerary-preview', brand.id, brand.itineraryTemplate, brand.itineraryTone],
    queryFn: () => api.blob(`/api/v1/catalog/brands/${brand.id}/itinerary-preview`),
    enabled: Boolean(brand.itineraryTemplate),
    staleTime: Infinity,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!query.data) { setUrl(null); return; }
    const objectUrl = URL.createObjectURL(query.data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [query.data]);
  return { url, loading: query.isFetching, failed: query.isError };
}

function BrandTemplateCard({ brand }: { brand: BrandRow }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const tone: Tone = brand.itineraryTone === 'dark' ? 'dark' : 'light';
  const preview = useTemplatePreview(brand);
  const refreshBrands = () => queryClient.invalidateQueries({ queryKey: ['brands'] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!file.type.startsWith('image/')) throw new Error('Hanya file gambar (JPG, PNG, WEBP) yang dapat diunggah.');
      return api.put(`/catalog/brands/${brand.id}/itinerary-template`, { image: await readAsDataUrl(file) });
    },
    onSuccess: () => { void refreshBrands(); showFeedback(`Template itinerary ${brand.name} diperbarui.`); },
    onError: (err: any) => showFeedback(err?.message || 'Gagal mengunggah template.'),
  });
  const changeTone = useMutation({
    mutationFn: (next: Tone) => api.put(`/catalog/brands/${brand.id}/itinerary-tone`, { tone: next }),
    onSuccess: () => void refreshBrands(),
    onError: (err: any) => showFeedback(err?.message || 'Gagal menyimpan pilihan banner.'),
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-zinc-900">{brand.name}</h3>
          <p className="text-xs text-zinc-500">{brand.itineraryTemplate ? 'Template terpasang · pratinjau dengan contoh paket' : 'Belum ada template'}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) upload.mutate(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
          icon={upload.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        >
          {brand.itineraryTemplate ? 'Ganti' : 'Unggah'}
        </Button>
      </div>

      <div role="radiogroup" aria-label={`Warna banner ${brand.name}`} className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-200 bg-zinc-100 p-1">
        {TONES.map((option) => {
          const active = tone === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={changeTone.isPending}
              onClick={() => { if (!active) changeTone.mutate(option.value); }}
              className={cn('rounded-md px-2 py-1.5 text-xs transition', active ? 'bg-white font-semibold text-zinc-950 shadow-xs' : 'font-medium text-zinc-600 hover:text-zinc-950')}
            >
              {option.label}
              <span className="block font-normal text-zinc-500">{option.hint}</span>
            </button>
          );
        })}
      </div>

      {brand.itineraryTemplate ? (
        <div className="relative">
          {preview.url ? (
            <img src={preview.url} alt={`Pratinjau itinerary ${brand.name}`} className="aspect-[4/5] w-full rounded-xl border border-zinc-200 bg-zinc-100 object-cover" />
          ) : (
            <div className="grid aspect-[4/5] place-items-center rounded-xl border border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
              {preview.failed ? 'Pratinjau belum dapat dimuat.' : <Loader2 size={20} className="animate-spin" aria-label="Memuat pratinjau" />}
            </div>
          )}
          {preview.url && preview.loading && <Loader2 size={16} className="absolute right-2 top-2 animate-spin rounded-full bg-white/90 p-0.5 text-zinc-700" aria-label="Memperbarui pratinjau" />}
        </div>
      ) : (
        <div className="grid aspect-[4/5] place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-zinc-500">
          <ImageIcon size={28} className="opacity-30" aria-hidden="true" />
        </div>
      )}
    </Card>
  );
}

export function ItineraryTemplatePage() {
  const { user } = useAuth();
  const [downloading, setDownloading] = useState<Tone | null>(null);
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get<BrandRow[]>('/catalog/brands'), enabled: !!user });

  async function downloadGuide(tone: Tone) {
    setDownloading(tone);
    try {
      const blob = await api.blob(`/api/v1/catalog/itinerary-template/guide?tone=${tone}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `panduan-template-itinerary-banner-${tone === 'dark' ? 'gelap' : 'terang'}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showFeedback(err?.message || 'Gagal mengunduh panduan.');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="app-page space-y-6">
      <PageHeader
        title="Template Itinerary"
        subtitle="Satu template kosong per brand. CS membagikan itinerary paket sebagai gambar di atas template ini."
        actions={
          <div className="flex flex-wrap gap-2">
            {TONES.map((option) => (
              <Button key={option.value} type="button" variant="outline" onClick={() => void downloadGuide(option.value)} loading={downloading === option.value} icon={<Download size={14} />}>
                Panduan {option.label.toLowerCase()}
              </Button>
            ))}
          </div>
        }
      />

      <Card className="p-4">
        <h2 className="mb-3 text-xs font-extrabold text-zinc-700">Ukuran dan area teks (tetap)</h2>
        <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          {SPEC.map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <dt className="font-semibold text-zinc-800">{label}</dt>
              <dd className="text-zinc-600">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-zinc-600">
          Area teks harus polos. Pilih <b>Banner terang</b> bila area itu terang (teks ditulis gelap) atau <b>Banner gelap</b> bila area itu gelap (teks ditulis terang). Logo dan elemen brand dibuat langsung di template, di area designer. Pratinjau di bawah memakai contoh paket 9 hari.
        </p>
      </Card>

      {brands.isLoading ? <PageLoading label="Memuat brand…" /> : brands.isError ? <PageError title="Daftar brand belum dapat dimuat" onRetry={() => void brands.refetch()} /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(brands.data ?? []).map((brand) => <BrandTemplateCard key={brand.id} brand={brand} />)}
        </div>
      )}
    </div>
  );
}

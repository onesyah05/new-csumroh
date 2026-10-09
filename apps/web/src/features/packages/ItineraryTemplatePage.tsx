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

const TONES: { value: Tone; label: string; hint: string }[] = [
  { value: 'light', label: 'Terang', hint: 'Teks gelap' },
  { value: 'dark', label: 'Gelap', hint: 'Teks terang' },
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

function BrandTemplateCard({ brand, onGuide, guideBusy }: { brand: BrandRow; onGuide(tone: Tone): void; guideBusy: boolean }) {
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
        <h3 className="min-w-0 truncate text-sm font-bold text-zinc-900">{brand.name}</h3>
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
        <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="max-md:h-9 max-md:w-9"
          aria-label="Unduh panduan"
          title="Unduh panduan"
          onClick={() => onGuide(tone)}
          loading={guideBusy}
          icon={<Download size={14} />}
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
              title={option.hint}
              className={cn('rounded-md px-2 py-1.5 text-xs transition', active ? 'bg-white font-semibold text-zinc-950 shadow-xs' : 'font-medium text-zinc-600 hover:text-zinc-950')}
            >
              {option.label}
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
        <div className="grid h-24 place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-zinc-500">
          <ImageIcon size={24} className="opacity-30" aria-hidden="true" />
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
      <PageHeader className="hidden md:flex" title="Template Itinerary" />

      {brands.isLoading ? <PageLoading label="Memuat brand…" /> : brands.isError ? <PageError title="Daftar brand belum dapat dimuat" onRetry={() => void brands.refetch()} /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(brands.data ?? []).map((brand) => <BrandTemplateCard key={brand.id} brand={brand} onGuide={(tone) => void downloadGuide(tone)} guideBusy={downloading !== null} />)}
        </div>
      )}
    </div>
  );
}

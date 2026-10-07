import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ImageIcon, Loader2, Upload } from 'lucide-react';
import { api, resolveMediaUrl } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { showFeedback } from '../../app/toast';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';

interface BrandRow { id: number; name: string; code: string; itineraryTemplate?: string | null }

/** Angka sama dengan ITINERARY_ZONES di API (modules/catalog/itinerary-image.ts); panduan unduhan memakai angka yang sama. */
const SPEC = [
  ['Kanvas', '1080 × 1350 px (rasio 4:5), PNG/JPG/WEBP, maks. 15 MB'],
  ['Area designer atas', 'y 0–150: logo, nama brand, ornamen'],
  ['Nama paket', 'x 60, y 165, 960 × 170 px: maks. 2 baris'],
  ['Tanggal berangkat · durasi', 'x 60, y 345, 960 × 56 px: 1 baris'],
  ['Agenda per hari', 'x 60, y 415, 960 × 805 px'],
  ['Area designer bawah', 'y 1230–1350: kontak, alamat, ornamen'],
];

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
  reader.onload = () => resolve(reader.result as string);
  reader.readAsDataURL(file);
});

function BrandTemplateCard({ brand }: { brand: BrandRow }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!file.type.startsWith('image/')) throw new Error('Hanya file gambar (JPG, PNG, WEBP) yang dapat diunggah.');
      return api.put(`/catalog/brands/${brand.id}/itinerary-template`, { image: await readAsDataUrl(file) });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      showFeedback(`Template itinerary ${brand.name} diperbarui.`);
    },
    onError: (err: any) => showFeedback(err?.message || 'Gagal mengunggah template.'),
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-zinc-900">{brand.name}</h3>
          <p className="text-xs text-zinc-500">{brand.itineraryTemplate ? 'Template terpasang' : 'Belum ada template'}</p>
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
      {brand.itineraryTemplate ? (
        <img src={resolveMediaUrl(brand.itineraryTemplate)} alt={`Template itinerary ${brand.name}`} className="aspect-[4/5] w-full rounded-xl border border-zinc-200 bg-zinc-100 object-cover" />
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
  const [downloading, setDownloading] = useState(false);
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get<BrandRow[]>('/catalog/brands'), enabled: !!user });

  async function downloadGuide() {
    setDownloading(true);
    try {
      const blob = await api.blob('/api/v1/catalog/itinerary-template/guide');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'panduan-template-itinerary.png';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showFeedback(err?.message || 'Gagal mengunduh panduan.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="app-page space-y-6">
      <PageHeader
        title="Template Itinerary"
        subtitle="Satu template kosong per brand. CS membagikan itinerary paket sebagai gambar di atas template ini."
        actions={<Button type="button" variant="outline" onClick={() => void downloadGuide()} loading={downloading} icon={<Download size={14} />}>Unduh panduan</Button>}
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
        <p className="mt-3 text-xs text-zinc-600">Area teks harus polos dan terang: teks ditulis gelap. Logo dan elemen brand dibuat langsung di template, di area designer.</p>
      </Card>

      {brands.isLoading ? <PageLoading label="Memuat brand…" /> : brands.isError ? <PageError title="Daftar brand belum dapat dimuat" onRetry={() => void brands.refetch()} /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(brands.data ?? []).map((brand) => <BrandTemplateCard key={brand.id} brand={brand} />)}
        </div>
      )}
    </div>
  );
}

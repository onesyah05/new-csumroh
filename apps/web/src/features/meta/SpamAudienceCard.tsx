import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, RefreshCw, ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { showFeedback } from '../../app/toast';
import { Button } from '../../components/ui/button';

type SpamAudience = { count: number; audienceId: string | null; syncedAt: string | null; ready: boolean };

const dateTime = (value: string) =>
  new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value));

/** Nomor yang ditandai spam di Inbox → audiens pengecualian di ad account brand. */
export function SpamAudienceCard({ brandId }: { brandId: number }) {
  const [downloading, setDownloading] = useState(false);
  const query = useQuery({
    queryKey: ['spam-audience', brandId],
    queryFn: () => api.get<SpamAudience>(`/reports/spam-audience?brandId=${brandId}`),
    enabled: brandId > 0,
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ phones: number; received: number }>('/reports/spam-audience/sync', { brandId }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['spam-audience', brandId] });
      showFeedback(`${result.phones} nomor dikirim ke audiens Meta.`);
    },
    onError: (error: Error) => showFeedback(error.message, { error: true }),
  });

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await api.blob(`/api/v1/reports/spam-audience?brandId=${brandId}&format=csv`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'nomor-spam.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showFeedback((error as Error).message, { error: true });
    } finally {
      setDownloading(false);
    }
  };

  const data = query.data;
  return (
    <section className="surface rounded-xl border border-zinc-200 bg-white p-5" aria-labelledby="spam-audience-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-rose-600" aria-hidden="true" />
          <div className="min-w-0">
            <h3 id="spam-audience-title" className="text-sm font-semibold text-zinc-950">Audiens spam</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              {data ? `${data.count} nomor ditandai spam` : 'Memuat…'}
              {data?.syncedAt ? ` · disinkron ${dateTime(data.syncedAt)}` : data?.audienceId ? '' : ' · belum pernah disinkron'}
            </p>
            {data?.audienceId && (
              <p className="mt-1 text-xs text-zinc-500">Pakai audiens <b className="font-semibold text-zinc-700">CRM - Nomor spam (kecualikan)</b> sebagai pengecualian di set iklan.</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<Download size={13} />} onClick={() => void download()} loading={downloading} disabled={!data?.count}>
            Unduh CSV
          </Button>
          <Button size="sm" icon={<RefreshCw size={13} />} onClick={() => sync.mutate()} loading={sync.isPending} disabled={!data?.ready || !data.count}>
            Sinkronkan ke Meta
          </Button>
        </div>
      </div>
      {data && !data.ready && <p className="mt-3 text-xs text-amber-800">Isi Ad Account ID dan access token untuk sinkron otomatis.</p>}
    </section>
  );
}

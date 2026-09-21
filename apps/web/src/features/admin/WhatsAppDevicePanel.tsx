import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock3, QrCode, RefreshCw, ShieldCheck, Smartphone, Unplug, Wifi, WifiOff } from 'lucide-react';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { PageError, PageLoading } from '../../components/ui/page-feedback';

type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';
type WhatsAppSession = {
  brandId: number;
  sessionName: string;
  status: WhatsAppStatus;
  phoneNumber: string | null;
  qrCode: string | null;
  lastConnectedAt: string | null;
  updatedAt?: string;
};

const statusCopy: Record<WhatsAppStatus, { label: string; description: string }> = {
  disconnected: { label: 'Belum terhubung', description: 'Belum ada perangkat WhatsApp aktif untuk brand ini.' },
  connecting: { label: 'Menyiapkan koneksi', description: 'Gateway sedang membuat sesi perangkat baru.' },
  qr_ready: { label: 'Menunggu scan QR', description: 'Scan kode menggunakan WhatsApp pada perangkat utama.' },
  connected: { label: 'Terhubung', description: 'Pesan brand ini siap diterima dan dikirim melalui shared inbox.' },
};

export function WhatsAppDevicePanel({ brandId, brandName, canManage }: { brandId: number; brandName: string; canManage: boolean }) {
  const query = `?brandId=${brandId}`;
  const session = useQuery({
    queryKey: ['whatsapp-device', brandId],
    queryFn: () => api.get<WhatsAppSession>(`/whatsapp/status${query}`),
    refetchInterval: 2500,
  });
  const start = useMutation({
    mutationFn: () => api.post<WhatsAppSession>('/whatsapp/start', { brandId }),
    onSuccess: (data) => {
      queryClient.setQueryData(['whatsapp-device', brandId], data);
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
    },
  });
  const disconnect = useMutation({
    mutationFn: () => api.post<WhatsAppSession>('/whatsapp/disconnect', { brandId }),
    onSuccess: (data) => {
      queryClient.setQueryData(['whatsapp-device', brandId], data);
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
    },
  });

  if (session.isLoading) return <PageLoading label="Memuat perangkat WhatsApp" />;
  if (session.isError) return <PageError description={session.error.message} onRetry={() => void session.refetch()} />;

  const data = session.data!;
  const copy = statusCopy[data.status] ?? statusCopy.disconnected;
  const busy = start.isPending || disconnect.isPending;
  const actionError = start.error ?? disconnect.error;

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
    <section className="surface overflow-hidden">
      <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="page-kicker"><Smartphone size={14} />Perangkat WhatsApp</p>
          <h3 className="mt-2 font-display text-xl font-extrabold">{brandName}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Satu sesi WhatsApp terisolasi untuk brand ini. Percakapan yang masuk akan tersedia bagi seluruh CS brand.</p>
        </div>
        <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-2 text-xs font-bold ${data.status === 'connected' ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
          {data.status === 'connected' ? <Wifi size={14} /> : data.status === 'disconnected' ? <WifiOff size={14} /> : <RefreshCw size={14} className="animate-spin" />}
          {copy.label}
        </span>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <InfoCard icon={ShieldCheck} label="Isolasi sesi" value={`Khusus ${brandName}`} />
        <InfoCard icon={Smartphone} label="Nomor terhubung" value={data.phoneNumber ? `+${data.phoneNumber.replace(/^\+/, '')}` : 'Belum tersedia'} />
        <InfoCard icon={Clock3} label="Terakhir terhubung" value={data.lastConnectedAt ? new Date(data.lastConnectedAt).toLocaleString('id-ID') : 'Belum pernah'} />
        <InfoCard icon={QrCode} label="Nama sesi" value={data.sessionName || `brand_${brandId}`} />
      </div>

      <div className="border-t bg-zinc-50 p-5">
        <p className="text-sm font-semibold text-zinc-800">{copy.description}</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{canManage ? 'Gunakan WhatsApp utama: Perangkat tertaut → Tautkan perangkat → scan QR yang tampil.' : 'Pengelolaan perangkat hanya dapat dilakukan oleh Super Admin. Admin brand memiliki akses pantau status saja.'}</p>
        {actionError && <p className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600">{actionError.message}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {canManage && data.status !== 'connected' && <Button onClick={() => start.mutate()} disabled={busy}>
            {start.isPending ? <RefreshCw size={16} className="animate-spin" /> : <QrCode size={16} />}
            {data.status === 'qr_ready' ? 'Buat QR baru' : 'Hubungkan perangkat'}
          </Button>}
          <Button variant="secondary" onClick={() => void session.refetch()} disabled={session.isFetching || busy}>
            <RefreshCw size={16} className={session.isFetching ? 'animate-spin' : ''} />Perbarui status
          </Button>
          {canManage && data.status !== 'disconnected' && <Button variant="danger" onClick={() => disconnect.mutate()} disabled={busy}>
            <Unplug size={16} />Putuskan perangkat
          </Button>}
        </div>
      </div>
    </section>

    <section className="surface grid min-h-[380px] place-items-center p-5">
      {data.status === 'qr_ready' && data.qrCode ? <div className="w-full text-center">
        <div className="mx-auto max-w-[300px] rounded-3xl border bg-white p-4 shadow-sm"><img src={data.qrCode} alt={`QR WhatsApp ${brandName}`} className="aspect-square w-full" /></div>
        <div className="mt-4 flex items-center justify-center gap-2 text-sm font-bold"><QrCode size={17} />Scan QR sekarang</div>
        <p className="mt-2 text-xs leading-5 text-zinc-500">QR diperbarui otomatis. Jangan bagikan kode ini kepada pihak lain.</p>
      </div> : data.status === 'connected' ? <div className="text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-600 text-white"><CheckCircle2 size={30} /></span>
        <h4 className="mt-4 font-display text-lg font-extrabold">Perangkat aktif</h4>
        <p className="mt-2 text-sm text-zinc-500">{data.phoneNumber ? `+${data.phoneNumber.replace(/^\+/, '')}` : 'WhatsApp sudah terhubung'}</p>
      </div> : <div className="max-w-xs text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-zinc-100 text-zinc-500">{data.status === 'connecting' ? <RefreshCw size={28} className="animate-spin" /> : <QrCode size={28} />}</span>
        <h4 className="mt-4 font-display text-lg font-extrabold">{data.status === 'connecting' ? 'Membuat QR…' : 'QR belum tersedia'}</h4>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{data.status === 'connecting' ? 'Tunggu beberapa detik. QR akan muncul otomatis.' : 'Klik Hubungkan perangkat untuk membuat sesi WhatsApp brand ini.'}</p>
      </div>}
    </section>
  </div>;
}

function InfoCard({ icon: Icon, label, value }: { icon: typeof Smartphone; label: string; value: string }) {
  return <article className="rounded-2xl border bg-zinc-50 p-4"><div className="flex items-center gap-2 text-zinc-400"><Icon size={15} /><span className="text-[10px] font-bold uppercase tracking-[.1em]">{label}</span></div><p className="mt-3 truncate text-sm font-bold text-zinc-800" title={value}>{value}</p></article>;
}

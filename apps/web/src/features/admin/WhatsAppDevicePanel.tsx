import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertCircle, CheckCircle2, Clock3, QrCode,
  RefreshCw, ShieldCheck, Smartphone, Unplug, Wifi, WifiOff
} from 'lucide-react';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { ConfirmDialog } from '../../components/ui/modal';

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
  connecting: { label: 'Menyiapkan koneksi', description: 'Gateway sedang membuat sesi perangkat baru ke WhatsApp server.' },
  qr_ready: { label: 'Menunggu scan QR', description: 'Scan kode menggunakan aplikasi WhatsApp pada ponsel biro Anda.' },
  connected: { label: 'Terhubung', description: 'Sesi WhatsApp aktif. Pesan brand siap diterima dan dikirim melalui shared inbox.' },
};

const QR_TTL_SECONDS = 25;

function formatPhoneNumber(value?: string | null) {
  if (!value) return 'Belum tersedia';
  const clean = value.replace(/\D/g, '');
  if (clean.startsWith('62') && clean.length >= 10) {
    const prefix = '+62';
    const rest = clean.slice(2);
    if (rest.length <= 8) {
      return `${prefix} ${rest.slice(0, 3)}-${rest.slice(3)}`;
    }
    return `${prefix} ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`;
  }
  return value.startsWith('+') ? value : `+${value}`;
}

export function WhatsAppDevicePanel({ brandId, brandName, canManage }: { brandId: number; brandName: string; canManage: boolean }) {
  const query = `?brandId=${brandId}`;
  const [countdown, setCountdown] = useState(QR_TTL_SECONDS);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  const session = useQuery({
    queryKey: ['whatsapp-device', brandId],
    queryFn: () => api.get<WhatsAppSession>(`/whatsapp/status${query}`),
    refetchInterval: (queryData) => {
      const status = queryData?.state?.data?.status;
      // Aktifkan polling singkat hanya saat menunggu transisi QR atau koneksi
      if (status === 'connecting' || status === 'qr_ready') return 3000;
      // Saat sudah stabil (connected atau disconnected), andalkan socket push event
      return false;
    },
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

  const data = session.data;

  // Countdown timer saat QR ditampilkan
  useEffect(() => {
    if (data?.status !== 'qr_ready' || !data?.qrCode) return;
    setCountdown(QR_TTL_SECONDS);
    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 1 ? prev - 1 : 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [data?.qrCode, data?.status]);

  if (session.isLoading) return <PageLoading label="Memuat perangkat WhatsApp" />;
  if (session.isError) return <PageError description={session.error.message} onRetry={() => void session.refetch()} />;

  const currentData = data!;
  const copy = statusCopy[currentData.status] ?? statusCopy.disconnected;
  const busy = start.isPending || disconnect.isPending;
  const actionError = start.error ?? disconnect.error;
  const qrProgressPercent = Math.max(0, Math.min(100, (countdown / QR_TTL_SECONDS) * 100));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <section className="surface overflow-hidden">
        <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-display text-base font-bold text-zinc-950">Status Koneksi Gateway</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Sesi Baileys terisolasi. Pesan masuk otomatis didistribusikan ke shared inbox tim CS.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!canManage && (
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-600">
                Mode Pantau
              </span>
            )}
            <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${currentData.status === 'connected' ? 'bg-emerald-600 text-white' : currentData.status === 'qr_ready' ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
              {currentData.status === 'connected' ? (
                <Wifi size={14} />
              ) : currentData.status === 'disconnected' ? (
                <WifiOff size={14} />
              ) : (
                <RefreshCw size={14} className="animate-spin" />
              )}
              {copy.label}
            </span>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <InfoCard icon={ShieldCheck} label="Isolasi Sesi" value={`Khusus ${brandName}`} />
          <InfoCard icon={Smartphone} label="Nomor Terhubung" value={formatPhoneNumber(currentData.phoneNumber)} />
          <InfoCard icon={Clock3} label="Terakhir Terhubung" value={currentData.lastConnectedAt ? new Date(currentData.lastConnectedAt).toLocaleString('id-ID') : 'Belum pernah'} />
          <InfoCard icon={QrCode} label="Nama Sesi Gateway" value={currentData.sessionName || `brand_${brandId}`} />
        </div>

        {/* Panduan Langkah Scan Terstruktur */}
        <div className="border-t bg-zinc-50/70 p-5">
          <p className="text-sm font-semibold text-zinc-800">{copy.description}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {canManage
              ? 'Gunakan WhatsApp utama: Perangkat tertaut → Tautkan perangkat → scan QR yang tampil.'
              : 'Pengelolaan perangkat hanya dapat dilakukan oleh Super Admin. Admin brand memiliki akses pantau status saja.'}
          </p>

          {canManage && currentData.status !== 'connected' && (
            <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-bold text-zinc-500">
                Panduan Menautkan WhatsApp Biro
              </p>
              <ol className="mt-2.5 space-y-2 text-xs text-zinc-700">
                <li className="flex items-start gap-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-zinc-950 font-display text-xs font-bold text-white">1</span>
                  <span>Buka aplikasi WhatsApp di ponsel biro Anda</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-zinc-950 font-display text-xs font-bold text-white">2</span>
                  <span>Masuk ke <strong>Menu (⋮)</strong> di Android atau <strong>Pengaturan (⚙️)</strong> di iPhone, lalu pilih <strong>Perangkat Tertaut</strong></span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-zinc-950 font-display text-xs font-bold text-white">3</span>
                  <span>Ketuk <strong>Tautkan Perangkat</strong> dan arahkan kamera ponsel ke QR Code di samping</span>
                </li>
              </ol>
            </div>
          )}

          {/* Banner Error Ramah Pengguna */}
          {actionError && (
            <div role="alert" className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-rose-600" />
              <div className="flex-1">
                <strong className="font-semibold">Operasi gateway gagal:</strong>
                <p className="mt-0.5">{actionError.message}</p>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canManage && currentData.status !== 'connected' && (
              <Button onClick={() => start.mutate()} disabled={busy}>
                {start.isPending ? <RefreshCw size={16} className="animate-spin" /> : <QrCode size={16} />}
                {currentData.status === 'qr_ready' ? 'Buat QR baru' : 'Hubungkan perangkat'}
              </Button>
            )}
            <Button variant="secondary" onClick={() => void session.refetch()} disabled={session.isFetching || busy}>
              <RefreshCw size={16} className={session.isFetching ? 'animate-spin' : ''} />Perbarui status
            </Button>
            {canManage && currentData.status !== 'disconnected' && (
              <Button variant="danger" onClick={() => setConfirmDisconnectOpen(true)} disabled={busy}>
                <Unplug size={16} />Putuskan perangkat
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Bagian Visual QR Code & Status Perangkat */}
      <section className="surface flex min-h-[380px] flex-col items-center justify-center p-6 text-center">
        {currentData.status === 'qr_ready' && currentData.qrCode ? (
          <div className="w-full">
            <div className="relative mx-auto max-w-[280px] rounded-3xl border border-zinc-200 bg-white p-4 shadow-lift">
              <img
                src={currentData.qrCode}
                alt={`QR WhatsApp ${brandName}`}
                className="aspect-square w-full rounded-xl"
              />
              {/* Progress Bar Hitung Mundur TTL QR */}
              <div className="mt-3 overflow-hidden rounded-full bg-zinc-100 h-1.5 w-full">
                <div
                  className="h-full bg-zinc-950 transition-all duration-1000 ease-linear"
                  style={{ width: `${qrProgressPercent}%` }}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-center gap-2 text-sm font-extrabold text-zinc-950">
              <QrCode size={17} />Scan QR sekarang
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              QR diperbarui otomatis dalam ~{countdown} detik. Jangan bagikan kode ini kepada pihak luar.
            </p>
          </div>
        ) : currentData.status === 'connected' ? (
          <div className="max-w-xs">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-600 text-white shadow-lift">
              <CheckCircle2 size={32} />
            </span>
            <h4 className="mt-4 font-display text-lg font-extrabold text-zinc-950">Perangkat Aktif</h4>
            <p className="mt-2 text-sm font-semibold text-zinc-800">
              {formatPhoneNumber(currentData.phoneNumber)}
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              WhatsApp terhubung normal. Pesan jamaah masuk akan langsung diteruskan ke shared inbox tim CS.
            </p>
          </div>
        ) : (
          <div className="max-w-xs">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-zinc-100 text-zinc-500">
              {currentData.status === 'connecting' ? <RefreshCw size={28} className="animate-spin" /> : <QrCode size={28} />}
            </span>
            <h4 className="mt-4 font-display text-lg font-extrabold text-zinc-950">
              {currentData.status === 'connecting' ? 'Menghubungkan ke Gateway…' : 'QR Belum Dibuat'}
            </h4>
            <p className="mt-2 text-xs leading-6 text-zinc-500">
              {currentData.status === 'connecting'
                ? 'Sedang membuat sesi baru di WhatsApp Gateway. QR akan muncul otomatis dalam beberapa detik.'
                : 'Klik tombol Hubungkan perangkat untuk menampilkan kode QR otentikasi WhatsApp biro.'}
            </p>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmDisconnectOpen}
        onClose={() => setConfirmDisconnectOpen(false)}
        onConfirm={() => disconnect.mutate(undefined, { onSettled: () => setConfirmDisconnectOpen(false) })}
        pending={disconnect.isPending}
        title="Putuskan perangkat WhatsApp?"
        description={<>Sesi WhatsApp <strong>{brandName}</strong> diputus dari gateway. Pesan jamaah tidak diterima sampai perangkat ditautkan kembali.</>}
        confirmLabel="Putuskan sesi"
      />
    </div>
  );
}

function InfoCard({ icon: Icon, label, value }: { icon: typeof Smartphone; label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-zinc-200/80 bg-zinc-50 p-4">
      <div className="flex items-center gap-2 text-zinc-500">
        <Icon size={15} />
        <span className="text-xs font-bold">{label}</span>
      </div>
      <p className="mt-2.5 truncate font-display text-sm font-bold text-zinc-900" title={value}>
        {value}
      </p>
    </article>
  );
}

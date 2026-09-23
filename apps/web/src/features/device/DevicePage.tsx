import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Smartphone, Wifi, WifiOff, Clock3, QrCode,
  PhoneCall, Building2, Settings2, MessageSquare,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { useUiStore } from '../../app/store';
import { useBrandScope } from '../../lib/scope';
import { PageError, PageLoading, SectionEmpty } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';

type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';

const statusConfig: Record<WhatsAppStatus, { label: string; color: string; dot: string; bar: string; icon: typeof Wifi }> = {
  connected:    { label: 'Terhubung',       color: 'text-emerald-700 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500 animate-pulse', bar: 'bg-emerald-500', icon: Wifi },
  qr_ready:     { label: 'Menunggu QR',     color: 'text-amber-700 bg-amber-50 border-amber-200',       dot: 'bg-amber-400 animate-pulse',   bar: 'bg-amber-400',   icon: QrCode },
  connecting:   { label: 'Menyambungkan…',  color: 'text-blue-700 bg-blue-50 border-blue-200',           dot: 'bg-blue-400 animate-pulse',    bar: 'bg-blue-400',    icon: Clock3 },
  disconnected: { label: 'Tidak Terhubung', color: 'text-zinc-500 bg-zinc-100 border-zinc-200',          dot: 'bg-zinc-300',                  bar: 'bg-zinc-300',    icon: WifiOff },
};

function formatPhone(value?: string | null) {
  if (!value) return 'Belum tersedia';
  const clean = value.replace(/\D/g, '');
  if (clean.startsWith('62') && clean.length >= 10) {
    const rest = clean.slice(2);
    return `+62 ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`;
  }
  return value.startsWith('+') ? value : `+${value}`;
}

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function DevicePage() {
  const { user } = useAuth();
  const { brandId } = useBrandScope();
  const setActiveBrandId = useUiStore((s) => s.setActiveBrandId);
  const navigate = useNavigate();

  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<any[]>('/catalog/brands'),
  });

  if (brands.isLoading) return <PageLoading label="Memuat status perangkat…" />;
  if (brands.isError) return <PageError description={brands.error.message} onRetry={() => void brands.refetch()} />;

  const brandList = (brands.data ?? []).filter((b) =>
    user?.role === 'superadmin' ? true : b.id === brandId
  );

  const connectedCount    = brandList.filter((b) => b.whatsappSession?.status === 'connected').length;
  const disconnectedCount = brandList.length - connectedCount;

  return (
    <div className="app-page space-y-6">
      {/* Header */}
      <PageHeader
        title="Perangkat WhatsApp"
        subtitle="Status koneksi gateway WhatsApp untuk setiap brand travel."
      />

      {/* Summary */}
      <section className="grid gap-3.5 sm:grid-cols-3">
        {[
          { icon: Building2, value: brandList.length,     label: 'Total Brand',     note: 'Brand terdaftar di sistem' },
          { icon: Wifi,      value: connectedCount,        label: 'Terhubung',       note: 'Gateway siap kirim/terima' },
          { icon: WifiOff,   value: disconnectedCount,     label: 'Tidak Terhubung', note: 'Perlu scan QR ulang' },
        ].map(({ icon: Icon, value, label, note }) => (
          <article key={label} className="surface p-5">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="text-xs font-medium text-zinc-500">{label}</span>
              <span className="grid h-7 w-7 place-items-center rounded-md bg-zinc-100 text-zinc-600">
                <Icon size={14} />
              </span>
            </div>
            <p className="mt-3 font-sans text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">{value}</p>
            <p className="mt-1 text-xs text-zinc-400">{note}</p>
          </article>
        ))}
      </section>

      {/* Device Cards */}
      {brandList.length === 0 ? (
        <SectionEmpty title="Belum ada brand" description="Tambahkan brand di menu Brand terlebih dahulu." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {brandList.map((brand) => {
            const session = brand.whatsappSession;
            const rawStatus = (session?.status ?? 'disconnected') as WhatsAppStatus;
            const cfg = statusConfig[rawStatus] ?? statusConfig.disconnected;
            const Icon = cfg.icon;

            return (
              <article
                key={brand.id}
                className="surface overflow-hidden flex flex-col cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/devices/${brand.id}`)}
              >
                {/* Status accent bar */}
                <div className={`h-1.5 ${cfg.bar}`} />

                <div className="p-5 flex-1 space-y-4">
                  {/* Brand header */}
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-zinc-950 font-display text-xs font-extrabold text-white">
                      {String(brand.code ?? 'BRD').slice(0, 3)}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display font-bold text-zinc-950 leading-tight truncate">{brand.name}</h3>
                      <span className="text-[10px] font-mono text-zinc-500">{brand.code}</span>
                    </div>
                  </div>

                  {/* Status badge */}
                  <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${cfg.color}`}>
                    <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                    <Icon size={12} />
                    {cfg.label}
                  </div>

                  {/* Session details */}
                  <dl className="space-y-2 text-xs">
                    <div className="flex items-center gap-2 text-zinc-600">
                      <PhoneCall size={13} className="shrink-0 text-zinc-400" />
                      <span className="font-medium">{formatPhone(session?.phoneNumber)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-400">
                      <Clock3 size={13} className="shrink-0" />
                      <span>
                        Terkoneksi terakhir:{' '}
                        <span className="text-zinc-600">{formatDate(session?.lastConnectedAt)}</span>
                      </span>
                    </div>
                    {session?.sessionName && (
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Smartphone size={13} className="shrink-0" />
                        <span className="font-mono text-zinc-500 truncate">{session.sessionName}</span>
                      </div>
                    )}
                  </dl>
                </div>

                {/* Footer */}
                <div className="border-t border-zinc-100 bg-zinc-50/70 px-5 py-3 flex items-center justify-between">
                  {rawStatus === 'connected' ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveBrandId(brand.id);
                        navigate(`/inbox?brandId=${brand.id}`);
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-100/80 hover:bg-emerald-200/80 px-3 py-1.5 rounded-lg transition cursor-pointer shadow-2xs"
                    >
                      <MessageSquare size={13} />
                      Buka Live Chat
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-400">Klik untuk mengelola</span>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-950">
                    <Settings2 size={13} /> Kelola
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileText, Inbox, MessageCircle, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { api, resolveMediaUrl } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { PageError, PageLoading, EmptyState } from '../../components/ui/page-feedback';
import { FinanceVerifyModal } from '../chat/FinanceVerifyModal';
import { PrivateProofThumb } from '../chat/PrivateProof';
import { RejectProofDialog } from './RejectProofDialog';
import { showFeedback } from '../../app/toast';

type CandidateMessage = {
  id: number;
  messageId: string;
  messageType: string;
  mediaUrl: string;
  messageText?: string | null;
  timestamp: number;
};

type QueueProspect = {
  id: number;
  brandId: number;
  name: string;
  phone?: string | null;
  status: string;
  invoiceAmount: string | number;
  invoiceNumber?: string | null;
  invoiceSentAt?: string | null;
  paymentProofUrl?: string | null;
  paymentProofMessageId?: string | null;
  paymentProofSubmittedAt?: string | null;
  package?: { id: number; name: string } | null;
  user?: { id: number; name: string } | null;
  brand: { id: number; name: string; code: string };
  candidateMessages?: CandidateMessage[];
};

type Queue = { submitted: QueueProspect[]; candidates: QueueProspect[] };

const rupiah = (value: unknown) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value ?? 0));

const timeAgo = (value?: string | number | null) => {
  if (!value) return '-';
  const at = typeof value === 'number' ? value * 1000 : new Date(value).getTime();
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.round(hours / 24)} hari lalu`;
};

const chatLink = (p: QueueProspect) => `/inbox?brandId=${p.brandId}&prospectId=${p.id}`;

function BillSummary({ p }: { p: QueueProspect }) {
  return (
    <div className="min-w-0 text-xs">
      <p className="font-semibold text-zinc-900">
        Pembayaran awal · {Number(p.invoiceAmount) > 0 ? rupiah(p.invoiceAmount) : 'nominal belum diisi'}
      </p>
      <p className="truncate text-zinc-500">
        {p.invoiceNumber ?? 'Tanpa nomor invoice'}
      </p>
    </div>
  );
}

function ProspectIdentity({ p }: { p: QueueProspect }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-zinc-950">{p.name}</p>
      <p className="truncate text-xs text-zinc-500">
        {p.brand.name} · {p.package?.name ?? 'Paket belum dipilih'} · PIC {p.user?.name ?? '—'}
      </p>
    </div>
  );
}

export function VerificationPage() {
  const [brandScope, setBrandScope] = useState('all');
  const [verifying, setVerifying] = useState<QueueProspect | null>(null);
  const [rejecting, setRejecting] = useState<QueueProspect | null>(null);

  const showToast = (message: string) => {
    showFeedback(message);
  };

  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get<any[]>('/catalog/brands') });
  const queue = useQuery({
    queryKey: ['verification-queue', brandScope],
    queryFn: () => api.get<Queue>(`/verification/queue?brandId=${brandScope}`),
    refetchInterval: 60_000,
  });

  const attach = useMutation({
    mutationFn: ({ prospect, message }: { prospect: QueueProspect; message: CandidateMessage }) =>
      api.post(`/prospects/${prospect.id}/payment-proof-from-message`, { messageId: message.id, brandId: prospect.brandId }),
    onSuccess: (_data, { prospect }) => {
      void queryClient.invalidateQueries({ queryKey: ['verification-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospect.id] });
      showToast(`Bukti transfer ${prospect.name} masuk antrean verifikasi.`);
    },
    onError: (error: Error) => showToast(error.message),
  });

  const submitted = queue.data?.submitted ?? [];
  const candidates = queue.data?.candidates ?? [];

  return (
    <div className="app-page space-y-6">
      <PageHeader
        kicker="Finance"
        kickerIcon={<ShieldCheck size={13} />}
        title="Verifikasi Pembayaran"
        subtitle="Verifikasi pembayaran awal (DP atau lunas) untuk menetapkan Deal."
        actions={
          <Select
            value={brandScope}
            onValueChange={setBrandScope}
            aria-label="Cakupan brand"
            className="w-48"
            options={[
              { value: 'all', label: 'Semua brand' },
              ...(brands.data ?? []).map((b) => ({ value: String(b.id), label: b.name, iconUrl: b.logoUrl, iconInitials: b.name.substring(0, 2).toUpperCase() })),
            ]}
          />
        }
      />

      <StatGrid cols={2}>
        <StatCard label="Menunggu verifikasi" value={submitted.length} icon={<Inbox size={16} />} alert={submitted.length > 0} />
        <StatCard label="Kandidat dari chat" value={candidates.length} note="Gambar/PDF setelah invoice" icon={<Sparkles size={16} />} />
      </StatGrid>

      {queue.isLoading ? (
        <PageLoading label="Memuat antrean verifikasi…" />
      ) : queue.isError ? (
        <PageError description={queue.error.message} onRetry={() => void queue.refetch()} />
      ) : (
        <>
          <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <header className="border-b border-zinc-200 bg-zinc-50/75 px-4 py-3">
              <h2 className="text-xs font-semibold text-zinc-500">Bukti diajukan</h2>
            </header>
            {submitted.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Antrean kosong" description="Tidak ada bukti transfer yang menunggu verifikasi." />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {submitted.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-zinc-50/60">
                    {p.paymentProofUrl && <PrivateProofThumb url={p.paymentProofUrl} />}
                    <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-2 sm:gap-4">
                      <ProspectIdentity p={p} />
                      <BillSummary p={p} />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden text-xs text-zinc-500 md:inline" title={p.paymentProofMessageId ? 'Diambil dari chat WhatsApp' : 'Diunggah CS'}>
                        {p.paymentProofMessageId ? 'Dari chat' : 'Upload'} · {timeAgo(p.paymentProofSubmittedAt)}
                      </span>
                      <Button size="sm" variant="secondary" to={chatLink(p)} icon={<MessageCircle size={13} />}>
                        Chat
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setRejecting(p)} icon={<XCircle size={13} />} aria-label={`Tolak bukti ${p.name}`}>
                        Tolak
                      </Button>
                      <Button size="sm" onClick={() => setVerifying(p)} icon={<CheckCircle2 size={13} />}>
                        Verifikasi
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <header className="border-b border-zinc-200 bg-zinc-50/75 px-4 py-3">
              <h2 className="text-xs font-semibold text-zinc-500">Kandidat bukti dari chat</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Gambar/PDF dari jamaah setelah invoice terkirim. Pilih yang merupakan bukti transfer; foto lain (KTP, paspor) abaikan saja.
              </p>
            </header>
            {candidates.length === 0 ? (
              <EmptyState icon={Sparkles} title="Belum ada kandidat bukti" description="Belum ada kiriman gambar/PDF baru dari jamaah yang sudah ditagih." />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {candidates.map((p) => (
                  <li key={p.id} className="space-y-2.5 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-2 sm:gap-4">
                        <ProspectIdentity p={p} />
                        <BillSummary p={p} />
                      </div>
                      <Button size="sm" variant="secondary" to={chatLink(p)} icon={<MessageCircle size={13} />}>
                        Chat
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(p.candidateMessages ?? []).map((m) => {
                        const isImage = m.messageType === 'imageMessage';
                        const busy = attach.isPending && attach.variables?.message.id === m.id;
                        return (
                          <div key={m.id} className="w-36 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
                            <a href={resolveMediaUrl(m.mediaUrl)} target="_blank" rel="noopener noreferrer" className="block h-24 bg-white" title="Buka ukuran penuh">
                              {isImage ? (
                                <img src={resolveMediaUrl(m.mediaUrl)} alt={`Kiriman ${p.name}`} className="h-full w-full object-cover" />
                              ) : (
                                <span className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-xs text-zinc-600">
                                  <FileText size={18} className="text-zinc-500" />
                                  <span className="line-clamp-2">{m.messageText || 'Dokumen'}</span>
                                </span>
                              )}
                            </a>
                            <div className="space-y-1 p-1.5">
                              <p className="text-xs text-zinc-500">{timeAgo(m.timestamp)}</p>
                              <Button
                                size="sm"
                                className="w-full"
                                disabled={attach.isPending}
                                onClick={() => attach.mutate({ prospect: p, message: m })}
                              >
                                {busy ? 'Memproses…' : 'Jadikan bukti'}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {verifying && (
        <FinanceVerifyModal
          open
          prospect={verifying}
          brandId={verifying.brandId}
          onClose={() => setVerifying(null)}
          onShowToast={showToast}
        />
      )}

      {rejecting && (
        <RejectProofDialog
          prospect={rejecting}
          onDone={(message) => { showToast(message); setRejecting(null); }}
          onClose={() => setRejecting(null)}
        />
      )}

    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Ban, CheckCircle2, Clock3, Inbox, MessageCircle, Search, ShieldCheck, Timer, XCircle } from 'lucide-react';
import { PAYMENT_CATEGORY_LABEL, paymentCategory } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { PageError, PageLoading, EmptyState } from '../../components/ui/page-feedback';
import { FinanceVerifyModal } from '../chat/FinanceVerifyModal';
import { PrivateProofThumb } from '../chat/PrivateProof';
import { onRovingKey, rovingTabIndex } from '../custom/roving';
import { RejectProofDialog } from './RejectProofDialog';
import { VerificationHistory } from './VerificationHistory';
import { durationLabel, rupiah, type VerificationSummary } from './verificationApi';
import { showFeedback } from '../../app/toast';

type QueueProspect = {
  id: number;
  brandId: number;
  name: string;
  phone?: string | null;
  status: string;
  invoiceAmount: string | number;
  invoiceNumber?: string | null;
  invoiceSentAt?: string | null;
  dealValue?: string | number | null;
  paymentProofUrl?: string | null;
  paymentProofMessageId?: string | null;
  paymentProofSubmittedAt?: string | null;
  customMinDp?: number | null;
  customAgreedPrice?: number | null;
  package?: { id: number; name: string } | null;
  user?: { id: number; name: string } | null;
  brand: { id: number; name: string; code: string };
};

type Queue = { submitted: QueueProspect[] };
type Tab = 'queue' | 'history';
const TABS: Tab[] = ['queue', 'history'];

const minutesSince = (value?: string | number | null) => {
  if (!value) return null;
  const at = typeof value === 'number' ? value * 1000 : new Date(value).getTime();
  return Math.max(0, Math.round((Date.now() - at) / 60_000));
};

const timeAgo = (value?: string | number | null) => {
  const minutes = minutesSince(value);
  if (minutes === null) return '-';
  return minutes < 1 ? 'baru saja' : `${durationLabel(minutes)} lalu`;
};

/** Bukti menunggu > 4 jam: perlu perhatian; > 1 hari: terlambat. */
const ageTone = (minutes: number | null) => (minutes === null ? null : minutes >= 1440 ? 'late' : minutes >= 240 ? 'warn' : null);

const chatLink = (p: QueueProspect) => `/inbox?brandId=${p.brandId}&prospectId=${p.id}`;

const matches = (p: QueueProspect, q: string) => {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [p.name, p.phone, p.invoiceNumber, p.brand.name, p.user?.name].some((v) => v?.toLowerCase().includes(needle));
};

function BillSummary({ p }: { p: QueueProspect }) {
  return (
    <div className="min-w-0 text-xs">
      <p className="font-semibold text-zinc-900">
        {Number(p.invoiceAmount) > 0
          ? <>Pembayaran {PAYMENT_CATEGORY_LABEL[paymentCategory(Number(p.invoiceAmount), Number(p.customAgreedPrice ?? p.dealValue ?? 0))]} · {rupiah(p.invoiceAmount)}</>
          : 'Pembayaran · nominal belum diisi'}
      </p>
      <p className="truncate text-zinc-500">
        {p.invoiceNumber ?? 'Tanpa nomor invoice'}
        {p.customMinDp ? ` · DP minimal ${rupiah(p.customMinDp)}` : ''}
      </p>
    </div>
  );
}

function ProspectIdentity({ p }: { p: QueueProspect }) {
  return (
    <div className="min-w-0">
      <Link to={`/prospects/${p.id}`} className="block truncate text-sm font-semibold text-zinc-950 hover:underline">{p.name}</Link>
      <p className="truncate text-xs text-zinc-500">
        {p.brand.name} · {p.package?.name ?? (p.customAgreedPrice ? 'Layanan custom' : 'Paket belum dipilih')} · PIC {p.user?.name ?? '—'}
      </p>
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange(value: string): void }) {
  return (
    <label className="relative block max-w-md">
      <span className="sr-only">Cari antrean</span>
      <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Cari nama, telepon, no. invoice, PIC" className="field pl-9" />
    </label>
  );
}

export function VerificationPage() {
  const [brandScope, setBrandScope] = useState('all');
  const [tab, setTab] = useState<Tab>('queue');
  const [search, setSearch] = useState('');
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
  const summary = useQuery({
    queryKey: ['verification-summary', brandScope],
    queryFn: () => api.get<VerificationSummary>(`/verification/summary?brandId=${brandScope}`),
    refetchInterval: 60_000,
  });

  const allSubmitted = queue.data?.submitted ?? [];
  const submitted = allSubmitted.filter((p) => matches(p, search));
  const oldestMinutes = allSubmitted.length ? minutesSince(allSubmitted[0]!.paymentProofSubmittedAt) : null;
  const s = summary.data;

  return (
    <div className="app-page space-y-6">
      <PageHeader
        kicker="Finance"
        kickerIcon={<ShieldCheck size={13} />}
        title="Verifikasi Pembayaran"
        subtitle="Verifikasi pembayaran DP atau lunas untuk menetapkan Deal."
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

      <StatGrid cols={4}>
        <StatCard
          label="Menunggu verifikasi"
          value={allSubmitted.length}
          note={oldestMinutes !== null ? `Tertua ${durationLabel(oldestMinutes)}` : undefined}
          icon={<Inbox size={16} />}
          alert={ageTone(oldestMinutes) !== null}
        />
        <StatCard label="Diverifikasi hari ini" value={s?.verifiedToday ?? '—'} note={s ? rupiah(s.verifiedAmountToday) : undefined} icon={<CheckCircle2 size={16} />} />
        <StatCard label="Ditolak hari ini" value={s?.rejectedToday ?? '—'} icon={<Ban size={16} />} />
        <StatCard
          label="Rata-rata verifikasi"
          value={s?.avgVerifyMinutes != null ? durationLabel(s.avgVerifyMinutes) : '—'}
          note="Bukti masuk → diverifikasi (30 hari)"
          icon={<Timer size={16} />}
        />
      </StatGrid>

      <div role="tablist" aria-label="Verifikasi" className="flex gap-2 border-b border-zinc-200" onKeyDown={(e) => onRovingKey(e, TABS, tab, setTab)}>
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`verif-tab-${value}`}
            aria-selected={tab === value}
            aria-controls={`verif-panel-${value}`}
            tabIndex={rovingTabIndex(value, tab, 'queue')}
            onClick={() => setTab(value)}
            className={cn('-mb-px border-b-2 px-4 py-2.5 text-xs font-medium', tab === value ? 'border-zinc-950 font-semibold text-zinc-950' : 'border-transparent text-zinc-500 hover:text-zinc-950')}
          >
            {value === 'queue' ? `Antrean (${allSubmitted.length})` : 'Riwayat'}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <div role="tabpanel" id="verif-panel-history" aria-labelledby="verif-tab-history">
          <VerificationHistory brandScope={brandScope} onShowToast={showToast} />
        </div>
      ) : (
        <div role="tabpanel" id="verif-panel-queue" aria-labelledby="verif-tab-queue" className="space-y-6">
          {queue.isLoading ? (
            <PageLoading label="Memuat antrean verifikasi…" />
          ) : queue.isError ? (
            <PageError description={queue.error.message} onRetry={() => void queue.refetch()} />
          ) : (
            <>
              {allSubmitted.length > 0 && <SearchBox value={search} onChange={setSearch} />}
              <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <header className="border-b border-zinc-200 bg-zinc-50/75 px-4 py-3">
                  <h2 className="text-xs font-semibold text-zinc-500">Bukti diajukan · terlama di atas</h2>
                </header>
                {submitted.length === 0 ? (
                  allSubmitted.length ? (
                    <EmptyState icon={Search} title="Tidak ada yang cocok" description="Tidak ada bukti yang cocok dengan pencarian." />
                  ) : (
                    <EmptyState icon={CheckCircle2} title="Antrean kosong" description="Tidak ada bukti transfer yang menunggu verifikasi. Hasil verifikasi ada di tab Riwayat." />
                  )
                ) : (
                  <ul className="divide-y divide-zinc-100">
                    {submitted.map((p) => {
                      const tone = ageTone(minutesSince(p.paymentProofSubmittedAt));
                      return (
                        <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-zinc-50/60">
                          {p.paymentProofUrl && <PrivateProofThumb url={p.paymentProofUrl} />}
                          <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-2 sm:gap-4">
                            <ProspectIdentity p={p} />
                            <BillSummary p={p} />
                          </div>
                          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                            <span
                              className={cn('mr-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs sm:mr-0',
                                tone === 'late' ? 'bg-rose-50 font-semibold text-rose-800' : tone === 'warn' ? 'bg-amber-50 font-semibold text-amber-900' : 'text-zinc-500')}
                              title={p.paymentProofMessageId ? 'Diambil dari chat WhatsApp' : 'Diunggah CS'}
                            >
                              {tone && <Clock3 size={12} aria-hidden="true" />}
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
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
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

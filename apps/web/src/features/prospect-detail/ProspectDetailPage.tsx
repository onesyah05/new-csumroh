import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, UserPlus2 } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CUSTOM_MODES, adultPaxOf, businessDateKey, customStatusLabel, isLostStatus, isWonStatus, objectionLabel,
  offerOutdated, packageBookingValue, targetMonthLabel,
} from '@csumroh/shared-types';
import { ProspectNotes, ProspectTimeline } from '../prospects/ProspectHistory';
import { customBadge } from '../custom/customApi';
import { onRovingKey, rovingTabIndex } from '../custom/roving';
import { useProfileAutosave } from '../chat/profileAutosave';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { queryClient } from '../../app/query';
import { showFeedback } from '../../app/toast';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { canEditProspect, readOnlyNote } from '../prospects/PicDialog';
import { assignedBrandIds, isHoldingRole } from '../../lib/scope';
import { QualificationFields } from '../prospects/QualificationFields';

const rupiah = (value: unknown) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value ?? 0));
/** Satu format tanggal untuk seluruh halaman: "26 Sep 2026". Tanggal bisnis (kolom DATE) dibaca sebagai UTC. */
const dateText = (value?: string | null, dateOnly = false) =>
  value ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: dateOnly ? 'UTC' : 'Asia/Jakarta' }).format(new Date(value)) : null;

const SOURCE_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', meta_ads: 'Meta Ads', website: 'Website', referral: 'Referral', walk_in: 'Walk-in', whatsapp_group: 'Grup WhatsApp' };
const STAGES = ['Terhubung', 'Terkualifikasi', 'Ditawarkan', 'Tunggu verifikasi', 'Deal'] as const;
const TABS = [{ key: 'profile', label: 'Profil' }, { key: 'activity', label: 'Catatan & riwayat' }] as const;
type TabKey = (typeof TABS)[number]['key'];

type CustomSummary = {
  id: number; status: string; quoteValidUntil: string | null; mode: string; agreedPrice: string | number | null;
  departureDate: string | null; departureDateTo: string | null; basePackage: { id: number; name: string; departureDate: string | null } | null;
};
type PaymentRecord = {
  id: number; amount: string | number; bankName: string; referenceNo: string | null; mutationDate: string | null;
  status: 'verified' | 'reversed'; correctedAt: string | null; reversalReason: string | null; createdAt: string;
};

function stageOf(status: string) {
  if (isWonStatus(status)) return 5;
  if (status === 'closing') return 4;
  if (['offer', 'offered', 'objection', 'followup', 'nurture'].includes(status)) return 3;
  if (status === 'qualified') return 2;
  if (['contact', 'identifying'].includes(status)) return 1;
  return 0;
}
const NEXT_STEP = ['Berikutnya: balas chat', 'Berikutnya: lengkapi kualifikasi', 'Berikutnya: kirim penawaran', 'Berikutnya: kirim invoice', 'Berikutnya: verifikasi Finance'];

export function ProspectDetailPage() {
  const prospectId = Number(useParams().id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab: TabKey = params.get('tab') === 'activity' ? 'activity' : 'profile';
  const setTab = (key: TabKey) => setParams((p) => { if (key === 'profile') p.delete('tab'); else p.set('tab', key); return p; }, { replace: true });

  // Kunci sama dengan modul lain (ID angka) agar aksi di Verifikasi/Inbox ikut menyegarkan halaman ini.
  const prospect = useQuery({
    queryKey: ['prospect', prospectId],
    queryFn: () => api.get<any>(`/prospects/${prospectId}`),
    enabled: Number.isInteger(prospectId) && prospectId > 0,
  });
  const p = prospect.data;
  const brandId: number | undefined = p?.brandId;

  const packages = useQuery({
    queryKey: ['packages', brandId],
    queryFn: () => api.get<any[]>(`/catalog/packages?brandId=${brandId}`),
    enabled: !!brandId,
  });

  // Simpan otomatis per isian, sama dengan panel profil di Kotak Masuk.
  const autosave = useProfileAutosave({
    prospectId,
    brandId,
    source: p,
    onSaved: (result) => {
      queryClient.setQueryData(['prospect', prospectId], result);
      if (result?.status === 'qualified' && p?.status !== 'qualified') showFeedback('Prospek naik ke Terkualifikasi');
    },
  });
  const form = autosave.form;

  const packageChange = useMutation({
    mutationFn: (packageId: number | null) => api.patch<any>(`/prospects/${prospectId}/profile`, { packageId, brandId }),
    onSuccess: (result) => {
      queryClient.setQueryData(['prospect', prospectId], result);
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospectId, 'logs'] });
      showFeedback('Paket diperbarui.');
    },
    onError: (error: Error) => showFeedback(error.message, { error: true }),
  });

  const claim = useMutation({
    mutationFn: () => api.post<any>(`/prospects/${prospectId}/claim`, { brandId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospectId] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      showFeedback('Anda sekarang PIC prospek ini.');
    },
    onError: (error: Error) => showFeedback(error.message, { error: true }),
  });

  if (prospect.isLoading) return <PageLoading label="Memuat profil prospek..." />;
  if (prospect.isError) return <PageError title="Profil tidak dapat dimuat" description={prospect.error.message} onRetry={() => void prospect.refetch()} />;
  if (!p) return <PageError title="Prospek tidak ditemukan" description="Data prospek ini tidak tersedia atau sudah dihapus." />;

  const won = isWonStatus(p.status);
  const lost = isLostStatus(p.status);
  const locked = !canEditProspect(user, p);
  const custom: CustomSummary | null = p.customRequests?.[0] ?? null;
  const customTag = won ? null : customBadge(custom);
  const bookingLocked = won || Boolean(custom);
  const adults = adultPaxOf(form);
  const pkg = packages.data?.find((item) => item.id === p.packageId) ?? p.package ?? null;
  const outdated = !custom && offerOutdated(p, pkg);
  const today = businessDateKey();

  // Nilai: Deal/penawaran dari data tersimpan; sebelum penawaran, estimasi dari harga paket × jamaah (rumus server).
  const agreed = custom && Number(custom.agreedPrice) > 0 ? Number(custom.agreedPrice) : null;
  const estimate = pkg ? packageBookingValue(pkg, form) : null;
  const value = Number(p.dealValue) > 0
    ? { label: won ? 'Nilai deal' : 'Nilai penawaran', amount: Number(p.dealValue) }
    : agreed ? { label: 'Harga custom disepakati', amount: agreed }
      : estimate ? { label: 'Estimasi', amount: estimate } : { label: 'Nilai', amount: null };

  const departure = pkg?.departureDate ?? custom?.departureDate ?? custom?.basePackage?.departureDate ?? null;
  const followup = form.nextFollowupDate || null;
  // Follow-up ditampilkan untuk prospek berjalan; setelah Deal hanya bila dijadwalkan ke depan.
  const showFollowup = followup && !lost && (!won || followup >= today);
  const followupLate = Boolean(showFollowup && !won && followup! < today);

  const stage = stageOf(p.status);
  const stageNote = lost
    ? `Batal${p.lostReason ? ` · ${p.lostReason}` : ''}`
    : won ? 'Deal · penanganan CS selesai'
      : p.status === 'objection' ? `Keberatan: ${[objectionLabel(p.objectionCategory), p.objectionNotes].filter(Boolean).join(' · ')}`
        : NEXT_STEP[Math.min(stage, 4)];

  const source = p.leadSource === 'meta_ads' && p.adHeadline ? `Meta Ads · ${p.adHeadline}` : SOURCE_LABEL[p.leadSource] ?? p.leadSource;
  const phone = p.phone ? (String(p.phone).startsWith('+') ? p.phone : `+${p.phone}`) : 'Nomor belum ada';
  const inboxLink = `/inbox?brandId=${p.brandId}&prospectId=${p.id}${p.phone ? `&phone=${encodeURIComponent(p.phone)}` : ''}${p.remoteJid ? `&jid=${encodeURIComponent(p.remoteJid)}` : ''}`;
  const multiBrand = isHoldingRole(user?.role) || assignedBrandIds(user).length > 1;
  const back = () => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate('/pipeline'));

  return (
    <div className="app-page space-y-5">
      <PageHeader
        onBack={back}
        title={p.name}
        badges={
          <>
            <Badge value={p.status} />
            {customTag && <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', customTag.urgent ? 'bg-amber-100 text-amber-900' : 'border border-zinc-300 text-zinc-700')}>{customTag.text}</span>}
            {p.spamAt && <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Spam</span>}
          </>
        }
        subtitle={[multiBrand ? p.brand?.name : null, phone, source, p.city, p.user?.name ? `PIC ${p.user.name}` : 'Belum ada PIC'].filter(Boolean).join(' · ')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {user?.role === 'cs' && !p.userId && !won && !lost && (
              <Button variant="secondary" onClick={() => claim.mutate()} loading={claim.isPending} icon={<UserPlus2 size={14} />}>Klaim PIC</Button>
            )}
            <Button to={inboxLink} icon={<MessageCircle size={15} />}>Buka di Kotak Masuk</Button>
          </div>
        }
      />

      {/* Jalur tahap: posisi prospek dan langkah berikutnya dalam satu baris. */}
      <section aria-label={`Tahap ${lost ? 'batal' : `${stage} dari 5`}`} className="surface px-5 py-4">
        <ol className="grid grid-cols-5 gap-1.5">
          {STAGES.map((label, index) => {
            const reached = !lost && index < stage;
            const current = !lost && index === stage - 1;
            return (
              <li key={label} className="min-w-0">
                <span className={cn('block h-1.5 rounded-full', reached ? (won ? 'bg-emerald-600' : 'bg-zinc-900') : 'bg-zinc-200')} aria-hidden="true" />
                <span className={cn('mt-1.5 hidden truncate text-xs sm:block', current ? 'font-semibold text-zinc-950' : reached ? 'text-zinc-700' : 'text-zinc-500')}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
        <p className={cn('mt-2 text-sm font-medium', lost ? 'text-rose-700' : won ? 'text-emerald-700' : p.status === 'objection' ? 'text-amber-800' : 'text-zinc-900')}>
          <span className="sm:hidden">{lost ? '' : `${STAGES[Math.max(stage - 1, 0)]} · `}</span>{stageNote}
        </p>
      </section>

      {/* Empat angka dalam satu permukaan (pola Ringkasan). */}
      <section aria-label="Ringkasan" className="surface overflow-hidden">
        <dl className="grid grid-cols-2 gap-px bg-zinc-100 lg:grid-cols-4 [&>div]:bg-white [&>div]:px-5 [&>div]:py-4">
          <div>
            <dt className="text-xs font-semibold text-zinc-600">{value.label}</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-zinc-950">{value.amount !== null ? rupiah(value.amount) : '—'}</dd>
            {outdated && <dd className="mt-0.5 text-xs font-medium text-amber-800">Perlu kirim ulang penawaran</dd>}
          </div>
          <div>
            <dt className="text-xs font-semibold text-zinc-600">Jamaah</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-zinc-950">{adults ? `${adults} dewasa` : '—'}</dd>
            {Number(form.paxInfant) > 0 && <dd className="mt-0.5 text-xs text-zinc-600">+ {form.paxInfant} bayi</dd>}
          </div>
          <div>
            <dt className="text-xs font-semibold text-zinc-600">Berangkat</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-zinc-950">
              {departure ? dateText(departure, true) : form.targetMonth ? targetMonthLabel(form.targetMonth) ?? '—' : '—'}
            </dd>
            {!departure && form.targetMonth && <dd className="mt-0.5 text-xs text-zinc-600">Target, paket belum dipilih</dd>}
          </div>
          <div>
            <dt className="text-xs font-semibold text-zinc-600">Follow-up</dt>
            <dd className={cn('mt-1 text-xl font-bold tabular-nums', followupLate ? 'text-rose-700' : 'text-zinc-950')}>{showFollowup ? dateText(followup, true) : '—'}</dd>
            {followupLate && <dd className="mt-0.5 text-xs font-medium text-rose-700">Terlambat</dd>}
          </div>
        </dl>
      </section>

      <div role="tablist" aria-label="Profil prospek" className="flex gap-1 border-b border-zinc-200" onKeyDown={(e) => onRovingKey(e, TABS.map((t) => t.key), tab, setTab)}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`prospect-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`prospect-panel-${t.key}`}
            tabIndex={rovingTabIndex(t.key, tab, 'profile')}
            onClick={() => setTab(t.key)}
            className={cn('-mb-px border-b-2 px-4 py-2.5 text-xs font-medium', tab === t.key ? 'border-zinc-950 font-semibold text-zinc-950' : 'border-transparent text-zinc-500 hover:text-zinc-950')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' ? (
        <div role="tabpanel" id="prospect-panel-profile" aria-labelledby="prospect-tab-profile" className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <Section
              title="Kualifikasi"
              aside={<SaveStatus state={autosave.state} error={autosave.error} onRetry={autosave.retry} />}
            >
              {locked && <p className="mb-3 text-xs text-zinc-600">{readOnlyNote(user, p)}</p>}
              <QualificationFields
                layout="page"
                value={form}
                onChange={(patch) => autosave.change(patch, Object.keys(patch).some((key) => key.startsWith('pax')) ? 600 : 0)}
                disabled={locked}
                bookingLocked={bookingLocked}
                bookingLockedReason={custom && !won ? 'Diatur di Layanan Custom.' : undefined}
                departure={departure ? new Date(departure) : null}
              />
            </Section>

            <Section title="Kebutuhan & dokumen">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Kebutuhan khusus</span>
                  <input
                    className="field"
                    value={form.specialNeeds}
                    disabled={locked}
                    onChange={(e) => autosave.change({ specialNeeds: e.target.value }, 800)}
                    onBlur={() => void autosave.flush()}
                    placeholder="Kursi roda, lansia…"
                  />
                </label>
                <label className="block">
                  <span className="label">Status vaksin</span>
                  <Select
                    value={form.vaccineStatus}
                    disabled={locked}
                    onValueChange={(vaccineStatus) => autosave.change({ vaccineStatus })}
                    options={[{ value: 'lengkap', label: 'Lengkap' }, { value: 'proses', label: 'Sedang proses' }, { value: 'belum', label: 'Belum vaksin' }]}
                    className="w-full"
                    placeholder="Pilih status"
                  />
                </label>
                {!lost && (
                  <label className="block">
                    <span className="label">Follow-up berikutnya</span>
                    <input
                      type="date"
                      className="field"
                      value={form.nextFollowupDate}
                      disabled={locked}
                      onChange={(e) => autosave.change({ nextFollowupDate: e.target.value })}
                    />
                  </label>
                )}
              </div>
            </Section>
          </div>

          <aside className="space-y-5">
            <Section title="Booking">
              <dl className="space-y-3 text-sm">
                <Row label="Paket">
                  {custom ? (
                    <span className="block">
                      <span className="font-semibold text-zinc-950">Layanan custom</span>
                      <span className="block text-xs text-zinc-600">
                        {[CUSTOM_MODES.find((m) => m.value === custom.mode)?.label, custom.basePackage?.name, agreed ? `${rupiah(agreed)} disepakati` : customStatusLabel(custom.status as never, 'cs')].filter(Boolean).join(' · ')}
                      </span>
                      {user?.role !== 'finance' && <Link to="/layanan-custom" className="mt-1 inline-block text-xs font-semibold text-zinc-700 underline-offset-2 hover:underline">Buka Layanan Custom</Link>}
                    </span>
                  ) : won || locked ? (
                    <span className="font-semibold text-zinc-950">{pkg?.name ?? '—'}</span>
                  ) : (
                    <Select
                      value={p.packageId ? String(p.packageId) : ''}
                      disabled={packageChange.isPending}
                      onValueChange={(id) => packageChange.mutate(id ? Number(id) : null)}
                      options={(packages.data ?? []).map((item) => ({
                        value: String(item.id),
                        label: item.departureDate ? `${item.name} · ${dateText(item.departureDate, true)}` : String(item.name),
                      }))}
                      placeholder="Pilih paket"
                      aria-label="Paket"
                      className="w-full"
                    />
                  )}
                </Row>
                <Row label="Penawaran">
                  {p.offerSentAt ? `${dateText(p.offerSentAt)} · ${rupiah(p.dealValue)}` : 'Belum dikirim'}
                  {outdated && (
                    <span role="alert" className="mt-1 flex items-start gap-1 text-xs text-amber-800">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />Jamaah atau paket berubah. Kirim ulang dari Kotak Masuk.
                    </span>
                  )}
                </Row>
                <Row label="Invoice">
                  {p.invoiceSentAt ? (
                    <span className="block">
                      <span className="block tabular-nums">{p.invoiceNumber ?? 'Tanpa nomor'}</span>
                      <span className={cn('block text-xs tabular-nums', !won && !lost && p.invoiceDueAt && dateKey(p.invoiceDueAt) < today ? 'font-medium text-rose-700' : 'text-zinc-600')}>
                        {rupiah(p.invoiceAmount)}{p.invoiceDueAt ? ` · jatuh tempo ${dateText(p.invoiceDueAt)}` : ''}
                      </span>
                    </span>
                  ) : 'Belum dikirim'}
                </Row>
              </dl>
            </Section>

            <PaymentsCard payments={p.payments ?? []} rejection={p.paymentProofUrl ? null : p.proofRejections?.[0] ?? null} />
          </aside>
        </div>
      ) : (
        <div role="tabpanel" id="prospect-panel-activity" aria-labelledby="prospect-tab-activity" className="surface grid gap-8 p-5 sm:p-6 lg:grid-cols-2">
          <ProspectNotes prospectId={p.id} brandId={p.brandId}
            disabledReason={won ? 'Penanganan CS selesai pada Deal.' : locked ? (user?.role === 'finance' ? 'Finance tidak menambah catatan prospek.' : 'Hanya PIC atau Admin yang dapat menambah catatan.') : null} />
          <ProspectTimeline prospectId={p.id} brandId={p.brandId} />
        </div>
      )}
    </div>
  );
}

const dateKey = (value: string) => businessDateKey(new Date(value));

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="surface p-5" aria-label={title}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-950">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
      <dt className="pt-0.5 text-xs font-semibold text-zinc-600">{label}</dt>
      <dd className="min-w-0 text-zinc-900">{children}</dd>
    </div>
  );
}

function SaveStatus({ state, error, onRetry }: { state: string; error: string | null; onRetry(): void }) {
  if (state === 'saving') return <span role="status" className="inline-flex items-center gap-1 text-xs text-zinc-600"><Loader2 size={12} className="animate-spin" aria-hidden="true" />Menyimpan…</span>;
  if (state === 'saved') return <span role="status" className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 size={12} aria-hidden="true" />Tersimpan</span>;
  if (state === 'error') {
    return (
      <span role="alert" className="inline-flex items-center gap-2 text-xs text-rose-700">
        {error ?? 'Gagal menyimpan.'}
        <button type="button" onClick={onRetry} className="font-semibold underline-offset-2 hover:underline">Coba lagi</button>
      </span>
    );
  }
  return null;
}

/** Pembayaran (DP/Lunas) yang diverifikasi Finance (termasuk yang dibatalkan) dan penolakan bukti terakhir. */
function PaymentsCard({ payments, rejection }: { payments: PaymentRecord[]; rejection: { reason: string; createdAt: string; rejectedBy?: { name: string } | null } | null }) {
  return (
    <Section title="Pembayaran">
      {payments.length === 0 && !rejection && <p className="text-xs text-zinc-600">Belum ada pembayaran terverifikasi.</p>}
      {rejection && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b className="font-semibold">Bukti ditolak</b> {dateText(rejection.createdAt)}{rejection.rejectedBy?.name ? ` oleh ${rejection.rejectedBy.name}` : ''}: {rejection.reason}
        </p>
      )}
      {payments.length > 0 && (
        <ul className="divide-y divide-zinc-100 text-xs">
          {payments.map((pay) => (
            <li key={pay.id} className="py-2 first:pt-0 last:pb-0">
              <p className="flex items-center justify-between gap-2">
                <b className={cn('text-sm font-semibold tabular-nums', pay.status === 'reversed' ? 'text-zinc-500 line-through' : 'text-zinc-950')}>{rupiah(pay.amount)}</b>
                <span className={cn('rounded px-1.5 py-0.5 font-semibold', pay.status === 'reversed' ? 'bg-zinc-100 text-zinc-700' : 'bg-emerald-50 text-emerald-800')}>
                  {pay.status === 'reversed' ? 'Dibatalkan' : 'Terverifikasi'}
                </span>
              </p>
              <p className="text-zinc-600">{pay.bankName}{pay.referenceNo ? ` · ${pay.referenceNo}` : ''} · mutasi {pay.mutationDate ? dateText(pay.mutationDate, true) : '—'}</p>
              <p className="text-zinc-600">Diverifikasi {dateText(pay.createdAt)}{pay.correctedAt ? ' · dikoreksi' : ''}</p>
              {pay.status === 'reversed' && pay.reversalReason && <p className="text-zinc-700">Alasan batal: {pay.reversalReason}</p>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

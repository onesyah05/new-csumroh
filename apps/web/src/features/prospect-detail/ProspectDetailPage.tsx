import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  CheckCircle2,
  CircleUserRound,
  Clock3,
  FileCheck2,
  MessageCircle,
  NotebookPen,
  Save,
  Sparkles,
  UserPlus2,
  UsersRound,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ProspectNotes, ProspectTimeline } from '../prospects/ProspectHistory';
import { customBadge } from '../custom/customApi';
import { cn } from '../../lib/cn';
import { adultPaxOf, calculateDealValue, isLostStatus, isWonStatus, offerOutdated, type ProspectStatus } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { useBrandScope } from '../../lib/scope';
import { useAuth } from '../../app/auth';
import { queryClient } from '../../app/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PageError, PageLoading, EmptyState } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { StatGrid, StatCard } from '../../components/ui/stat-card';
import { canEditProspect, readOnlyNote } from '../prospects/PicDialog';
import { QualificationFields } from '../prospects/QualificationFields';

const n = (value: unknown) => Number(String(value ?? 0).replace(/\D/g, '')) || 0;
const rupiah = (value: unknown) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
    Number(value ?? 0)
  );

export function ProspectDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { brandId: scopeBrandId } = useBrandScope();
  const [tab, setTab] = useState<'profile' | 'activity'>('profile');
  const [form, setForm] = useState<any>({});
  // Form tidak ditimpa refetch/realtime selama user sedang mengedit (A18).
  const [dirty, setDirty] = useState(false);
  const editForm = (next: any) => {
    setDirty(true);
    setForm(next);
  };

  // Scope mengikuti brand milik prospek (divalidasi backend terhadap akses user), bukan brand utama,
  // sehingga CS/pengawas multi-brand dapat membuka prospek brand mana pun yang menjadi haknya.
  const prospect = useQuery({
    queryKey: ['prospect', id],
    queryFn: () => api.get<any>(`/prospects/${id}`),
    enabled: !!id,
  });
  const brandId = prospect.data?.brandId ?? scopeBrandId;
  const query = brandId ? `?brandId=${brandId}` : '';

  const packages = useQuery({
    queryKey: ['packages', brandId],
    queryFn: () => api.get<any[]>(`/catalog/packages${query}`),
    enabled: !!brandId,
  });

  useEffect(() => {
    if (prospect.data && !dirty) {
      setForm({
        targetMonth: prospect.data.targetMonth ?? '',
        budgetRange: prospect.data.budgetRange ?? '',
        decisionMaker: prospect.data.decisionMaker ?? '',
        specialNeeds: prospect.data.specialNeeds ?? '',
        passportStatus: prospect.data.passportStatus ?? '',
        vaccineStatus: prospect.data.vaccineStatus ?? '',
        paxQuad: prospect.data.paxQuad ?? 0,
        paxTriple: prospect.data.paxTriple ?? 0,
        paxDouble: prospect.data.paxDouble ?? 0,
        paxInfant: prospect.data.paxInfant ?? 0,
        nextFollowupDate: prospect.data.nextFollowupDate?.slice(0, 10) ?? '',
        packageId: prospect.data.packageId ? String(prospect.data.packageId) : '',
      });
    }
  }, [prospect.data, dirty]);

  const selectedPackage = packages.data?.find((p) => String(p.id) === form.packageId);

  const dealValue = useMemo(
    () =>
      calculateDealValue(
        {
          quad: n(selectedPackage?.priceQuad || selectedPackage?.price),
          triple: n(selectedPackage?.priceTriple || selectedPackage?.price),
          double: n(selectedPackage?.priceDouble || selectedPackage?.price),
          infant: n(selectedPackage?.priceInfant),
        },
        {
          quad: Number(form.paxQuad),
          triple: Number(form.paxTriple),
          double: Number(form.paxDouble),
          infant: Number(form.paxInfant),
        }
      ),
    [form.paxQuad, form.paxTriple, form.paxDouble, form.paxInfant, selectedPackage]
  );

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/prospects/${id}/profile`, {
        ...form,
        packageId: form.packageId ? Number(form.packageId) : null,
        // Tanggal bisnis (YYYY-MM-DD); nilai transaksi & pembayaran tidak dikirim dari profil.
        nextFollowupDate: form.nextFollowupDate || null,
        brandId,
      }),
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['prospect', id] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
    },
  });

  const claim = useMutation({
    mutationFn: () => api.post(`/prospects/${id}/claim`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['prospect', id] }),
  });

  const p = prospect.data;
  if (prospect.isLoading) return <PageLoading label="Memuat profil prospek..." />;
  if (prospect.isError)
    return (
      <PageError
        title="Profil tidak dapat dimuat"
        description={prospect.error.message}
        onRetry={() => void prospect.refetch()}
      />
    );
  if (!p)
    return (
      <PageError
        title="Prospek tidak ditemukan"
        description="Data prospek ini tidak tersedia atau sudah dipindahkan."
      />
    );

  const locked = !canEditProspect(user, p);
  const customTag = isWonStatus(p.status) ? null : customBadge(p.customRequests?.[0]);
  const won = isWonStatus(p.status);
  const adults = adultPaxOf(form);
  const isOfferOutdated = offerOutdated(p, packages.data?.find((pkg) => pkg.id === p.packageId));

  return (
    <div className="app-page space-y-6">
      <PageHeader
        backUrl="/pipeline"
        title={p.name}
        badges={<><Badge value={p.status} />{customTag && <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', customTag.urgent ? 'bg-amber-100 text-amber-900' : 'border border-zinc-300 text-zinc-700')}>{customTag.text}</span>}</>}
        subtitle={`${p.phone || 'Nomor belum ada'} · ${p.city || 'Kota belum diisi'} · Sumber: ${p.leadSource}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {user?.role === 'cs' && !p.user && !isWonStatus(p.status) && !isLostStatus(p.status) && (
              <Button variant="secondary" size="md" onClick={() => claim.mutate()} icon={<UserPlus2 size={14} />}>
                Klaim PIC
              </Button>
            )}
            <Button
              variant="primary"
              size="md"
              to={`/inbox?prospectId=${p.id}${p.phone ? `&phone=${encodeURIComponent(p.phone)}` : ''}${
                p.remoteJid ? `&jid=${encodeURIComponent(p.remoteJid)}` : ''
              }`}
              icon={<MessageCircle size={15} />}
            >
              Buka di Kotak Masuk
            </Button>
          </div>
        }
      />

      {/* 4 Stat Overview Bars */}
      <StatGrid cols={4}>
        <StatCard label="Estimasi nilai deal" value={selectedPackage ? rupiah(dealValue) : 'Pilih paket'} />
        <StatCard label="Jumlah jamaah" value={`${adults} dewasa`} note={Number(form.paxInfant) > 0 ? `+ ${form.paxInfant} bayi` : undefined} />
        <StatCard label="CS PIC" value={p.user?.name ?? 'Belum ada'} />
        <StatCard
          label="Follow-up"
          value={p.nextFollowupDate ? new Date(p.nextFollowupDate).toLocaleDateString('id-ID') : 'Belum diatur'}
        />
      </StatGrid>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-zinc-200">
        {[
          ['profile', 'Profil 360°'],
          ['activity', 'Catatan & riwayat'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value as typeof tab)}
            className={`border-b-2 px-4 py-2.5 text-xs font-medium transition cursor-pointer ${
              tab === value
                ? 'border-zinc-950 text-zinc-950 font-semibold'
                : 'border-transparent text-zinc-500 hover:text-zinc-950'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            <FormSection icon={NotebookPen} title="Kualifikasi" subtitle="Boleh diisi bertahap; Terkualifikasi setelah bulan, jamaah, budget, dan paspor lengkap">
              <QualificationFields
                layout="page"
                value={form}
                onChange={(patch) => editForm({ ...form, ...patch })}
                disabled={save.isPending}
                bookingLocked={won}
                packages={packages.data ?? []}
                selectedPackageId={form.packageId}
                onSelectPackage={(packageId) => editForm({ ...form, packageId })}
                departure={selectedPackage?.departureDate ? new Date(selectedPackage.departureDate) : null}
              />
            </FormSection>

            <FormSection icon={UsersRound} title="Paket & estimasi" subtitle="Nilai deal dihitung otomatis dari harga paket × jamaah">
              {isOfferOutdated && (
                <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Jamaah atau paket berubah sejak penawaran ({rupiah(p.dealValue)}). Kirim ulang dari Kotak Masuk.
                </p>
              )}
              <Field label="Paket pilihan">
                <Select
                  value={form.packageId}
                  disabled={won}
                  onValueChange={(packageId) => editForm({ ...form, packageId })}
                  options={(packages.data ?? []).map((item) => ({
                    value: String(item.id),
                    label: String(item.name),
                  }))}
                  placeholder="Pilih paket"
                  className="w-full"
                />
              </Field>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-xs font-semibold text-zinc-600">Estimasi dari isian saat ini</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-zinc-950">{selectedPackage ? rupiah(dealValue) : 'Pilih paket dulu'}</p>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-xs font-semibold text-zinc-600">{won ? 'Nilai deal' : 'Nilai penawaran terkirim'}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-zinc-950">{Number(p.dealValue) > 0 ? rupiah(p.dealValue) : 'Belum ada'}</p>
                </div>
              </div>
            </FormSection>

            <FormSection icon={FileCheck2} title="Kebutuhan & dokumen lain" subtitle="Informasi pendukung, tidak memengaruhi tahap">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Kebutuhan khusus">
                  <input
                    className="field"
                    value={form.specialNeeds}
                    onChange={(e) => editForm({ ...form, specialNeeds: e.target.value })}
                    placeholder="Kursi roda, lansia…"
                  />
                </Field>
                <Field label="Status vaksin">
                  <Select
                    value={form.vaccineStatus}
                    onValueChange={(vaccineStatus) => editForm({ ...form, vaccineStatus })}
                    options={(
                      [
                        ['lengkap', 'Lengkap'],
                        ['proses', 'Sedang proses'],
                        ['belum', 'Belum vaksin'],
                      ] as const
                    ).map(([value, label]) => ({ value, label }))}
                    className="w-full"
                    placeholder="Pilih status"
                  />
                </Field>
              </div>
            </FormSection>
          </div>

          <aside className="space-y-6">
            <div className="surface p-5">
              <h3 className="text-sm font-semibold text-zinc-950">Kontrol Pipeline</h3>
              <p className="mt-0.5 text-xs text-zinc-500">Jadwal tindak lanjut dan catatan prospek.</p>
              <div className="mt-5 space-y-4">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-1.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-700">Status Pipeline</span>
                    <Badge value={p.status} />
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Perpindahan status berjalan otomatis berdasarkan aksi (kirim chat, kualifikasi, penawaran resmi, invoice pembayaran, dan verifikasi Finance).
                  </p>
                </div>
                <Field label="Follow-up berikutnya">
                  <input
                    type="date"
                    className="field"
                    value={form.nextFollowupDate}
                    onChange={(e) => editForm({ ...form, nextFollowupDate: e.target.value })}
                  />
                </Field>
                <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending || locked}>
                  <Save size={14} />
                  <span>{save.isPending ? 'Menyimpan…' : 'Simpan Perubahan'}</span>
                </Button>
                {locked && (
                  <p className="text-xs text-zinc-600">{readOnlyNote(user, p)}</p>
                )}
                {save.isSuccess && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <CheckCircle2 size={14} />
                    <span>Perubahan tersimpan.</span>
                  </p>
                )}
                {save.error && <p className="text-xs text-rose-500">{save.error.message}</p>}
              </div>
            </div>

            <PaymentsCard payments={p.payments ?? []} rejection={p.paymentProofUrl ? null : p.proofRejections?.[0] ?? null} />

          </aside>
        </div>
      )}

      {tab === 'activity' && (
        <div className="surface grid gap-8 p-6 sm:p-8 lg:grid-cols-2">
          <ProspectNotes prospectId={p.id} brandId={p.brandId}
            disabledReason={isWonStatus(p.status) ? 'Penanganan CS selesai pada Deal.' : locked ? (user?.role === 'finance' ? 'Finance tidak menambah catatan prospek.' : 'Hanya PIC atau Admin yang dapat menambah catatan.') : null} />
          <ProspectTimeline prospectId={p.id} brandId={p.brandId} />
        </div>
      )}

    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

type PaymentRecord = {
  id: number; amount: string | number; bankName: string; referenceNo: string | null; mutationDate: string | null;
  status: 'verified' | 'reversed'; correctedAt: string | null; reversalReason: string | null; createdAt: string;
};

/** Pembayaran (DP/lunas) yang diverifikasi Finance (termasuk yang dibatalkan) dan penolakan bukti terakhir. */
function PaymentsCard({ payments, rejection }: { payments: PaymentRecord[]; rejection: { reason: string; createdAt: string; rejectedBy?: { name: string } | null } | null }) {
  const day = (value: string) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(value));
  return (
    <div className="surface p-5">
      <h3 className="text-sm font-semibold text-zinc-950">Pembayaran</h3>
      {payments.length === 0 && !rejection && <p className="mt-1 text-xs text-zinc-500">Belum ada pembayaran terverifikasi.</p>}
      {rejection && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b className="font-semibold">Bukti ditolak</b> {day(rejection.createdAt)}{rejection.rejectedBy?.name ? ` oleh ${rejection.rejectedBy.name}` : ''}: {rejection.reason}
        </p>
      )}
      {payments.length > 0 && (
        <ul className="mt-2 divide-y divide-zinc-100 text-xs">
          {payments.map((pay) => (
            <li key={pay.id} className="py-2">
              <p className="flex items-center justify-between gap-2">
                <b className={cn('font-semibold tabular-nums', pay.status === 'reversed' ? 'text-zinc-500 line-through' : 'text-zinc-950')}>{rupiah(pay.amount)}</b>
                <span className={cn('rounded px-1.5 py-0.5 font-semibold', pay.status === 'reversed' ? 'bg-zinc-100 text-zinc-700' : 'bg-emerald-50 text-emerald-800')}>
                  {pay.status === 'reversed' ? 'Dibatalkan' : 'Terverifikasi'}
                </span>
              </p>
              <p className="text-zinc-600">{pay.bankName}{pay.referenceNo ? ` · ${pay.referenceNo}` : ''} · mutasi {pay.mutationDate ? day(pay.mutationDate) : '—'}</p>
              <p className="text-zinc-500">Diverifikasi {day(pay.createdAt)}{pay.correctedAt ? ' · dikoreksi' : ''}</p>
              {pay.status === 'reversed' && pay.reversalReason && <p className="text-zinc-700">Alasan batal: {pay.reversalReason}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormSection({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof NotebookPen;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-zinc-100 text-zinc-700">
          <Icon size={16} />
        </span>
        <div>
          <h3 className="font-sans text-sm font-semibold text-zinc-950">{title}</h3>
          <p className="text-xs text-zinc-500">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

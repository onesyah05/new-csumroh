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
  ShieldCheck,
  Sparkles,
  UserPlus2,
  UsersRound,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { calculateDealValue, isLostStatus, isWonStatus, type ProspectStatus } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { useBrandScope } from '../../lib/scope';
import { useAuth } from '../../app/auth';
import { queryClient } from '../../app/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { StatGrid, StatCard } from '../../components/ui/stat-card';
import { isLockedForCs } from '../prospects/PicDialog';

const n = (value: unknown) => Number(String(value ?? 0).replace(/\D/g, '')) || 0;
const rupiah = (value: unknown) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
    Number(value ?? 0)
  );

export function ProspectDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { brandId: scopeBrandId } = useBrandScope();
  const [tab, setTab] = useState<'profile' | 'activity' | 'tgjp'>('profile');
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
        notes: prospect.data.notes ?? '',
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

  const locked = isLockedForCs(user, p);

  return (
    <div className="app-page space-y-6">
      <PageHeader
        backUrl="/pipeline"
        title={p.name}
        badges={<Badge value={p.status} />}
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
        <StatCard label="Estimasi Deal" value={rupiah(dealValue)} />
        <StatCard
          label="Jumlah Jamaah"
          value={`${
            Number(form.paxQuad) +
            Number(form.paxTriple) +
            Number(form.paxDouble) +
            Number(form.paxInfant)
          } pax`}
        />
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
          ['activity', 'Aktivitas'],
          ['tgjp', 'Wizard TGJP'],
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
            <FormSection icon={NotebookPen} title="Kualifikasi NPGD" subtitle="Need, Priority, Group, Decision maker">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Target keberangkatan">
                  <input
                    className="field"
                    value={form.targetMonth}
                    onChange={(e) => editForm({ ...form, targetMonth: e.target.value })}
                    placeholder="Contoh: Ramadan 1448H"
                  />
                </Field>
                <Field label="Kisaran budget">
                  <input
                    className="field"
                    value={form.budgetRange}
                    onChange={(e) => editForm({ ...form, budgetRange: e.target.value })}
                    placeholder="Contoh: 30–35 juta"
                  />
                </Field>
                <Field label="Pengambil keputusan">
                  <input
                    className="field"
                    value={form.decisionMaker}
                    onChange={(e) => editForm({ ...form, decisionMaker: e.target.value })}
                    placeholder="Diri sendiri / pasangan"
                  />
                </Field>
                <Field label="Kebutuhan khusus">
                  <input
                    className="field"
                    value={form.specialNeeds}
                    onChange={(e) => editForm({ ...form, specialNeeds: e.target.value })}
                    placeholder="Kursi roda, lansia…"
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection
              icon={UsersRound}
              title="Kamar & jumlah jamaah"
              subtitle="Nilai deal dihitung otomatis dari harga paket"
            >
              <Field label="Paket pilihan">
                <Select
                  value={form.packageId}
                  onValueChange={(packageId) => editForm({ ...form, packageId })}
                  options={(packages.data ?? []).map((item) => ({
                    value: String(item.id),
                    label: String(item.name),
                  }))}
                  placeholder="Pilih paket"
                  className="w-full"
                />
              </Field>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    ['paxQuad', 'Quad'],
                    ['paxTriple', 'Triple'],
                    ['paxDouble', 'Double'],
                    ['paxInfant', 'Infant'],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input
                      type="number"
                      min="0"
                      className="field font-mono"
                      value={form[key]}
                      onChange={(e) => editForm({ ...form, [key]: Number(e.target.value) })}
                    />
                  </Field>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-zinc-900 bg-zinc-950 p-4 text-white shadow-xs">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Estimasi nilai transaksi
                </p>
                <p className="mt-1 font-mono text-xl font-bold tracking-tight">{rupiah(dealValue)}</p>
              </div>
            </FormSection>

            <FormSection
              icon={FileCheck2}
              title="Dokumen & finansial"
              subtitle="Pantau kesiapan jamaah sebelum keberangkatan"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Status paspor">
                  <Select
                    value={form.passportStatus}
                    onValueChange={(passportStatus) => editForm({ ...form, passportStatus })}
                    options={(
                      [
                        ['sudah_ada', 'Sudah ada'],
                        ['proses_buat', 'Proses buat'],
                        ['perpanjang', 'Perpanjang'],
                        ['belum_ada', 'Belum ada'],
                      ] as const
                    ).map(([value, label]) => ({ value, label }))}
                    className="w-full"
                    placeholder="Pilih status"
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
                <div className="sm:col-span-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Nilai booking</p>
                      <p className="font-mono font-bold text-zinc-900">{rupiah(p.dealValue)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Kas terverifikasi</p>
                      <p className="font-mono font-bold text-emerald-700">{rupiah(p.dpAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Sisa tagihan</p>
                      <p className="font-mono font-bold text-zinc-900">
                        {rupiah(Math.max(0, Number(p.dealValue ?? 0) - Number(p.dpAmount ?? 0)))}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-200 pt-2">
                    <Badge value={p.paymentStatus} />
                    <span className="text-[10px] text-zinc-500">
                      Nilai & pembayaran hanya berubah lewat penawaran resmi dan verifikasi Finance.
                    </span>
                  </div>
                </div>
              </div>
            </FormSection>
          </div>

          <aside className="space-y-6">
            <div className="surface p-5">
              <h3 className="text-sm font-semibold text-zinc-950">Kontrol Pipeline</h3>
              <p className="mt-0.5 text-xs text-zinc-400">Jadwal tindak lanjut dan catatan prospek.</p>
              <div className="mt-5 space-y-4">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-1.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-700">Status Pipeline</span>
                    <Badge value={p.status} />
                  </div>
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    Perpindahan status berjalan otomatis berdasarkan aksi (kirim chat, kualifikasi, penawaran resmi, invoice DP, dan verifikasi keuangan).
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
                <Field label="Catatan internal">
                  <textarea
                    rows={5}
                    className="w-full resize-none rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-900 outline-none focus:border-black focus:ring-1 focus:ring-black placeholder:text-zinc-400 shadow-xs"
                    value={form.notes}
                    onChange={(e) => editForm({ ...form, notes: e.target.value })}
                    placeholder="Tuliskan poin penting preferensi jamaah…"
                  />
                </Field>
                <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending || locked}>
                  <Save size={14} />
                  <span>{save.isPending ? 'Menyimpan…' : 'Simpan Perubahan'}</span>
                </Button>
                {locked && (
                  <p className="text-xs text-zinc-600">Ditangani {p.user?.name ?? 'CS lain'}. Hanya PIC atau Admin yang dapat menyimpan perubahan.</p>
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

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 shadow-xs">
              <ShieldCheck size={18} className="text-zinc-700" />
              <h3 className="mt-3 text-xs sm:text-sm font-semibold text-zinc-950">Data Brand Terlindungi</h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                Rekening dan legalitas selalu diambil dari brand akun yang aktif secara terisolasi.
              </p>
            </div>
          </aside>
        </div>
      )}

      {tab === 'activity' && (
        <div className="surface p-6 sm:p-8">
          <div className="max-w-3xl space-y-0">
            {(p.logs ?? []).map((log: any, index: number) => (
              <div key={log.id} className="relative flex gap-4 pb-7">
                <div className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white shadow-2xs">
                  <Clock3 size={14} className="text-zinc-500" />
                </div>
                {index < (p.logs ?? []).length - 1 && (
                  <div className="absolute left-[15px] top-8 h-full border-l border-zinc-200" />
                )}
                <div className="pt-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-xs sm:text-sm font-semibold text-zinc-900">{log.title}</b>
                    <span className="text-[10px] text-zinc-400 font-mono">
                      {new Date(log.createdAt).toLocaleString('id-ID')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                    {log.description || `Oleh ${log.user?.name ?? 'sistem'}`}
                  </p>
                </div>
              </div>
            ))}
            {!(p.logs ?? []).length && (
              <p className="py-12 text-center text-xs text-zinc-400">Belum ada aktivitas untuk prospek ini.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'tgjp' && <TgjpWizard name={p.name} />}
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
          <p className="text-xs text-zinc-400">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function TgjpWizard({ name }: { name: string }) {
  const steps = [
    { id: 'T', title: 'Terima', text: `Validasi perasaan ${name} tanpa menyela atau membantah.` },
    { id: 'G', title: 'Gali', text: 'Temukan akar keberatan dengan satu pertanyaan terarah.' },
    { id: 'J', title: 'Jawab', text: 'Berikan solusi rasional sesuai kebutuhan dan fakta paket.' },
    { id: 'P', title: 'Pastikan', text: 'Pastikan keberatan selesai dan arahkan ke komitmen mikro.' },
  ];
  const [active, setActive] = useState(0);

  return (
    <div className="surface p-6 sm:p-8">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <Sparkles size={13} className="text-zinc-500" />
          <span>Framework Keberatan</span>
        </div>
        <h3 className="mt-1.5 font-sans text-xl sm:text-2xl font-bold tracking-tight text-zinc-950">
          TGJP Guided Response
        </h3>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => (
          <button
            key={step.id}
            type="button"
            onClick={() => setActive(index)}
            className={`rounded-xl border p-4 text-left transition ${
              active === index
                ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
                : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-800'
            }`}
          >
            <span
              className={`grid h-7 w-7 place-items-center rounded-md text-xs font-bold ${
                active === index ? 'bg-white text-black' : 'bg-zinc-100 text-zinc-700'
              }`}
            >
              {step.id}
            </span>
            <b className="mt-3 block font-sans text-xs sm:text-sm font-semibold">{step.title}</b>
            <p className={`mt-1.5 text-xs leading-relaxed ${active === index ? 'text-zinc-400' : 'text-zinc-500'}`}>
              {step.text}
            </p>
          </button>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-5 shadow-2xs">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Langkah {active + 1} dari 4
        </p>
        <h4 className="mt-1 font-sans text-base font-bold text-zinc-950">{steps[active]?.title}</h4>
        <textarea
          className="mt-3 min-h-28 w-full resize-none rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-900 outline-none focus:border-black focus:ring-1 focus:ring-black placeholder:text-zinc-400 shadow-xs"
          placeholder={`Tulis respons tahap ${steps[active]?.title.toLowerCase()} di sini…`}
        />
        <div className="mt-3 flex justify-end">
          <Button onClick={() => setActive(Math.min(3, active + 1))}>
            <span>{active === 3 ? 'Selesai' : 'Lanjutkan'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

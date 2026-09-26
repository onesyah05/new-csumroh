import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Ban,
  CalendarDays,
  Check,
  ChevronDown,
  CircleUserRound,
  Copy,
  CreditCard,
  ExternalLink,
  FileCheck,
  Luggage,
  MoreHorizontal,
  MessageCircle,
  NotebookPen,
  Pencil,
  Phone,
  Save,
  ShieldCheck,
  Sparkles,
  Undo2,
  UploadCloud,
  UserCheck,
  UserPlus2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  businessDateKey,
  isQualificationComplete,
  objectionLabel,
  offerOutdated,
  customDisplayStatus,
  pipelineStatuses,
  qualificationMissing,
  type ProspectStatus,
} from '@csumroh/shared-types';
import { QualificationFields } from '../prospects/QualificationFields';
import { QualificationPrompts } from './QualificationPrompts';
import { ProspectNotes, ProspectTimeline } from '../prospects/ProspectHistory';
import { ProspectPackageTab } from './ProspectPackageTab';
import { CustomRequestPanel } from '../custom/CustomRequestPanel';
import { CustomRequestForm } from '../custom/CustomRequestForm';
import { customToInput, emptyCustomInput, sinceLabel, useProspectCustom } from '../custom/customApi';
import { api, resolveMediaUrl } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useAuth } from '../../app/auth';
import { queryClient } from '../../app/query';
import { Badge, statusLabels } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { useProfileAutosave } from './profileAutosave';
import { assignedBrandIds, isHoldingRole } from '../../lib/scope';
import { ProspectAvatar } from '../../components/ui/avatar';
import { useWhatsAppAvatars } from '../../lib/avatars';
import { formatWaPackageSummary, formatWaPackageItinerary } from '../packages/packageQuote';
import { OfficialOfferModal } from './OfficialOfferModal';
import { ObjectionModal } from './ObjectionModal';
import { OfficialInvoiceModal } from './OfficialInvoiceModal';
import { PaymentProofModal } from './PaymentProofModal';
import { FinanceVerifyModal } from './FinanceVerifyModal';
import { PrivateProofThumb } from './PrivateProof';
import { LostReasonModal } from './LostReasonModal';
import { QualificationModal } from './QualificationModal';
import { PicDialog, canEditProspect, readOnlyNote } from '../prospects/PicDialog';

const rupiah = (value: unknown) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

interface ChatProspectProfileProps {
  prospectId: number;
  brandId?: number;
  query?: string;
  activeBrand?: any;
  packages: any[];
  onInsertText: (text: string) => void;
  onSendFlyer: (pkg: any) => void;
  onOpenPackagePicker: () => void;
  onPreviewImage?: (url: string) => void;
  onShowToast: (msg: string) => void;
  onOpenCopilot?: () => void;
  connected?: boolean;
  /** Tab dikendalikan panel samping (satu baris tab bersama Copilot). */
  activeTab?: ProfileTab;
  onChangeTab?: (tab: ProfileTab) => void;
}

export type ProfileTab = 'package' | 'qualification' | 'notes' | 'history';

export function ChatProspectProfile({
  prospectId,
  brandId,
  query = '',
  activeBrand,
  packages,
  onInsertText,
  onSendFlyer,
  onOpenPackagePicker,
  onPreviewImage,
  onShowToast,
  onOpenCopilot,
  connected = true,
  activeTab: controlledTab,
  onChangeTab,
}: ChatProspectProfileProps) {
  const { user } = useAuth();
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [internalTab, setInternalTab] = useState<ProfileTab>('package');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = onChangeTab ?? setInternalTab;
  const [showMoreActions, setShowMoreActions] = useState(false);

  // Modal dialog states for action-driven pipeline transitions
  const [showQualifyModal, setShowQualifyModal] = useState(false);
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [showObjectionModal, setShowObjectionModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showPaymentProofModal, setShowPaymentProofModal] = useState(false);
  const [showFinanceVerifyModal, setShowFinanceVerifyModal] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);

  // Fetch complete prospect data
  const prospectQuery = useQuery({
    queryKey: ['prospect', prospectId, brandId],
    queryFn: () => api.get<any>(`/prospects/${prospectId}${query}`),
    enabled: !!prospectId && !!brandId,
  });

  const p = prospectQuery.data;
  // Layanan custom aktif menggantikan paket katalog sebagai dasar penawaran.
  const customQuery = useProspectCustom(prospectId, brandId);
  const custom = customQuery.data ?? null;
  const customStatus = custom ? customDisplayStatus(custom) : null;
  // Gagal memuat ≠ tidak ada custom: aksi penawaran/invoice ditahan sampai data termuat.
  const customFailed = customQuery.isError;
  // Custom yang belum disepakati: penawaran/invoice katalog tidak berlaku.
  // Custom berbasis paket: flyer/itinerary paket dasar tetap bisa dikirim ke chat.
  const customBase = custom?.mode === 'package' ? packages.find((pkg) => pkg.id === custom.basePackageId) ?? null : null;
  const offerBlocked = customFailed ? 'Layanan custom belum termuat' : custom && customStatus !== 'agreed' ? 'Sepakati harga custom dulu' : null;
  // CS yang bukan PIC hanya membaca profil; server juga menolak perubahannya.
  const locked = Boolean(p) && !canEditProspect(user, p);
  // Finance: prospek hanya-baca, kecuali tindakan pembayaran (unggah bukti, verifikasi).
  const financeView = user?.role === 'finance';
  const [showHandover, setShowHandover] = useState(false);

  const autosave = useProfileAutosave({
    prospectId,
    brandId,
    source: p,
    onSaved: (result) => {
      if (result?.status === 'qualified' && p?.status !== 'qualified') onShowToast('Prospek naik ke Terkualifikasi');
    },
  });
  const form = autosave.form;
  // Pilihan tersimpan segera; ketikan (nama, catatan, angka jamaah) menunggu jeda singkat.
  const updateFormField = (key: string, value: any, delay = 0) => { if (!locked) autosave.change({ [key]: value }, delay); };
  const updateFormFields = (patch: Record<string, any>) => {
    if (!locked) autosave.change(patch, Object.keys(patch).some((key) => key.startsWith('pax')) ? 600 : 0);
  };

  const selectedPackage = useMemo(() => {
    return packages.find((pkg) => pkg.id === p?.packageId) ?? null;
  }, [packages, p?.packageId]);
  const formPax = { paxQuad: Number(form.paxQuad), paxTriple: Number(form.paxTriple), paxDouble: Number(form.paxDouble), paxInfant: Number(form.paxInfant) };

  // Satu sumber untuk seluruh panel: isian di layar (langsung tersimpan), bukan campuran tersimpan/draft.
  const formMissing = qualificationMissing({ ...form, ...formPax });
  const isQualified = isQualificationComplete({ ...form, ...formPax });
  const offeredPackage = packages.find((pkg) => pkg.id === p?.packageId) ?? null;
  const isOfferOutdated = !custom && Boolean(p) && offerOutdated(p, offeredPackage);

  const packageMutation = useMutation({
    mutationFn: (packageId: number) => api.patch<any>(`/prospects/${prospectId}/profile`, { packageId, brandId }),
    onSuccess: (res: any) => {
      queryClient.setQueryData(['prospect', prospectId, brandId], res);
      void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      onShowToast(`Paket dihubungkan: ${packages.find((pkg) => pkg.id === res?.packageId)?.name ?? 'paket'}`);
    },
    onError: (err: any) => onShowToast(err?.message || 'Paket gagal dihubungkan.'),
  });

  const claimPicMutation = useMutation({
    mutationFn: () => api.post(`/prospects/${prospectId}/claim`, { brandId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospectId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
      onShowToast('Anda berhasil menjadi PIC prospek ini!');
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Gagal mengklaim PIC');
    },
  });

  async function handleCopyPhone() {
    const raw = form.phone || p?.phone || '';
    if (!raw) return;
    try { await navigator.clipboard.writeText(raw); } catch { onShowToast('Nomor tidak dapat disalin. Silakan coba lagi.'); return; }
    setCopiedPhone(true);
    onShowToast('Nomor WhatsApp disalin');
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  function handleSendPackageFormat() {
    if (!selectedPackage) {
      onShowToast('Hubungkan paket umroh terlebih dahulu');
      return;
    }
    const travelName = activeBrand?.name || 'Layanan Resmi Umroh';
    const text = formatWaPackageSummary(selectedPackage, travelName);
    onInsertText(text);
    onShowToast(`Format rincian paket ${selectedPackage.name} disisipkan ke pesan`);
  }

  function handleSendItinerary() {
    if (!selectedPackage) {
      onShowToast('Hubungkan paket umroh terlebih dahulu');
      return;
    }
    if (!selectedPackage.itinerary) { onShowToast('Itinerary belum tersedia di katalog.'); return; }
    onInsertText(formatWaPackageItinerary(selectedPackage, activeBrand?.name));
  }

  const photoFor = useWhatsAppAvatars(p ? [p] : undefined, p?.brandId);

  if (prospectQuery.isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-zinc-500">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00a884] border-t-transparent mb-3" />
        <span>Memuat profil prospek...</span>
      </div>
    );
  }

  if (prospectQuery.isError || !p) return <div className="p-4 space-y-3" role="alert"><p className="text-sm">Profil tidak dapat dimuat. Draft tetap tersedia.</p><Button variant="secondary" onClick={() => void prospectQuery.refetch()}>Coba lagi</Button></div>;
  const won = ['deal', 'closed_won'].includes(p.status);
  const financialRole = ['finance', 'admin', 'superadmin'].includes(user?.role || '');
  // Penolakan Finance terakhir: tampil sampai ada bukti baru (alasan tidak hanya di notifikasi).
  const lastRejection = p.proofRejections?.[0] as { reason: string; createdAt: string; rejectedBy?: { name: string } | null } | undefined;
  const proofRejected = lastRejection && !p.paymentProofUrl && !won && !['lose', 'closed_lost'].includes(p.status)
    && (!p.invoiceSentAt || new Date(lastRejection.createdAt) >= new Date(p.invoiceSentAt)) ? lastRejection : null;
  function openAction(setter: (open: boolean) => void, payment = false) {
    if (locked && !(payment && financeView)) { onShowToast(readOnlyNote(user, p)); return; }
    setter(true);
  }
  const isPic = Boolean(p?.userId && p.userId === user?.id);
  const isUnassigned = !p?.userId;
  const lost = p.status === 'lose' || p.status === 'closed_lost';
  const multiBrand = isHoldingRole(user?.role) || assignedBrandIds(user).length > 1;
  const today = businessDateKey();
  const followup = form.nextFollowupDate || null;
  const followupLate = Boolean(followup && followup < today);
  const followupLabel = followup
    ? `${followupLate ? 'Terlambat ' : 'Follow-up '}${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${followup}T00:00:00Z`))}`
    : 'Follow-up';
  // Posisi prospek dalam proses: orientasi, bukan tombol. Aksi menempel pada konteksnya (tab Paket).
  const STAGES = ['Terhubung', 'Terkualifikasi', 'Ditawarkan', 'Tunggu verifikasi', 'Deal'] as const;
  const stageIndex = won ? 5
    : p.status === 'closing' ? 4
      : ['offer', 'offered', 'objection', 'followup', 'nurture'].includes(p.status) ? 3
        : p.status === 'qualified' ? 2
          : ['contact', 'identifying'].includes(p.status) ? 1 : 0;
  // Layanan custom yang belum disepakati menentukan langkah berikutnya di tahap mana pun sebelum invoice.
  const customNext = customStatus === 'submitted' || customStatus === 'revision_requested' ? 'Berikutnya: tunggu hitungan Tim LA'
    : customStatus === 'needs_info' ? 'Berikutnya: lengkapi permintaan custom'
      : customStatus === 'quoted' ? 'Berikutnya: sepakati harga custom'
        : customStatus === 'expired' ? 'Berikutnya: minta hitung ulang' : null;
  const nextText = won ? 'Deal · penanganan CS selesai'
    : stageIndex === 0 ? 'Berikutnya: balas chat'
      : stageIndex === 1 ? 'Berikutnya: lengkapi kualifikasi'
        : (stageIndex === 2 || stageIndex === 3) && customNext ? customNext
          : stageIndex === 2 ? 'Berikutnya: kirim penawaran'
            : stageIndex === 3 ? (p.status === 'objection' ? 'Berikutnya: jawab keberatan' : 'Berikutnya: kirim invoice')
              : p.paymentProofUrl ? 'Menunggu verifikasi Finance' : 'Berikutnya: bukti transfer';

  type StageAction = { label: string; icon: typeof FileCheck; onClick: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' };
  const stageAction: { hint?: string; warn?: boolean; primary?: StageAction; secondary?: StageAction } | null = (() => {
    if (won || lost || customFailed) return null;
    if (locked && !(financeView && stageIndex === 4)) return null;
    if (stageIndex <= 1) {
      return stageIndex === 1
        ? { primary: { label: 'Lengkapi kualifikasi', icon: UserCheck, variant: 'secondary', onClick: () => setActiveTab('qualification') } }
        : null;
    }
    if (stageIndex === 4) {
      const invoice = `${p.invoiceNumber || 'Invoice'} · ${rupiah(p.invoiceAmount || 0)}`;
      if (p.paymentProofUrl && !financialRole) return { hint: `${invoice} · bukti di Finance` };
      if (p.paymentProofUrl) return { hint: invoice, primary: { label: 'Verifikasi pembayaran', icon: ShieldCheck, onClick: () => openAction(setShowFinanceVerifyModal, true) } };
      return { hint: invoice, primary: { label: 'Unggah bukti transfer', icon: UploadCloud, onClick: () => openAction(setShowPaymentProofModal, true) } };
    }
    // Layanan custom: aksi tahap baru tersedia setelah nilai deal disepakati (status ada di kartu custom).
    if (custom) { if (customStatus !== 'agreed') return null; } else if (!selectedPackage) return { hint: 'Pilih paket untuk penawaran.' };
    const offer: StageAction = { label: p.offerSentAt ? 'Kirim ulang penawaran' : 'Kirim penawaran', icon: FileCheck, onClick: () => openAction(setShowOfferModal), disabled: !connected };
    if (stageIndex === 2) return { primary: offer };
    if (isOfferOutdated) {
      return { hint: 'Jamaah atau paket berubah sejak penawaran.', warn: true, primary: offer, secondary: { label: 'Kirim invoice', icon: CreditCard, onClick: () => openAction(setShowInvoiceModal) } };
    }
    if (p.status === 'objection') {
      return {
        hint: [objectionLabel(p.objectionCategory), p.objectionNotes].filter(Boolean).join(' · '),
        primary: { label: 'Bantu jawab keberatan', icon: AlertCircle, onClick: () => onOpenCopilot?.() },
        secondary: { label: 'Kirim invoice', icon: CreditCard, onClick: () => openAction(setShowInvoiceModal) },
      };
    }
    return { primary: { label: 'Kirim invoice', icon: CreditCard, onClick: () => openAction(setShowInvoiceModal) }, secondary: { ...offer, label: 'Kirim ulang penawaran' } };
  })();
  const stageFooter = stageAction && (stageAction.hint || stageAction.primary) ? (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-zinc-100 pt-3">
      {stageAction.hint && <p className={cn('mr-auto min-w-0 text-xs', stageAction.warn ? 'text-amber-800' : 'text-zinc-600')}>{stageAction.hint}</p>}
      {stageAction.secondary && (
        <button type="button" disabled={stageAction.secondary.disabled} onClick={stageAction.secondary.onClick} className="text-xs font-semibold text-zinc-700 hover:text-zinc-950 hover:underline">
          {stageAction.secondary.label}
        </button>
      )}
      {stageAction.primary && (
        <Button size="sm" variant={stageAction.primary.variant ?? 'primary'} disabled={stageAction.primary.disabled} onClick={stageAction.primary.onClick} icon={<stageAction.primary.icon size={14} />}>
          {stageAction.primary.label}
        </Button>
      )}
    </div>
  ) : null;

  const paymentItems = [
    { label: 'Unggah bukti transfer', icon: UploadCloud, onClick: () => openAction(setShowPaymentProofModal, true) },
    ...(financialRole ? [{ label: 'Verifikasi pembayaran', icon: ShieldCheck, onClick: () => openAction(setShowFinanceVerifyModal, true) }] : []),
  ];
  const menuItems: { label: string; icon: typeof FileCheck; onClick: () => void; disabled?: boolean; hint?: string | null }[] = financeView ? paymentItems : [
    { label: 'Catat keberatan', icon: AlertCircle, onClick: () => openAction(setShowObjectionModal) },
    { label: 'Kirim penawaran', icon: FileCheck, onClick: () => openAction(setShowOfferModal), disabled: !connected || Boolean(offerBlocked), hint: offerBlocked },
    { label: 'Kirim invoice', icon: CreditCard, onClick: () => openAction(setShowInvoiceModal), disabled: Boolean(offerBlocked), hint: offerBlocked },
    ...paymentItems,
    ...(user?.role === 'cs' && isPic ? [{ label: 'Serahkan ke CS lain', icon: UserPlus2, onClick: () => setShowHandover(true) }] : []),
  ];

  return (
    <div className="sales-panel flex flex-col h-full overflow-hidden bg-white text-zinc-800">
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
      {/* Tahap prospek: di mana prospek sekarang dan apa berikutnya. Tanpa tombol besar. */}
      <section aria-label="Tahap prospek" className="space-y-2 border-b border-zinc-200 px-4 py-3">
        {locked && <p role="note" className="text-xs text-zinc-600">Hanya baca: {financeView ? readOnlyNote(user, p) : `ditangani ${p.user?.name ?? 'CS lain'}.`}</p>}
        {!connected && <p className="text-xs text-amber-800">WhatsApp terputus{locked ? '.' : '; profil tetap bisa diubah.'}</p>}
        <div className="flex items-center gap-2 text-xs">
          {lost ? (
            <p className="flex-1 text-zinc-700"><b className="font-semibold text-rose-700">Tidak jadi</b>{p?.lostReason ? ` · ${p.lostReason}` : ''}</p>
          ) : (
            <p className="flex-1 text-zinc-600">
              <b className="font-semibold tabular-nums text-zinc-900">{stageIndex}/5</b> · {won ? <>{nextText} · <b className="font-semibold text-emerald-800">{rupiah(p?.dealValue || 0)}</b></> : nextText}
            </p>
          )}
          {!won && !lost && (!locked || financeView) && (
            <div className="relative" onKeyDown={(event) => { if (event.key === 'Escape') setShowMoreActions(false); }}>
              <button
                type="button"
                onClick={() => setShowMoreActions((prev) => !prev)}
                aria-expanded={showMoreActions} aria-label="Tindakan lainnya"
                className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              >
                <MoreHorizontal size={15} />
              </button>
              {showMoreActions && (
                <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-zinc-200 bg-white p-1 text-xs shadow-lg" onClick={() => setShowMoreActions(false)}>
                  {menuItems.map(({ label, icon: Icon, onClick, disabled, hint }) => (
                    <button key={label} type="button" disabled={disabled} onClick={onClick} className="flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left font-medium text-zinc-700 hover:bg-zinc-100 disabled:text-zinc-400">
                      <Icon size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{label}{hint && <span className="block text-xs font-normal text-zinc-500">{hint}</span>}</span>
                    </button>
                  ))}
                  {/* Aksi yang mengakhiri prospek dipisah dari aksi biasa. */}
                  {!financeView && <>
                    <div className="my-1 border-t border-zinc-100" />
                    <button type="button" onClick={() => openAction(setShowLostModal)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-medium text-rose-700 hover:bg-rose-50">
                      <Ban size={13} aria-hidden="true" />Tandai tidak jadi
                    </button>
                  </>}
                </div>
              )}
            </div>
          )}
        </div>
        {proofRejected && (
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <b className="font-semibold">Bukti transfer ditolak Finance</b> · {sinceLabel(proofRejected.createdAt)} lalu{proofRejected.rejectedBy?.name ? ` oleh ${proofRejected.rejectedBy.name}` : ''}
            <span className="mt-0.5 block">Alasan: {proofRejected.reason}. Minta bukti yang benar ke jamaah.</span>
          </p>
        )}
        {!lost && (
          <ol aria-label={`Tahap ${stageIndex} dari 5`} className="flex gap-1">
            {STAGES.map((stage, index) => (
              <li key={stage} className={cn('h-1 flex-1 rounded-full', index < stageIndex ? (won ? 'bg-emerald-600' : 'bg-zinc-900') : 'bg-zinc-200')}>
                <span className="sr-only">{stage}{index < stageIndex ? ' (tercapai)' : ''}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 4. Tab Content Area (Scrollable & Clean) */}
      <div className="px-4 py-3">
        {/* ================= TAB 1: PAKET ================= */}
        {activeTab === 'package' && customFailed && (
          <div role="alert" className="space-y-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <p><b className="font-semibold">Layanan custom tidak dapat dimuat.</b> Penawaran dan invoice ditahan sampai datanya termuat.</p>
            <Button size="sm" variant="secondary" onClick={() => void customQuery.refetch()}>Coba lagi</Button>
          </div>
        )}
        {activeTab === 'package' && custom && (
          <CustomRequestPanel request={custom} prospectId={prospectId} readOnly={won || lost || locked} proofSubmitted={Boolean(p.paymentProofUrl)}
            baseActions={customBase ? {
              name: customBase.name,
              onSendFlyer: customBase.flyerImage && connected ? () => onSendFlyer(customBase) : undefined,
              onInsertItinerary: customBase.itinerary ? () => onInsertText(formatWaPackageItinerary(customBase, activeBrand?.name)) : undefined,
            } : undefined}
            progress={{ offerSent: Boolean(p.offerSentAt), invoiceSent: Boolean(p.invoiceSentAt && Number(p.invoiceAmount) > 0), won }}
            onEdit={() => setShowCustomForm(true)} onShowToast={onShowToast} footer={stageFooter} />
        )}
        {activeTab === 'package' && !custom && !customFailed && (<>
          <ProspectPackageTab
            packages={packages}
            selected={selectedPackage}
            qualification={{ targetMonth: form.targetMonth, budgetRange: form.budgetRange, passportStatus: form.passportStatus, ...formPax }}
            locked={won || locked}
            saving={packageMutation.isPending}
            connected={connected}
            onSelect={(packageId) => packageMutation.mutate(packageId)}
            onSendFlyer={onSendFlyer}
            onInsertSummary={handleSendPackageFormat}
            onInsertItinerary={handleSendItinerary}
            onOpenGallery={onOpenPackagePicker}
            onOpenQualification={() => setActiveTab('qualification')}
            onPreviewImage={onPreviewImage}
            footer={stageFooter}
          />
          {!won && !lost && !locked && !customQuery.isLoading && (
            <button type="button" onClick={() => setShowCustomForm(true)}
              className="mt-4 w-full rounded-lg border border-dashed border-zinc-300 px-3 py-2.5 text-left text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900">
              <b className="block font-semibold text-zinc-900">Kebutuhan khusus jamaah?</b>
              Buat layanan custom: Tim LA menghitung harga sesuai permintaan.
            </button>
          )}
        </>)}

        {/* ================= TAB 2: KUALIFIKASI ================= */}
        {activeTab === 'qualification' && (
          <div className="space-y-4">
            {!won && <QualificationPrompts
              key={`${brandId}:${prospectId}`}
              value={p}
              brandId={brandId}
              prospectId={prospectId}
              revision={p?.updatedAt}
              packageId={p?.packageId}
              query={query}
              disabled={locked}
              onInsertText={onInsertText}
            />}
            <QualificationFields
              value={{
                targetMonth: form.targetMonth, budgetRange: form.budgetRange, passportStatus: form.passportStatus,
                paxQuad: Number(form.paxQuad), paxTriple: Number(form.paxTriple), paxDouble: Number(form.paxDouble), paxInfant: Number(form.paxInfant),
              }}
              onChange={(patch) => updateFormFields(patch)}
              disabled={locked}
              bookingLocked={won || Boolean(custom)}
              bookingLockedReason={custom && !won ? 'Diatur di Layanan Custom (tab Paket).' : undefined}
              departure={selectedPackage?.departureDate ? new Date(selectedPackage.departureDate) : null}
            />
          </div>
        )}

        {/* ================= TAB 4: RIWAYAT ================= */}
        {activeTab === 'history' && <ProspectTimeline prospectId={prospectId} brandId={brandId} />}

        {/* ================= TAB 3: CATATAN & JADWAL ================= */}
        {activeTab === 'notes' && (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-zinc-600">Nama jamaah</span>
              <input
                type="text"
                value={form.name}
                readOnly={locked}
                onChange={(e) => updateFormField('name', e.target.value, 1000)}
                onBlur={() => void autosave.flush()}
                aria-label="Nama prospek"
                className="field"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-zinc-600">Follow-up berikutnya</span>
              <input
                aria-label="Tanggal follow-up (WIB)"
                type="date"
                value={form.nextFollowupDate}
                disabled={won || locked} onChange={(e) => updateFormField('nextFollowupDate', e.target.value)}
                className="field"
              />
              {followupLate && !won && !lost && <span className="mt-1 block text-xs text-amber-800">Terlambat sejak {followupLabel.replace('Terlambat ', '')}</span>}
            </label>
            <div className="border-t border-zinc-100 pt-3">
              <ProspectNotes prospectId={prospectId} brandId={brandId}
                disabledReason={won ? 'Penanganan CS selesai pada Deal.' : locked ? (financeView ? 'Finance tidak menambah catatan prospek.' : 'Hanya PIC yang dapat menambah catatan.') : null} />
            </div>
            {p?.paymentProofUrl && (
              <div className="flex items-center gap-2 border-t border-zinc-100 pt-3 text-xs">
                <PrivateProofThumb url={p.paymentProofUrl} />
                <span><b className="font-semibold text-zinc-900">Bukti transfer</b> · {won ? 'terverifikasi' : 'menunggu Finance'}</span>
              </div>
            )}
          </div>
        )}
      </div>

      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-zinc-200 px-4 py-2 text-xs" aria-live="polite">
        {autosave.state === 'error' ? (
          <p role="alert" className="min-w-0 flex-1 text-rose-700">
            {autosave.error}{' '}
            <button type="button" onClick={autosave.retry} className="font-semibold underline">Coba lagi</button>
          </p>
        ) : (
          <span className="flex-1 text-zinc-500">
            {autosave.state === 'saving' && 'Menyimpan…'}
            {autosave.state === 'saved' && <span className="inline-flex items-center gap-1 text-emerald-800"><Check size={12} aria-hidden="true" />Tersimpan</span>}
          </span>
        )}
        <Link to={`/prospects/${prospectId}`} className="inline-flex shrink-0 items-center gap-1 font-semibold text-zinc-600 hover:text-zinc-950">
          Detail prospek<ExternalLink size={11} aria-hidden="true" />
        </Link>
      </footer>

      {/* Action Modals */}
      {p && (
        <>
          {showQualifyModal && (          <QualificationModal
            open={showQualifyModal}
            onClose={() => setShowQualifyModal(false)}
            prospect={p}
            brandId={brandId}
            packages={packages}
            onShowToast={onShowToast}
          />)}

          {showHandover && (
            <PicDialog
              mode="handover"
              prospect={{ id: p.id, name: p.name, brandId: p.brandId, userId: p.userId }}
              onDone={(message) => { onShowToast(message); setShowHandover(false); }}
              onClose={() => setShowHandover(false)}
            />
          )}
          {showOfferModal && (          <OfficialOfferModal
            custom={customStatus === 'agreed' ? custom : null}
            open={showOfferModal}
            onClose={() => setShowOfferModal(false)}
            prospect={p}
            packages={packages}
            brandId={brandId}
            onInsertText={onInsertText}
            onShowToast={onShowToast}
          />)}

          {showObjectionModal && (          <ObjectionModal
            open={showObjectionModal}
            onClose={() => setShowObjectionModal(false)}
            prospect={p}
            brandId={brandId}
            onShowToast={onShowToast}
          />)}

          {showCustomForm && (
            <CustomRequestForm open onClose={() => setShowCustomForm(false)} prospectId={prospectId} brandId={brandId}
              existing={custom} packages={packages} onSaved={onShowToast}
              openInvoice={p.invoiceSentAt && Number(p.invoiceAmount) > 0 ? p.invoiceNumber ?? 'yang terkirim' : null}
              initial={custom ? customToInput(custom) : { ...emptyCustomInput(formPax), basePackageId: selectedPackage?.id ?? null }} />
          )}

          {!won && showInvoiceModal && (          <OfficialInvoiceModal
            custom={customStatus === 'agreed' ? custom : null}
            open={showInvoiceModal}
            onClose={() => setShowInvoiceModal(false)}
            prospect={p}
            packages={packages}
            brandId={brandId}
            onInsertText={onInsertText}
            onShowToast={onShowToast}
          />)}

          {!won && showPaymentProofModal && (          <PaymentProofModal
            open={showPaymentProofModal}
            onClose={() => setShowPaymentProofModal(false)}
            prospect={p}
            brandId={brandId}
            onShowToast={onShowToast}
          />)}

          {!won && showFinanceVerifyModal && (          <FinanceVerifyModal
            open={showFinanceVerifyModal}
            onClose={() => setShowFinanceVerifyModal(false)}
            prospect={p}
            brandId={brandId}
            onShowToast={onShowToast}
          />)}

          {showLostModal && (          <LostReasonModal
            open={showLostModal}
            onClose={() => setShowLostModal(false)}
            prospect={p}
            brandId={brandId}
            onShowToast={onShowToast}
          />)}
        </>
      )}
    </div>
  );
}

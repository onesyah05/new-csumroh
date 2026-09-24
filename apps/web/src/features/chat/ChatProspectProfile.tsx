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
  FileText,
  ImageIcon,
  Luggage,
  MoreHorizontal,
  NotebookPen,
  Phone,
  Plane,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Undo2,
  UploadCloud,
  UserCheck,
  UserPlus2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  calculateDealValue,
  pipelineStatuses,
  type ProspectStatus,
} from '@csumroh/shared-types';
import { api, resolveMediaUrl } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useAuth } from '../../app/auth';
import { queryClient } from '../../app/query';
import { Badge, statusLabels } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { useProfileDraft, validateProfile } from './profileDraft';
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
import { PicDialog, isLockedForCs } from '../prospects/PicDialog';

const n = (value: unknown) => Number(String(value ?? 0).replace(/\D/g, '')) || 0;
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
}

type ProfileTab = 'package' | 'qualification' | 'notes';

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
}: ChatProspectProfileProps) {
  const { user } = useAuth();
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>('package');
  const [showMoreActions, setShowMoreActions] = useState(false);

  // Modal dialog states for action-driven pipeline transitions
  const [showQualifyModal, setShowQualifyModal] = useState(false);
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [showObjectionModal, setShowObjectionModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showPaymentProofModal, setShowPaymentProofModal] = useState(false);
  const [showFinanceVerifyModal, setShowFinanceVerifyModal] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);

  const [saveError, setSaveError] = useState<string | null>(null);
  // Fetch complete prospect data
  const prospectQuery = useQuery({
    queryKey: ['prospect', prospectId, brandId],
    queryFn: () => api.get<any>(`/prospects/${prospectId}${query}`),
    enabled: !!prospectId && !!brandId,
  });

  const p = prospectQuery.data;
  // CS yang bukan PIC hanya membaca profil; server juga menolak perubahannya.
  const locked = Boolean(p) && isLockedForCs(user, p);
  const [showHandover, setShowHandover] = useState(false);

  const draft = useProfileDraft(`${user?.id}:${brandId}:${prospectId}`, p);
  const form = draft.form;
  const isDirty = draft.dirty;
  const updateFormField = (key: string, value: any) => { if (locked) return; setSaveError(null); draft.update({ [key]: value }); };
  const updateFormFields = (patch: Record<string, any>) => { if (locked) return; setSaveError(null); draft.update(patch); };
  const handleResetForm = () => { draft.clear(); setSaveError(null); };

  const selectedPackage = useMemo(() => {
    return packages.find((pkg) => String(pkg.id) === form.packageId) ?? null;
  }, [packages, form.packageId]);

  const dealValue = useMemo(() => {
    return calculateDealValue(
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
    );
  }, [form.paxQuad, form.paxTriple, form.paxDouble, form.paxInfant, selectedPackage]);

  const isQualified = Boolean(
    p?.targetMonth &&
    p?.roomPreference &&
    (Number(p?.paxQuad || 0) + Number(p?.paxTriple || 0) + Number(p?.paxDouble || 0) + Number(p?.paxInfant || 0)) > 0
  );

  const [isChangingPackage, setIsChangingPackage] = useState(false);

  function handleSelectPackage(value: string) {
    updateFormField('packageId', value === 'none' ? '' : value);
    setIsChangingPackage(false);
  }

  // Mutations: cleanly sends only profiling fields to avoid 403 financial guard (A04)
  const saveProfileMutation = useMutation({
    mutationFn: () => {
      const invalid = validateProfile(form);
      if (invalid) throw new Error(invalid);
      const payload: any = {
        name: form.name,
        phone: form.phone,
        city: form.city,
        targetMonth: form.targetMonth,
        budgetRange: form.budgetRange,
        roomPreference: form.roomPreference,
        decisionMaker: form.decisionMaker,
        specialNeeds: form.specialNeeds,
        passportStatus: form.passportStatus,
        vaccineStatus: form.vaccineStatus,
        paxQuad: Number(form.paxQuad || 0),
        paxTriple: Number(form.paxTriple || 0),
        paxDouble: Number(form.paxDouble || 0),
        paxInfant: Number(form.paxInfant || 0),
        notes: form.notes,
        nextFollowupDate: form.nextFollowupDate ? `${form.nextFollowupDate}T00:00:00.000Z` : null,
        packageId: form.packageId ? Number(form.packageId) : null,
        brandId,
      };
      return api.patch(`/prospects/${prospectId}/profile`, payload);
    },
    onSuccess: (res: any) => {
      queryClient.setQueryData(['prospect', prospectId, brandId], res);
      draft.clear();
      setSaveError(null);
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospectId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      if (res?.status === 'qualified' && p?.status !== 'qualified') {
        onShowToast('Profil disimpan & otomatis naik ke Terkualifikasi!');
      } else {
        onShowToast('Profil prospek berhasil disimpan!');
      }
    },
    onError: (err: any) => {
      setSaveError(err?.message || 'Gagal menyimpan profil prospek');
    },
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
  function openAction(setter: (open: boolean) => void) {
    if (locked) { setSaveError(`Prospek ini ditangani ${p?.user?.name ?? 'CS lain'}. Hanya PIC atau Admin yang dapat mengubahnya.`); return; }
    if (isDirty) { setSaveError('Simpan atau buang draft profil sebelum melanjutkan tindakan.'); return; }
    setter(true);
  }
  const isPic = Boolean(p?.userId && p.userId === user?.id);
  const isUnassigned = !p?.userId;


  return (
    <div className="sales-panel flex flex-col h-full overflow-hidden bg-white text-zinc-800">
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
      {/* 1. Header Ringkas: Nama, Phone, PIC & Status Badge */}
      <div className="shrink-0 bg-white border-b border-zinc-200/80 px-4 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <ProspectAvatar photoUrl={photoFor(p ?? {})} size="md" />
            <div className="min-w-0">
              <input
                type="text"
                value={form.name}
                disabled={saveProfileMutation.isPending} onChange={(e) => updateFormField('name', e.target.value)}
                aria-label="Nama prospek" placeholder="Nama Prospek"
                className="font-semibold text-xs text-zinc-900 bg-transparent border-b border-transparent hover:border-zinc-300 focus:border-[#00a884] outline-none transition py-0.5 truncate w-full"
                title="Klik untuk mengubah nama prospek"
              />
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <span className="tabular-nums text-xs truncate">{form.phone || p?.phone || '-'}</span>
                {form.phone && (
                  <Button variant="ghost"
                    type="button"
                    onClick={handleCopyPhone}
                    className="text-zinc-500 hover:text-zinc-800 transition cursor-pointer"
                    title="Salin nomor WhatsApp"
                  >
                    {copiedPhone ? <Check size={11} className="text-[#00a884]" /> : <Copy size={11} />}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              {isDirty && (
                <Button variant="ghost"
                  type="button"
                  onClick={handleResetForm}
                  className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded-full cursor-pointer transition shadow-2xs"
                  title="Batalkan perubahan yang belum disimpan"
                >
                  <Undo2 size={10} />
                  <span>Buang draft</span>
                </Button>
              )}
              <Badge value={p?.status || 'new'} />
            </div>
            <div className="flex items-center gap-1 text-xs text-zinc-500">
              <CircleUserRound size={11} className="text-zinc-500" />
              <span className="truncate max-w-[90px]">
                {p?.user?.name ? (isPic ? 'Anda' : p.user.name) : 'Belum Ada PIC'}
              </span>
              {user?.role === 'cs' && isPic && (
                <Button variant="ghost"
                  type="button"
                  onClick={() => setShowHandover(true)}
                  className="font-semibold text-zinc-800 hover:underline cursor-pointer ml-0.5"
                  title="Serahkan prospek ini ke CS lain"
                >
                  Serahkan
                </Button>
              )}
              {user?.role === 'cs' && isUnassigned && !['deal', 'closed_won', 'lose', 'closed_lost'].includes(p.status) && (
                <Button variant="ghost"
                  type="button"
                  onClick={() => claimPicMutation.mutate()}
                  disabled={claimPicMutation.isPending}
                  className="font-semibold text-emerald-700 hover:underline cursor-pointer ml-0.5"
                >
                  Klaim
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-2 text-xs text-zinc-600 border-b border-zinc-200">{activeBrand?.name || p.brand?.name || 'Brand aktif'}{!connected && <p className="mt-1 text-amber-800">WhatsApp terputus. Anda tetap dapat mengerjakan profil dan draft.</p>}</div>
      {locked && (
        <p role="note" className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-700">
          Ditangani <strong>{p.user?.name ?? 'CS lain'}</strong>. Anda hanya dapat membaca profil ini; perubahan dilakukan oleh PIC atau Admin.
        </p>
      )}
      {/* 2. Contextual Next Action Card */}
      <div className="shrink-0 px-3 pt-2 pb-2.5 bg-white border-b border-zinc-200/80">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-2.5 shadow-2xs space-y-2">
          {/* Stage pill */}
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold  text-zinc-500">Aksi Selanjutnya</span>
            <span className="tabular-nums text-zinc-500">{statusLabels[p.status] || p.status}</span>
          </div>

          {p?.status === 'new' && (
            <div className="flex items-start gap-2 rounded-lg bg-zinc-100 border border-zinc-200 px-2.5 py-2 text-xs text-zinc-600">
              <span className="text-base leading-none mt-0.5">💬</span>
              <span>Kirim pesan sapaan di kolom chat. Status otomatis berubah ke <strong>Kontak</strong> setelah pesan pertama terkirim.</span>
            </div>
          )}

          {p?.status === 'contact' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-600 font-medium">Syarat Terkualifikasi:</span>
                <span className={cn(
                  "text-xs font-semibold px-2 py-0.5 rounded-full border",
                  isQualified
                    ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                    : "text-amber-800 bg-amber-50 border-amber-200"
                )}>
                  {!form.roomPreference ? 'Pilih Kamar' : !form.targetMonth ? 'Isi Target Bulan' : (Number(form.paxQuad || 0) + Number(form.paxTriple || 0) + Number(form.paxDouble || 0) + Number(form.paxInfant || 0)) === 0 ? 'Isi Pax' : 'Siap Simpan'}
                </span>
              </div>

              {/* Mini Status Checklist */}
              <div className="grid grid-cols-3 gap-1.5 text-xs">
                <div
                  className={cn(
                    'flex items-center justify-center gap-1 rounded-lg px-1.5 py-1 border font-medium transition',
                    form.targetMonth ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-zinc-100 border-zinc-200 text-zinc-500'
                  )}
                  title={form.targetMonth ? `Target: ${form.targetMonth}` : 'Target Bulan belum diisi'}
                >
                  {form.targetMonth ? <Check size={12} className="text-emerald-600 shrink-0" /> : <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 shrink-0" />}
                  <span className="truncate">Bulan</span>
                </div>

                <div
                  className={cn(
                    'flex items-center justify-center gap-1 rounded-lg px-1.5 py-1 border font-medium transition',
                    form.roomPreference ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800 font-semibold'
                  )}
                  title={form.roomPreference ? `Kamar: ${form.roomPreference}` : 'Tipe Kamar belum dipilih'}
                >
                  {form.roomPreference ? <Check size={12} className="text-emerald-600 shrink-0" /> : <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />}
                  <span className="truncate">Kamar</span>
                </div>

                <div
                  className={cn(
                    'flex items-center justify-center gap-1 rounded-lg px-1.5 py-1 border font-medium transition',
                    (Number(form.paxQuad || 0) + Number(form.paxTriple || 0) + Number(form.paxDouble || 0) + Number(form.paxInfant || 0)) > 0
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-zinc-100 border-zinc-200 text-zinc-500'
                  )}
                  title={`Total Pax: ${Number(form.paxQuad || 0) + Number(form.paxTriple || 0) + Number(form.paxDouble || 0) + Number(form.paxInfant || 0)}`}
                >
                  {(Number(form.paxQuad || 0) + Number(form.paxTriple || 0) + Number(form.paxDouble || 0) + Number(form.paxInfant || 0)) > 0 ? (
                    <Check size={12} className="text-emerald-600 shrink-0" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 shrink-0" />
                  )}
                  <span className="truncate">
                    Pax ({Number(form.paxQuad || 0) + Number(form.paxTriple || 0) + Number(form.paxDouble || 0) + Number(form.paxInfant || 0)})
                  </span>
                </div>
              </div>

              {activeTab !== 'qualification' && (
                <Button variant="ghost"
                  type="button"
                  onClick={() => setActiveTab('qualification')}
                  className="w-full text-center pt-0.5 text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
                >
                  Isi di tab Kualifikasi ↓
                </Button>
              )}
            </div>
          )}

          {p?.status === 'qualified' && isQualified && (
            <Button variant="ghost"
              type="button"
              disabled={won || !connected} onClick={() => openAction(setShowOfferModal)}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 py-2 px-3 text-xs font-semibold text-white transition shadow-xs cursor-pointer"
            >
              <FileCheck size={14} />
              <span>Tinjau penawaran</span>
            </Button>
          )}

          {['offer', 'offered', 'followup', 'nurture'].includes(p?.status) && (
            <Button variant="ghost"
              type="button"
              onClick={() => setActiveTab('notes')}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 py-2 px-3 text-xs font-semibold text-white transition shadow-xs cursor-pointer"
            >
              <CreditCard size={14} />
              <span>Jadwalkan follow-up</span>
            </Button>
          )}

          {p?.status === 'objection' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5 text-xs">
                <AlertCircle size={12} className="text-amber-600 shrink-0" />
                <span className="font-semibold text-amber-900 truncate">{p?.objectionCategory || 'Keberatan'}</span>
                {p?.objectionNotes && <span className="text-zinc-500 truncate text-xs italic">{p.objectionNotes}</span>}
              </div>
              <Button variant="ghost"
                type="button"
                onClick={onOpenCopilot}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 py-2 px-3 text-xs font-semibold text-white transition shadow-xs cursor-pointer"
              >
                <AlertCircle size={14} />
                <span>Bantu jawab keberatan</span>
              </Button>
            </div>
          )}

          {p?.status === 'closing' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-900">
                <span>{p?.invoiceNumber || 'Invoice DP'}</span>
                <span className="text-blue-700">{rupiah(p?.invoiceAmount || 0)}</span>
              </div>
              <Button variant="ghost"
                type="button"
                onClick={() => p.paymentProofUrl ? (financialRole ? openAction(setShowFinanceVerifyModal) : setActiveTab('notes')) : openAction(setShowPaymentProofModal)}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 py-2 px-3 text-xs font-semibold text-white transition shadow-xs cursor-pointer"
              >
                <UploadCloud size={14} />
                <span>{p.paymentProofUrl ? (financialRole ? 'Tinjau bukti pembayaran' : 'Lihat pembayaran') : 'Unggah bukti transfer'}</span>
              </Button>
            </div>
          )}

          {p?.status === 'deal' && (
            <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-xs">
              <span className="font-semibold text-emerald-900">🎉 Deal Closed</span>
              <span className="font-semibold text-emerald-700" title="Kas terverifikasi / nilai booking">
                {rupiah(p?.dpAmount || 0)} / {rupiah(p?.dealValue || 0)}
              </span>
            </div>
          )}

          {(p?.status === 'lose' || p?.status === 'closed_lost') && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1.5 text-xs">
              <Ban size={13} className="text-rose-600 shrink-0" />
              <span className="font-semibold text-rose-900">Batal</span>
              {p?.lostReason && <span className="text-zinc-500 truncate italic text-xs">{p.lostReason}</span>}
            </div>
          )}

          <Button variant="ghost" className="w-full justify-start" icon={<CalendarDays size={14} />} onClick={() => setActiveTab('notes')}>{form.nextFollowupDate ? `Follow-up: ${form.nextFollowupDate}` : 'Atur jadwal follow-up'}</Button>
          {p.status === 'qualified' && !isQualified && <Button variant="secondary" className="w-full" onClick={() => setActiveTab('qualification')}>Lengkapi data kualifikasi</Button>}
          {won && Number(p.dealValue) > Number(p.dpAmount) && <Button className="w-full" onClick={() => openAction(setShowInvoiceModal)}>Buat tagihan pelunasan</Button>}
          {/* Clean Secondary Actions Toolbar */}
          <div className="flex items-center justify-between pt-1 border-t border-zinc-100 text-xs">
            <div className="flex items-center gap-1">
              <Button variant="ghost"
                type="button"
                onClick={() => openAction(setShowObjectionModal)}
                className="px-2 py-1 rounded text-zinc-600 hover:text-amber-800 hover:bg-amber-50 font-medium transition cursor-pointer flex items-center gap-1"
                title="Catat kendala / keberatan jamaah"
              >
                <AlertCircle size={12} className="text-amber-600" />
                <span>Keberatan</span>
              </Button>

              <Button variant="ghost"
                type="button"
                disabled={won} onClick={() => openAction(setShowLostModal)}
                className="px-2 py-1 rounded text-zinc-600 hover:text-rose-700 hover:bg-rose-50 font-medium transition cursor-pointer flex items-center gap-1"
                title="Tandai prospek batal"
              >
                <Ban size={12} className="text-rose-500" />
                <span>Tandai tidak lanjut</span>
              </Button>
            </div>

            {/* More Options Dropdown Toggle */}
            <div className="relative" onKeyDown={(event) => { if (event.key === 'Escape') setShowMoreActions(false); }}>
              <Button variant="ghost"
                type="button"
                onClick={() => setShowMoreActions((prev) => !prev)}
                className="p-1 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer flex items-center gap-0.5"
                aria-expanded={showMoreActions} aria-label="Tindakan lainnya" title="Tindakan lainnya"
              >
                <MoreHorizontal size={15} />
              </Button>

              {showMoreActions && (
                <div
                  className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg z-20 text-xs space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
                  onClick={() => setShowMoreActions(false)}
                >
                  <Button variant="ghost"
                    type="button"
                    onClick={() => setActiveTab('qualification')}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 font-medium text-zinc-700 flex items-center gap-2 cursor-pointer"
                  >
                    <UserCheck size={13} className="text-emerald-600" />
                    <span>Isi Kualifikasi</span>
                  </Button>
                  <Button variant="ghost"
                    type="button"
                    disabled={won || !connected} onClick={() => openAction(setShowOfferModal)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 font-medium text-zinc-700 flex items-center gap-2 cursor-pointer"
                  >
                    <FileCheck size={13} className="text-indigo-600" />
                    <span>Tinjau penawaran</span>
                  </Button>
                  <Button variant="ghost"
                    type="button"
                    onClick={() => openAction(setShowInvoiceModal)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 font-medium text-zinc-700 flex items-center gap-2 cursor-pointer"
                  >
                    <CreditCard size={13} className="text-blue-600" />
                    <span>{won ? 'Tagihan pelunasan' : 'Invoice DP'}</span>
                  </Button>
                  <Button variant="ghost"
                    type="button"
                    onClick={() => openAction(setShowPaymentProofModal)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 font-medium text-zinc-700 flex items-center gap-2 cursor-pointer"
                  >
                    <UploadCloud size={13} className="text-teal-600" />
                    <span>Upload Bukti Bayar</span>
                  </Button>
                  {['finance', 'admin', 'superadmin'].includes(user?.role || '') && (
                    <Button variant="ghost"
                      type="button"
                      onClick={() => openAction(setShowFinanceVerifyModal)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 font-semibold text-emerald-800 flex items-center gap-2 cursor-pointer"
                    >
                      <ShieldCheck size={13} className="text-emerald-600" />
                      <span>Verifikasi Finance</span>
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Segmented Navigation Tabs (Paket, Kualifikasi, Catatan) */}
      <div className="shrink-0 bg-white px-3 pt-2 pb-1 border-b border-zinc-200">
        <div className="flex items-center rounded-xl bg-zinc-100 p-1 text-xs">
          <Button variant="ghost"
            type="button"
            aria-pressed={activeTab === 'package'} onClick={() => setActiveTab('package')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-semibold text-xs transition cursor-pointer select-none',
              activeTab === 'package'
                ? 'bg-white text-zinc-900 shadow-2xs'
                : 'text-zinc-500 hover:text-zinc-800'
            )}
          >
            <Luggage size={13} className={activeTab === 'package' ? 'text-[#00a884]' : 'text-zinc-500'} />
            <span>Paket</span>
          </Button>

          <Button variant="ghost"
            type="button"
            aria-pressed={activeTab === 'qualification'} onClick={() => setActiveTab('qualification')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-semibold text-xs transition cursor-pointer select-none relative',
              activeTab === 'qualification'
                ? 'bg-white text-zinc-900 shadow-2xs'
                : 'text-zinc-500 hover:text-zinc-800'
            )}
          >
            <NotebookPen size={13} className={activeTab === 'qualification' ? 'text-[#00a884]' : 'text-zinc-500'} />
            <span>Kualifikasi</span>
            {!isQualified && (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Kualifikasi belum lengkap" />
            )}
          </Button>

          <Button variant="ghost"
            type="button"
            aria-pressed={activeTab === 'notes'} onClick={() => setActiveTab('notes')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-semibold text-xs transition cursor-pointer select-none',
              activeTab === 'notes'
                ? 'bg-white text-zinc-900 shadow-2xs'
                : 'text-zinc-500 hover:text-zinc-800'
            )}
          >
            <CalendarDays size={13} className={activeTab === 'notes' ? 'text-[#00a884]' : 'text-zinc-500'} />
            <span>Catatan</span>
          </Button>
        </div>
      </div>

      {/* 4. Tab Content Area (Scrollable & Clean) */}
      <div className="p-3.5 space-y-3">
        {/* ================= TAB 1: PAKET ================= */}
        {activeTab === 'package' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-700">Paket Umroh Pilihan</span>
              <Button variant="ghost"
                type="button"
                disabled={won || saveProfileMutation.isPending} onClick={() => setIsChangingPackage((prev) => !prev)}
                className="text-xs font-semibold text-[#008069] hover:underline cursor-pointer"
              >
                {isChangingPackage ? 'Tutup Pilihan' : selectedPackage ? 'Ganti Paket' : '+ Hubungkan Paket'}
              </Button>
            </div>

            {/* Package Selector Dropdown */}
            {isChangingPackage ? (
              <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50/50 p-2.5">
                <span className="font-semibold text-xs text-zinc-800 block">Pilih Paket:</span>
                <Select
                  value={form.packageId || 'none'}
                  onValueChange={handleSelectPackage}
                  options={[
                    { value: 'none', label: 'Belum memilih paket' },
                    ...packages
                      .filter((pkg) => pkg.isActive)
                      .map((pkg) => ({
                        value: String(pkg.id),
                        label: `${pkg.name} (${pkg.airline || 'Maskapai belum tersedia'} · Rp ${pkg.priceQuad || pkg.price})`,
                      })),
                  ]}
                  placeholder="Pilih paket umroh..."
                  className="w-full text-xs bg-white"
                />

                <div className="flex items-center justify-between pt-1 text-xs">
                  <Button variant="ghost"
                    type="button"
                    onClick={() => {
                      setIsChangingPackage(false);
                      onOpenPackagePicker();
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#008069] hover:underline cursor-pointer"
                  >
                    <Search size={12} />
                    <span>Galeri Brosur</span>
                  </Button>
                  <span className="text-xs text-zinc-600">Simpan perubahan untuk menerapkan paket.</span>
                </div>
              </div>
            ) : selectedPackage ? (
              <div className="space-y-2.5">
                {/* Package Card */}
                <div className="flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-2xs">
                  <div
                    className={cn(
                      'relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100',
                      selectedPackage.flyerImage ? 'cursor-pointer group' : ''
                    )}
                    onClick={() => {
                      if (selectedPackage.flyerImage && onPreviewImage) {
                        onPreviewImage(resolveMediaUrl(selectedPackage.flyerImage));
                      }
                    }}
                    role={selectedPackage.flyerImage ? 'button' : undefined}
                    tabIndex={selectedPackage.flyerImage ? 0 : undefined}
                    aria-label={`Pratinjau flyer ${selectedPackage.name}`}
                    onKeyDown={(event) => { if (selectedPackage.flyerImage && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onPreviewImage?.(resolveMediaUrl(selectedPackage.flyerImage)); } }}
                    title={selectedPackage.flyerImage ? 'Klik pratinjau flyer' : undefined}
                  >
                    {selectedPackage.flyerImage ? (
                      <img
                        src={resolveMediaUrl(selectedPackage.flyerImage)}
                        alt={selectedPackage.name}
                        className="h-full w-full object-cover group-hover:scale-105 transition"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-zinc-500">
                        <ImageIcon size={18} />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 text-xs">
                    <h5 className="font-semibold text-zinc-900 line-clamp-2">{selectedPackage.name}</h5>
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">
                      ✈️ {selectedPackage.airline || 'Maskapai belum tersedia'} · ⏳ {selectedPackage.duration || 'Durasi belum tersedia'}
                    </p>
                    <p className="text-xs font-semibold text-[#008069] mt-0.5">
                      Mulai Rp {selectedPackage.priceQuad || selectedPackage.price}
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="text-zinc-600">Keberangkatan</dt><dd className="mt-1 font-semibold">{selectedPackage.departureDate ? new Date(selectedPackage.departureDate).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }) : selectedPackage.departureInfo || 'Belum tersedia'}</dd></div><div><dt className="text-zinc-600">Sisa kuota katalog</dt><dd className="mt-1 font-semibold">{selectedPackage.quotaRemaining == null ? 'Belum tersedia' : `${selectedPackage.quotaRemaining} seat`}</dd></div></dl>
                {/* 3 Quick Action Buttons */}
                <div className="grid grid-cols-3 gap-1.5">
                  <Button variant="ghost"
                    type="button"
                    disabled={isDirty || !connected || !selectedPackage.flyerImage} onClick={() => onSendFlyer(selectedPackage)}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-zinc-200 bg-white p-2 text-center text-xs font-semibold text-zinc-700 hover:border-[#00a884] hover:bg-emerald-50/50 hover:text-[#008069] transition shadow-2xs cursor-pointer"
                    title="Siapkan pratinjau flyer sebelum dikirim"
                  >
                    <ImageIcon size={14} className="text-[#008069]" />
                    <span>Siapkan flyer</span>
                  </Button>

                  <Button variant="ghost"
                    type="button"
                    disabled={isDirty} onClick={handleSendPackageFormat}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-zinc-200 bg-white p-2 text-center text-xs font-semibold text-zinc-700 hover:border-[#00a884] hover:bg-emerald-50/50 hover:text-[#008069] transition shadow-2xs cursor-pointer"
                    title="Sisipkan rincian harga paket ke pesan"
                  >
                    <FileText size={14} className="text-blue-600" />
                    <span>Rincian</span>
                  </Button>

                  <Button variant="ghost"
                    type="button"
                    disabled={isDirty || !selectedPackage.itinerary} onClick={handleSendItinerary}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-zinc-200 bg-white p-2 text-center text-xs font-semibold text-zinc-700 hover:border-[#00a884] hover:bg-emerald-50/50 hover:text-[#008069] transition shadow-2xs cursor-pointer"
                    title="Sisipkan jadwal rundown itinerary ke pesan"
                  >
                    <Plane size={14} className="text-purple-600" />
                    <span>Itinerary</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-center bg-white">
                <Luggage size={20} className="mx-auto text-zinc-500 mb-1" />
                <p className="text-xs text-zinc-500 font-medium">Belum ada paket yang terhubung</p>
                <div className="mt-2.5 flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setIsChangingPackage(true)}
                    className="h-7 text-xs font-semibold"
                  >
                    Pilih Paket
                  </Button>
                  <Button
                    size="sm"
                    onClick={onOpenPackagePicker}
                    className="h-7 text-xs font-semibold bg-zinc-950 hover:bg-zinc-800 text-white"
                  >
                    Galeri Brosur
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: KUALIFIKASI ================= */}
        {activeTab === 'qualification' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-3 space-y-2.5 shadow-2xs">
              <div className="space-y-2">
                <label className="panel-field">Target keberangkatan *
                  <input className="field w-full" value={form.targetMonth} disabled={saveProfileMutation.isPending} onChange={event => updateFormField('targetMonth', event.target.value)} placeholder="Contoh: Desember 2026 atau Ramadan 1448 H" />
                </label>

                {/* Budget Range: preset dropdown */}
                <div>
                  <label className="text-xs font-semibold  text-zinc-500 block mb-1">
                    Budget
                  </label>
                  <Select
                    aria-label="Kisaran budget" value={form.budgetRange || 'unknown'}
                    disabled={saveProfileMutation.isPending} onValueChange={(val) => updateFormField('budgetRange', val === 'unknown' ? '' : val)}
                    options={[
                      { value: 'unknown', label: 'Pilih range budget...' },
                      { value: '< 25 Juta', label: '< Rp 25 Juta' },
                      { value: '25–30 Juta', label: 'Rp 25–30 Juta' },
                      { value: '30–35 Juta', label: 'Rp 30–35 Juta' },
                      { value: '35–40 Juta', label: 'Rp 35–40 Juta' },
                      { value: '40–50 Juta', label: 'Rp 40–50 Juta' },
                      { value: '> 50 Juta', label: '> Rp 50 Juta' },
                    ]}
                    className="w-full text-xs"
                  />
                </div>
              </div>

              {/* Kamar & Pax */}
              <div className="pt-2 border-t border-zinc-100 space-y-2">
                <div>
                  <label className="text-xs font-semibold  text-zinc-500 block mb-1">
                    Tipe Kamar Utama *
                  </label>
                  <Select
                    aria-label="Preferensi kamar" value={form.roomPreference || 'unknown'}
                    disabled={won || saveProfileMutation.isPending} onValueChange={(val) => updateFormField('roomPreference', val === 'unknown' ? '' : val)}
                    options={[
                      { value: 'unknown', label: 'Pilih preferensi kamar...' },
                      { value: 'Quad', label: 'Quad (Sekamar Ber-4)' },
                      { value: 'Triple', label: 'Triple (Sekamar Ber-3)' },
                      { value: 'Double', label: 'Double (Sekamar Ber-2)' },
                    ]}
                    className="w-full text-xs"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1 text-xs font-semibold  text-zinc-500">
                    <span>Jumlah Pax Jamaah</span>
                    <span className="text-zinc-700 tabular-nums">
                      Total: {Number(form.paxQuad) + Number(form.paxTriple) + Number(form.paxDouble) + Number(form.paxInfant)} Pax
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 text-center">
                    {([
                      ['paxQuad', 'Quad'],
                      ['paxTriple', 'Triple'],
                      ['paxDouble', 'Double'],
                      ['paxInfant', 'Infant'],
                    ] as const).map(([field, label]) => (
                      <div key={field} className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-1">
                        <span className="block text-xs font-semibold text-zinc-500 mb-0.5">{label}</span>
                        <input
                          type="number"
                          min="0" step="1"
                          aria-label={`Jumlah jamaah ${label}`} value={form[field]}
                          disabled={won || saveProfileMutation.isPending} onChange={(e) => updateFormField(field, Number(e.target.value))}
                          className="w-full text-center font-semibold text-xs text-zinc-900 bg-transparent focus-visible:outline-2 focus-visible:outline-zinc-600"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {won && <p className="text-xs text-zinc-600">Kamar dan jumlah jamaah sudah terkunci pada booking. Gunakan alur perubahan booking untuk koreksi.</p>}
                {/* Estimasi Deal */}
                <div className="flex items-center justify-between rounded-lg bg-zinc-900 px-3 py-1.5 text-white">
                  <span className="text-xs font-semibold text-zinc-200">
                    Estimasi Deal
                  </span>
                  <strong className="text-xs text-emerald-400 font-semibold">{rupiah(dealValue)}</strong>
                </div>
              </div>


              <div className="pt-2 border-t border-zinc-100">
                <div>
                  <label className="text-xs font-semibold  text-zinc-500 block mb-1">
                    Paspor
                  </label>
                  <Select
                    aria-label="Status paspor" value={form.passportStatus || 'unknown'}
                    disabled={saveProfileMutation.isPending} onValueChange={(val) => updateFormField('passportStatus', val === 'unknown' ? '' : val)}
                    options={[
                      { value: 'unknown', label: 'Status paspor...' },
                      { value: 'sudah_ada', label: 'Sudah ada' },
                      { value: 'proses_buat', label: 'Proses buat' },
                      { value: 'perpanjang', label: 'Perpanjang' },
                      { value: 'belum_ada', label: 'Belum ada' },
                    ]}
                    className="w-full text-xs"
                  />
                </div>
              </div>


            </div>
          </div>
        )}

        {/* ================= TAB 3: CATATAN & JADWAL ================= */}
        {activeTab === 'notes' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-3 space-y-2.5 shadow-2xs">
              <div>
                <label className="text-xs font-semibold  text-zinc-500 block mb-1">
                  Follow-Up Berikutnya
                </label>
                <input
                  aria-label="Tanggal follow-up (WIB)"
                  type="date"
                  value={form.nextFollowupDate}
                  disabled={saveProfileMutation.isPending} onChange={(e) => updateFormField('nextFollowupDate', e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50/50 px-2.5 py-1.5 text-xs text-zinc-800 outline-none focus:border-[#00a884] focus:bg-white transition"
                />
              </div>

              <div>
                <label className="text-xs font-semibold  text-zinc-500 block mb-1">
                  Catatan CS
                </label>
                <textarea aria-label="Catatan CS"
                  rows={4}
                  value={form.notes}
                  disabled={saveProfileMutation.isPending} onChange={(e) => updateFormField('notes', e.target.value)}
                  placeholder="Catatan preferensi, hasil obrolan, atau janji..."
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50/50 p-2 text-xs text-zinc-800 placeholder:text-zinc-500 outline-none focus:border-[#00a884] focus:bg-white transition resize-none"
                />
              </div>


            </div>

            {/* Bukti Transfer jika ada */}
            {p?.paymentProofUrl && (
              <div className="rounded-xl border border-emerald-200 bg-white p-2.5 flex items-center justify-between gap-2 shadow-2xs">
                <div className="flex items-center gap-2 min-w-0">
                  <PrivateProofThumb url={p.paymentProofUrl} />
                  <div className="min-w-0 text-xs">
                    <p className="font-semibold text-zinc-800 text-xs truncate">Bukti Transfer</p>
                    <p className="text-xs text-emerald-700">
                      {`Kas terverifikasi: ${rupiah(p?.dpAmount)}. Tinjau status bukti di Finance.`}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      </div>
      {(isDirty || saveError) && <div className="shrink-0 border-t border-zinc-200 bg-white p-3 space-y-2">
        {saveError && <p role="alert" className="text-xs text-rose-700">{saveError}</p>}
        {isDirty && <>
          <p role="status" className="text-xs text-zinc-600">Draft belum disimpan. Tetap tersedia di tab browser ini.</p>
          {draft.changedOnServer && <p className="text-xs text-amber-800">Data server diperbarui. Tinjau perubahan sebelum menyimpan.</p>}
          <div className="flex gap-2"><Button className="flex-1" loading={saveProfileMutation.isPending} onClick={() => saveProfileMutation.mutate()} icon={<Save size={14} />}>Simpan perubahan</Button><Button variant="ghost" disabled={saveProfileMutation.isPending} onClick={handleResetForm}>Buang draft</Button></div>
        </>}
      </div>}
      {/* 5. Minimal Slim Footer */}
      <div className="shrink-0 border-t border-zinc-200 bg-white px-3 py-2 flex items-center justify-between text-xs">
        <Link
          to={`/prospects/${prospectId}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-500 hover:text-zinc-900 transition"
        >
          <span>Detail prospek</span>
          <ExternalLink size={11} />
        </Link>

        {p?.updatedAt && (
          <span className="text-xs text-zinc-500">
            Diperbarui: {new Date(p.updatedAt).toLocaleDateString('id-ID')}
          </span>
        )}
      </div>

      {/* Action Modals */}
      {p && (
        <>
          {showQualifyModal && (          <QualificationModal
            open={showQualifyModal}
            onClose={() => setShowQualifyModal(false)}
            prospect={p}
            brandId={brandId}
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

          {showInvoiceModal && (          <OfficialInvoiceModal
            open={showInvoiceModal}
            onClose={() => setShowInvoiceModal(false)}
            prospect={p}
            packages={packages}
            brandId={brandId}
            onInsertText={onInsertText}
            onShowToast={onShowToast}
          />)}

          {showPaymentProofModal && (          <PaymentProofModal
            open={showPaymentProofModal}
            onClose={() => setShowPaymentProofModal(false)}
            prospect={p}
            brandId={brandId}
            onShowToast={onShowToast}
          />)}

          {showFinanceVerifyModal && (          <FinanceVerifyModal
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

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { formatWaPackageSummary } from '../packages/packageQuote';
import { OfficialOfferModal } from './OfficialOfferModal';
import { ObjectionModal } from './ObjectionModal';
import { OfficialInvoiceModal } from './OfficialInvoiceModal';
import { PaymentProofModal } from './PaymentProofModal';
import { FinanceVerifyModal } from './FinanceVerifyModal';
import { PrivateProofThumb } from './PrivateProof';
import { LostReasonModal } from './LostReasonModal';
import { QualificationModal } from './QualificationModal';

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

  // Track user edits so background query invalidation doesn't wipe in-progress input (A18)
  const [isDirty, setIsDirty] = useState(false);
  const loadedProspectIdRef = useRef<number | null>(null);

  // Fetch complete prospect data
  const prospectQuery = useQuery({
    queryKey: ['prospect', prospectId, brandId],
    queryFn: () => api.get<any>(`/prospects/${prospectId}${query}`),
    enabled: !!prospectId && !!brandId,
  });

  const p = prospectQuery.data;

  // Local form state for profiling fields
  const [form, setForm] = useState<any>({
    name: '',
    phone: '',
    city: '',
    targetMonth: '',
    budgetRange: '',
    roomPreference: '',
    decisionMaker: '',
    specialNeeds: '',
    passportStatus: '',
    vaccineStatus: '',
    paxQuad: 0,
    paxTriple: 0,
    paxDouble: 0,
    paxInfant: 0,
    notes: '',
    nextFollowupDate: '',
    packageId: '',
    lostReason: '',
  });

  const updateFormField = (key: string, value: any) => {
    setIsDirty(true);
    setForm((prev: any) => ({ ...prev, [key]: value }));
  };

  const updateFormFields = (patch: Record<string, any>) => {
    setIsDirty(true);
    setForm((prev: any) => ({ ...prev, ...patch }));
  };

  const handleResetForm = () => {
    if (!p) return;
    setIsDirty(false);
    setForm({
      name: p.name ?? '',
      phone: p.phone ?? '',
      city: p.city ?? '',
      targetMonth: p.targetMonth ?? '',
      budgetRange: p.budgetRange ?? '',
      roomPreference: p.roomPreference ?? (p.paxDouble ? 'Double' : p.paxTriple ? 'Triple' : p.paxQuad ? 'Quad' : ''),
      decisionMaker: p.decisionMaker ?? '',
      specialNeeds: p.specialNeeds ?? '',
      passportStatus: p.passportStatus ?? '',
      vaccineStatus: p.vaccineStatus ?? '',
      paxQuad: p.paxQuad ?? 0,
      paxTriple: p.paxTriple ?? 0,
      paxDouble: p.paxDouble ?? 0,
      paxInfant: p.paxInfant ?? 0,
      notes: p.notes ?? '',
      nextFollowupDate: p.nextFollowupDate?.slice(0, 10) ?? '',
      packageId: p.packageId ? String(p.packageId) : '',
      lostReason: p.lostReason ?? '',
    });
    onShowToast('Perubahan dibatalkan');
  };

  useEffect(() => {
    if (!p) return;

    // Reset when switching to a different prospect
    if (loadedProspectIdRef.current !== p.id) {
      loadedProspectIdRef.current = p.id;
      setIsDirty(false);
      setForm({
        name: p.name ?? '',
        phone: p.phone ?? '',
        city: p.city ?? '',
        targetMonth: p.targetMonth ?? '',
        budgetRange: p.budgetRange ?? '',
        roomPreference: p.roomPreference ?? (p.paxDouble ? 'Double' : p.paxTriple ? 'Triple' : p.paxQuad ? 'Quad' : ''),
        decisionMaker: p.decisionMaker ?? '',
        specialNeeds: p.specialNeeds ?? '',
        passportStatus: p.passportStatus ?? '',
        vaccineStatus: p.vaccineStatus ?? '',
        paxQuad: p.paxQuad ?? 0,
        paxTriple: p.paxTriple ?? 0,
        paxDouble: p.paxDouble ?? 0,
        paxInfant: p.paxInfant ?? 0,
        notes: p.notes ?? '',
        nextFollowupDate: p.nextFollowupDate?.slice(0, 10) ?? '',
        packageId: p.packageId ? String(p.packageId) : '',
        lostReason: p.lostReason ?? '',
      });

      if (p.status === 'contact' && (!p.targetMonth || !p.roomPreference)) {
        setActiveTab('qualification');
      }
      return;
    }

    // Do NOT overwrite user's typing if they have uncommitted edits (A18)
    if (isDirty) {
      return;
    }

    setForm({
      name: p.name ?? '',
      phone: p.phone ?? '',
      city: p.city ?? '',
      targetMonth: p.targetMonth ?? '',
      budgetRange: p.budgetRange ?? '',
      roomPreference: p.roomPreference ?? (p.paxDouble ? 'Double' : p.paxTriple ? 'Triple' : p.paxQuad ? 'Quad' : ''),
      decisionMaker: p.decisionMaker ?? '',
      specialNeeds: p.specialNeeds ?? '',
      passportStatus: p.passportStatus ?? '',
      vaccineStatus: p.vaccineStatus ?? '',
      paxQuad: p.paxQuad ?? 0,
      paxTriple: p.paxTriple ?? 0,
      paxDouble: p.paxDouble ?? 0,
      paxInfant: p.paxInfant ?? 0,
      notes: p.notes ?? '',
      nextFollowupDate: p.nextFollowupDate?.slice(0, 10) ?? '',
      packageId: p.packageId ? String(p.packageId) : '',
      lostReason: p.lostReason ?? '',
    });
  }, [p, isDirty]);

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

  const changePackageMutation = useMutation({
    mutationFn: (newPackageId: number | null) =>
      api.patch(`/prospects/${prospectId}/profile`, {
        packageId: newPackageId,
        ...(user?.role === 'superadmin' ? { brandId } : {}),
      }),
    onSuccess: (_, newPackageId) => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospectId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      const targetPkg = packages.find((pkg) => pkg.id === newPackageId);
      setIsChangingPackage(false);
      onShowToast(
        targetPkg
          ? `Paket umroh diubah ke ${targetPkg.name}`
          : 'Paket prospek berhasil dilepas'
      );
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Gagal mengubah paket umroh');
    },
  });

  function handleSelectPackage(newPkgIdStr: string) {
    const nextId = newPkgIdStr ? Number(newPkgIdStr) : null;
    updateFormField('packageId', newPkgIdStr);
    changePackageMutation.mutate(nextId);
  }

  // Mutations: cleanly sends only profiling fields to avoid 403 financial guard (A04)
  const saveProfileMutation = useMutation({
    mutationFn: () => {
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
        lostReason: form.lostReason,
        ...(user?.role === 'superadmin' ? { brandId } : {}),
      };
      return api.patch(`/prospects/${prospectId}/profile`, payload);
    },
    onSuccess: (res: any) => {
      setIsDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospectId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      if (res?.data?.status === 'qualified' && p?.status !== 'qualified') {
        onShowToast('Profil disimpan & otomatis naik ke Terkualifikasi!');
      } else {
        onShowToast('Profil prospek berhasil disimpan!');
      }
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Gagal menyimpan profil prospek');
    },
  });

  const claimPicMutation = useMutation({
    mutationFn: () => api.post(`/prospects/${prospectId}/claim`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospectId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
      onShowToast('Anda berhasil menjadi PIC prospek ini!');
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Gagal mengklaim PIC');
    },
  });

  function handleCopyPhone() {
    const raw = form.phone || p?.phone || '';
    if (!raw) return;
    navigator.clipboard.writeText(raw);
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
    const travelName = activeBrand?.name || 'Layanan Resmi Umroh';
    const customerName = form.name || 'Bapak/Ibu';
    const departureStr = selectedPackage.departureDate
      ? new Date(selectedPackage.departureDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
      : (selectedPackage.departureInfo || 'Jadwal Terdekat');

    let text = `Bismillah ${customerName}, berikut ringkasan rencana perjalanan ibadah (itinerary) untuk *${selectedPackage.name}* bersama ${travelName}:\n\n` +
      `📅 *Keberangkatan:* ${departureStr}\n` +
      `⏳ *Durasi:* ${selectedPackage.duration || '9-12 Hari'}\n` +
      `✈️ *Maskapai:* ${selectedPackage.airline || 'Direct Saudia/Garuda'}\n` +
      `🏨 *Hotel Makkah:* ${selectedPackage.hotelMakkah || 'Setaraf bintang 4/5'}\n` +
      `🏨 *Hotel Madinah:* ${selectedPackage.hotelMadinah || 'Setaraf bintang 4/5'}\n\n`;

    if (selectedPackage.itinerary) {
      text += `📋 *Rencana Program:*\n${selectedPackage.itinerary}\n\n`;
    } else if (selectedPackage.highlights) {
      text += `✨ *Fasilitas & Keunggulan:*\n${selectedPackage.highlights}\n\n`;
    }

    if (selectedPackage.facilitiesIncluded) {
      text += `✅ *Sudah Termasuk:*\n${selectedPackage.facilitiesIncluded}\n\n`;
    }

    text += `Insya Allah bimbingan ibadah didampingi Muthawwif berpengalaman sesuai Al-Qur'an dan As-Sunnah. Semoga Allah mudahkan langkah menuju Baitullah! 🙏`;
    onInsertText(text);
    onShowToast(`Itinerary paket ${selectedPackage.name} disisipkan ke pesan`);
  }

  if (prospectQuery.isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-zinc-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00a884] border-t-transparent mb-3" />
        <span>Memuat profil prospek...</span>
      </div>
    );
  }

  const isPic = Boolean(p?.userId && p.userId === user?.id);
  const isUnassigned = !p?.userId;
  const currentStageIndex = Math.max(0, pipelineStatuses.indexOf(p?.status as any));

  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-50/50 text-zinc-800">
      {/* 1. Header Ringkas: Nama, Phone, PIC & Status Badge */}
      <div className="shrink-0 bg-white border-b border-zinc-200/80 px-4 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-zinc-900 text-xs font-black text-white shadow-2xs">
              {(form.name || p?.name || '?').slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateFormField('name', e.target.value)}
                placeholder="Nama Prospek"
                className="font-bold text-xs text-zinc-900 bg-transparent border-b border-transparent hover:border-zinc-300 focus:border-[#00a884] outline-none transition py-0.5 truncate w-full"
                title="Klik untuk mengubah nama prospek"
              />
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <span className="font-mono text-[10.5px] truncate">{form.phone || p?.phone || '-'}</span>
                {form.phone && (
                  <button
                    type="button"
                    onClick={handleCopyPhone}
                    className="text-zinc-400 hover:text-zinc-800 transition cursor-pointer"
                    title="Salin nomor WhatsApp"
                  >
                    {copiedPhone ? <Check size={11} className="text-[#00a884]" /> : <Copy size={11} />}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              {isDirty && (
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="inline-flex items-center gap-0.5 text-[9.5px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded-full cursor-pointer transition shadow-2xs"
                  title="Batalkan perubahan yang belum disimpan"
                >
                  <Undo2 size={10} />
                  <span>Batal</span>
                </button>
              )}
              <Badge value={p?.status || 'new'} />
            </div>
            <div className="flex items-center gap-1 text-[10px] text-zinc-500">
              <CircleUserRound size={11} className="text-zinc-400" />
              <span className="truncate max-w-[90px]">
                {p?.user?.name ? (isPic ? 'Anda' : p.user.name) : 'Belum Ada PIC'}
              </span>
              {user?.role === 'cs' && isUnassigned && (
                <button
                  type="button"
                  onClick={() => claimPicMutation.mutate()}
                  disabled={claimPicMutation.isPending}
                  className="font-bold text-emerald-700 hover:underline cursor-pointer ml-0.5"
                >
                  Klaim
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Contextual Next Action Card */}
      <div className="shrink-0 px-3 pt-2 pb-2.5 bg-white border-b border-zinc-200/80">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-2.5 shadow-2xs space-y-2">
          {/* Stage pill */}
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-bold uppercase tracking-wider text-zinc-500">Aksi Selanjutnya</span>
            <span className="font-mono text-zinc-400">{currentStageIndex + 1}/{pipelineStatuses.length}</span>
          </div>

          {p?.status === 'new' && (
            <div className="flex items-start gap-2 rounded-lg bg-zinc-100 border border-zinc-200 px-2.5 py-2 text-[11px] text-zinc-600">
              <span className="text-base leading-none mt-0.5">💬</span>
              <span>Kirim pesan sapaan di kolom chat. Status otomatis berubah ke <strong>Kontak</strong> setelah pesan pertama terkirim.</span>
            </div>
          )}

          {p?.status === 'contact' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-600 font-medium">Syarat Terkualifikasi:</span>
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                  isQualified
                    ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                    : "text-amber-800 bg-amber-50 border-amber-200"
                )}>
                  {!form.roomPreference ? 'Pilih Kamar' : !form.targetMonth ? 'Isi Target Bulan' : (Number(form.paxQuad || 0) + Number(form.paxTriple || 0) + Number(form.paxDouble || 0) + Number(form.paxInfant || 0)) === 0 ? 'Isi Pax' : 'Siap Simpan'}
                </span>
              </div>

              {/* Mini Status Checklist */}
              <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
                <div
                  className={cn(
                    'flex items-center justify-center gap-1 rounded-lg px-1.5 py-1 border font-medium transition',
                    form.targetMonth ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-zinc-100 border-zinc-200 text-zinc-400'
                  )}
                  title={form.targetMonth ? `Target: ${form.targetMonth}` : 'Target Bulan belum diisi'}
                >
                  {form.targetMonth ? <Check size={12} className="text-emerald-600 shrink-0" /> : <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 shrink-0" />}
                  <span className="truncate">Bulan</span>
                </div>

                <div
                  className={cn(
                    'flex items-center justify-center gap-1 rounded-lg px-1.5 py-1 border font-medium transition',
                    form.roomPreference ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800 font-bold'
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
                      : 'bg-zinc-100 border-zinc-200 text-zinc-400'
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
                <button
                  type="button"
                  onClick={() => setActiveTab('qualification')}
                  className="w-full text-center pt-0.5 text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
                >
                  Isi di tab Kualifikasi ↓
                </button>
              )}
            </div>
          )}

          {p?.status === 'qualified' && (
            <button
              type="button"
              onClick={() => setShowOfferModal(true)}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 py-2 px-3 text-xs font-bold text-white transition shadow-xs cursor-pointer"
            >
              <FileCheck size={14} />
              <span>Kirim Penawaran</span>
            </button>
          )}

          {p?.status === 'offer' && (
            <button
              type="button"
              onClick={() => setShowInvoiceModal(true)}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 py-2 px-3 text-xs font-bold text-white transition shadow-xs cursor-pointer"
            >
              <CreditCard size={14} />
              <span>Buat Invoice DP</span>
            </button>
          )}

          {p?.status === 'objection' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5 text-[11px]">
                <AlertCircle size={12} className="text-amber-600 shrink-0" />
                <span className="font-bold text-amber-900 truncate">{p?.objectionCategory || 'Keberatan'}</span>
                {p?.objectionNotes && <span className="text-zinc-500 truncate text-[10.5px] italic">{p.objectionNotes}</span>}
              </div>
              <button
                type="button"
                onClick={() => setShowObjectionModal(true)}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 py-2 px-3 text-xs font-bold text-white transition shadow-xs cursor-pointer"
              >
                <AlertCircle size={14} />
                <span>Catat Respons</span>
              </button>
            </div>
          )}

          {p?.status === 'closing' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-[11px] font-bold text-blue-900">
                <span>{p?.invoiceNumber || 'Invoice DP'}</span>
                <span className="text-blue-700">{rupiah(p?.invoiceAmount || 0)}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowPaymentProofModal(true)}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 py-2 px-3 text-xs font-bold text-white transition shadow-xs cursor-pointer"
              >
                <UploadCloud size={14} />
                <span>Upload Bukti Transfer</span>
              </button>
            </div>
          )}

          {p?.status === 'deal' && (
            <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-xs">
              <span className="font-bold text-emerald-900">🎉 Deal Closed</span>
              <span className="font-bold text-emerald-700" title="Kas terverifikasi / nilai booking">
                {rupiah(p?.dpAmount || 0)} / {rupiah(p?.dealValue || 0)}
              </span>
            </div>
          )}

          {(p?.status === 'lose' || p?.status === 'closed_lost') && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1.5 text-xs">
              <Ban size={13} className="text-rose-600 shrink-0" />
              <span className="font-bold text-rose-900">Batal</span>
              {p?.lostReason && <span className="text-zinc-500 truncate italic text-[10.5px]">{p.lostReason}</span>}
            </div>
          )}

          {/* Clean Secondary Actions Toolbar */}
          <div className="flex items-center justify-between pt-1 border-t border-zinc-100 text-[11px]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowObjectionModal(true)}
                className="px-2 py-1 rounded text-zinc-600 hover:text-amber-800 hover:bg-amber-50 font-medium transition cursor-pointer flex items-center gap-1"
                title="Catat kendala / keberatan jamaah"
              >
                <AlertCircle size={12} className="text-amber-600" />
                <span>Keberatan</span>
              </button>

              <button
                type="button"
                onClick={() => setShowLostModal(true)}
                className="px-2 py-1 rounded text-zinc-600 hover:text-rose-700 hover:bg-rose-50 font-medium transition cursor-pointer flex items-center gap-1"
                title="Tandai prospek batal"
              >
                <Ban size={12} className="text-rose-500" />
                <span>Batal</span>
              </button>
            </div>

            {/* More Options Dropdown Toggle */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMoreActions((prev) => !prev)}
                className="p-1 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer flex items-center gap-0.5"
                title="Aksi Lainnya"
              >
                <MoreHorizontal size={15} />
              </button>

              {showMoreActions && (
                <div
                  className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg z-20 text-xs space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
                  onClick={() => setShowMoreActions(false)}
                >
                  <button
                    type="button"
                    onClick={() => setShowQualifyModal(true)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 font-medium text-zinc-700 flex items-center gap-2 cursor-pointer"
                  >
                    <UserCheck size={13} className="text-emerald-600" />
                    <span>Isi Kualifikasi</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowOfferModal(true)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 font-medium text-zinc-700 flex items-center gap-2 cursor-pointer"
                  >
                    <FileCheck size={13} className="text-indigo-600" />
                    <span>Kirim Penawaran</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowInvoiceModal(true)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 font-medium text-zinc-700 flex items-center gap-2 cursor-pointer"
                  >
                    <CreditCard size={13} className="text-blue-600" />
                    <span>Tagihan Invoice DP</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPaymentProofModal(true)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 font-medium text-zinc-700 flex items-center gap-2 cursor-pointer"
                  >
                    <UploadCloud size={13} className="text-teal-600" />
                    <span>Upload Bukti Bayar</span>
                  </button>
                  {['finance', 'admin', 'superadmin'].includes(user?.role || '') && (
                    <button
                      type="button"
                      onClick={() => setShowFinanceVerifyModal(true)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 font-bold text-emerald-800 flex items-center gap-2 cursor-pointer"
                    >
                      <ShieldCheck size={13} className="text-emerald-600" />
                      <span>Verifikasi Finance</span>
                    </button>
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
          <button
            type="button"
            onClick={() => setActiveTab('package')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-bold text-[11px] transition cursor-pointer select-none',
              activeTab === 'package'
                ? 'bg-white text-zinc-900 shadow-2xs'
                : 'text-zinc-500 hover:text-zinc-800'
            )}
          >
            <Luggage size={13} className={activeTab === 'package' ? 'text-[#00a884]' : 'text-zinc-400'} />
            <span>Paket</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('qualification')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-bold text-[11px] transition cursor-pointer select-none relative',
              activeTab === 'qualification'
                ? 'bg-white text-zinc-900 shadow-2xs'
                : 'text-zinc-500 hover:text-zinc-800'
            )}
          >
            <NotebookPen size={13} className={activeTab === 'qualification' ? 'text-[#00a884]' : 'text-zinc-400'} />
            <span>Kualifikasi</span>
            {!isQualified && (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Kualifikasi belum lengkap" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-bold text-[11px] transition cursor-pointer select-none',
              activeTab === 'notes'
                ? 'bg-white text-zinc-900 shadow-2xs'
                : 'text-zinc-500 hover:text-zinc-800'
            )}
          >
            <CalendarDays size={13} className={activeTab === 'notes' ? 'text-[#00a884]' : 'text-zinc-400'} />
            <span>Catatan</span>
          </button>
        </div>
      </div>

      {/* 4. Tab Content Area (Scrollable & Clean) */}
      <div className="thin-scrollbar flex-1 overflow-y-auto p-3.5 space-y-3">
        {/* ================= TAB 1: PAKET ================= */}
        {activeTab === 'package' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-700">Paket Umroh Pilihan</span>
              <button
                type="button"
                onClick={() => setIsChangingPackage((prev) => !prev)}
                className="text-[11px] font-bold text-[#008069] hover:underline cursor-pointer"
              >
                {isChangingPackage ? 'Tutup Pilihan' : selectedPackage ? 'Ganti Paket' : '+ Hubungkan Paket'}
              </button>
            </div>

            {/* Package Selector Dropdown */}
            {isChangingPackage ? (
              <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50/50 p-2.5">
                <span className="font-bold text-xs text-zinc-800 block">Pilih Paket:</span>
                <Select
                  value={form.packageId || ''}
                  onValueChange={handleSelectPackage}
                  options={[
                    { value: '', label: '-- Tanpa Paket (Lepas Hubungan) --' },
                    ...packages
                      .filter((pkg) => pkg.isActive)
                      .map((pkg) => ({
                        value: String(pkg.id),
                        label: `${pkg.name} (${pkg.airline || 'Direct'} · Rp ${pkg.priceQuad || pkg.price})`,
                      })),
                  ]}
                  placeholder="Pilih paket umroh..."
                  className="w-full text-xs bg-white"
                />

                <div className="flex items-center justify-between pt-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setIsChangingPackage(false);
                      onOpenPackagePicker();
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#008069] hover:underline cursor-pointer"
                  >
                    <Search size={12} />
                    <span>Galeri Brosur</span>
                  </button>
                  {changePackageMutation.isPending && (
                    <span className="text-[11px] text-emerald-600 font-semibold animate-pulse">Menyimpan...</span>
                  )}
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
                        onPreviewImage(selectedPackage.flyerImage);
                      }
                    }}
                    title={selectedPackage.flyerImage ? 'Klik pratinjau flyer' : undefined}
                  >
                    {selectedPackage.flyerImage ? (
                      <img
                        src={resolveMediaUrl(selectedPackage.flyerImage)}
                        alt={selectedPackage.name}
                        className="h-full w-full object-cover group-hover:scale-105 transition"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-zinc-400">
                        <ImageIcon size={18} />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 text-xs">
                    <h5 className="font-bold text-zinc-900 truncate">{selectedPackage.name}</h5>
                    <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                      ✈️ {selectedPackage.airline || 'Direct'} · ⏳ {selectedPackage.duration || '9 Hari'}
                    </p>
                    <p className="text-[11px] font-bold text-[#008069] mt-0.5">
                      Mulai Rp {selectedPackage.priceQuad || selectedPackage.price}
                    </p>
                  </div>
                </div>

                {/* 3 Quick Action Buttons */}
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSendFlyer(selectedPackage)}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-zinc-200 bg-white p-2 text-center text-[10.5px] font-bold text-zinc-700 hover:border-[#00a884] hover:bg-emerald-50/50 hover:text-[#008069] transition shadow-2xs cursor-pointer"
                    title="Kirim brosur paket ke WhatsApp"
                  >
                    <ImageIcon size={14} className="text-[#008069]" />
                    <span>Kirim Flyer</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSendPackageFormat}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-zinc-200 bg-white p-2 text-center text-[10.5px] font-bold text-zinc-700 hover:border-[#00a884] hover:bg-emerald-50/50 hover:text-[#008069] transition shadow-2xs cursor-pointer"
                    title="Sisipkan rincian harga paket ke pesan"
                  >
                    <FileText size={14} className="text-blue-600" />
                    <span>Format Paket</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSendItinerary}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-zinc-200 bg-white p-2 text-center text-[10.5px] font-bold text-zinc-700 hover:border-[#00a884] hover:bg-emerald-50/50 hover:text-[#008069] transition shadow-2xs cursor-pointer"
                    title="Sisipkan jadwal rundown itinerary ke pesan"
                  >
                    <Plane size={14} className="text-purple-600" />
                    <span>Itinerary</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-center bg-white">
                <Luggage size={20} className="mx-auto text-zinc-400 mb-1" />
                <p className="text-xs text-zinc-500 font-medium">Belum ada paket yang terhubung</p>
                <div className="mt-2.5 flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setIsChangingPackage(true)}
                    className="h-7 text-[11px] font-bold"
                  >
                    Pilih Paket
                  </Button>
                  <Button
                    size="sm"
                    onClick={onOpenPackagePicker}
                    className="h-7 text-[11px] font-bold bg-[#00a884] hover:bg-[#008f6f] text-white"
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
                {/* Target Bulan: 2 dropdown Bulan + Tahun */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                    Target Bulan *
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Select
                      value={form.targetMonth ? form.targetMonth.split(' ')[0] : ''}
                      onValueChange={(month) => {
                        const year = form.targetMonth ? form.targetMonth.split(' ')[1] : String(new Date().getFullYear());
                        updateFormFields({ targetMonth: month && year ? `${month} ${year}` : '' });
                      }}
                      options={[
                        { value: '', label: 'Bulan...' },
                        { value: 'Januari', label: 'Januari' },
                        { value: 'Februari', label: 'Februari' },
                        { value: 'Maret', label: 'Maret' },
                        { value: 'April', label: 'April' },
                        { value: 'Mei', label: 'Mei' },
                        { value: 'Juni', label: 'Juni' },
                        { value: 'Juli', label: 'Juli' },
                        { value: 'Agustus', label: 'Agustus' },
                        { value: 'September', label: 'September' },
                        { value: 'Oktober', label: 'Oktober' },
                        { value: 'November', label: 'November' },
                        { value: 'Desember', label: 'Desember' },
                      ]}
                      className="w-full text-xs"
                    />
                    <Select
                      value={form.targetMonth ? (form.targetMonth.split(' ')[1] ?? '') : ''}
                      onValueChange={(year) => {
                        const month = form.targetMonth ? form.targetMonth.split(' ')[0] : '';
                        updateFormFields({ targetMonth: month && year ? `${month} ${year}` : '' });
                      }}
                      options={[
                        { value: '', label: 'Tahun...' },
                        ...Array.from({ length: 3 }, (_, i) => {
                          const y = String(new Date().getFullYear() + i);
                          return { value: y, label: y };
                        }),
                      ]}
                      className="w-full text-xs"
                    />
                  </div>
                </div>

                {/* Budget Range: preset dropdown */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                    Budget
                  </label>
                  <Select
                    value={form.budgetRange || ''}
                    onValueChange={(val) => updateFormField('budgetRange', val)}
                    options={[
                      { value: '', label: 'Pilih range budget...' },
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
                  <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                    Tipe Kamar Utama *
                  </label>
                  <Select
                    value={form.roomPreference || ''}
                    onValueChange={(val) => updateFormField('roomPreference', val)}
                    options={[
                      { value: '', label: 'Pilih preferensi kamar...' },
                      { value: 'Quad', label: 'Quad (Sekamar Ber-4)' },
                      { value: 'Triple', label: 'Triple (Sekamar Ber-3)' },
                      { value: 'Double', label: 'Double (Sekamar Ber-2)' },
                    ]}
                    className="w-full text-xs"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1 text-[10px] font-bold uppercase text-zinc-500">
                    <span>Jumlah Pax Jamaah</span>
                    <span className="text-zinc-700 font-mono">
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
                        <span className="block text-[9.5px] font-semibold text-zinc-500 mb-0.5">{label}</span>
                        <input
                          type="number"
                          min="0"
                          value={form[field]}
                          onChange={(e) => updateFormField(field, Number(e.target.value))}
                          className="w-full text-center font-bold text-xs text-zinc-900 bg-transparent outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Estimasi Deal */}
                <div className="flex items-center justify-between rounded-lg bg-zinc-900 px-3 py-1.5 text-white">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Estimasi Deal
                  </span>
                  <strong className="text-xs text-emerald-400 font-bold">{rupiah(dealValue)}</strong>
                </div>
              </div>


              <div className="pt-2 border-t border-zinc-100">
                <div>
                  <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                    Paspor
                  </label>
                  <Select
                    value={form.passportStatus || ''}
                    onValueChange={(val) => updateFormField('passportStatus', val)}
                    options={[
                      { value: '', label: 'Status paspor...' },
                      { value: 'sudah_ada', label: 'Sudah ada' },
                      { value: 'proses_buat', label: 'Proses buat' },
                      { value: 'perpanjang', label: 'Perpanjang' },
                      { value: 'belum_ada', label: 'Belum ada' },
                    ]}
                    className="w-full text-xs"
                  />
                </div>
              </div>

              {/* Tombol Simpan Kualifikasi */}
              <div className="pt-2">
                <Button
                  type="button"
                  onClick={() => saveProfileMutation.mutate()}
                  disabled={saveProfileMutation.isPending}
                  className="w-full justify-center gap-1.5 bg-[#00a884] hover:bg-[#008f6f] text-white font-bold text-xs h-8 shadow-xs"
                >
                  <Save size={13} />
                  <span>{saveProfileMutation.isPending ? 'Menyimpan...' : 'Simpan Kualifikasi'}</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 3: CATATAN & JADWAL ================= */}
        {activeTab === 'notes' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-3 space-y-2.5 shadow-2xs">
              <div>
                <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                  Follow-Up Berikutnya
                </label>
                <input
                  type="date"
                  value={form.nextFollowupDate}
                  onChange={(e) => updateFormField('nextFollowupDate', e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50/50 px-2.5 py-1.5 text-xs text-zinc-800 outline-none focus:border-[#00a884] focus:bg-white transition"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                  Catatan CS
                </label>
                <textarea
                  rows={4}
                  value={form.notes}
                  onChange={(e) => updateFormField('notes', e.target.value)}
                  placeholder="Catatan preferensi, hasil obrolan, atau janji..."
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50/50 p-2 text-xs text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-[#00a884] focus:bg-white transition resize-none"
                />
              </div>

              <Button
                type="button"
                onClick={() => saveProfileMutation.mutate()}
                disabled={saveProfileMutation.isPending}
                className="w-full justify-center gap-1.5 bg-[#00a884] hover:bg-[#008f6f] text-white font-bold text-xs h-8 shadow-xs"
              >
                <Save size={13} />
                <span>{saveProfileMutation.isPending ? 'Menyimpan...' : 'Simpan Catatan'}</span>
              </Button>
            </div>

            {/* Bukti Transfer jika ada */}
            {p?.paymentProofUrl && (
              <div className="rounded-xl border border-emerald-200 bg-white p-2.5 flex items-center justify-between gap-2 shadow-2xs">
                <div className="flex items-center gap-2 min-w-0">
                  <PrivateProofThumb url={p.paymentProofUrl} />
                  <div className="min-w-0 text-xs">
                    <p className="font-bold text-zinc-800 text-[11px] truncate">Bukti Transfer</p>
                    <p className="text-[10px] text-emerald-700">
                      {p?.status === 'deal' ? '✅ Terverifikasi' : '⏳ Menunggu Validasi'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 5. Minimal Slim Footer */}
      <div className="shrink-0 border-t border-zinc-200 bg-white px-3 py-2 flex items-center justify-between text-xs">
        <Link
          to={`/prospects/${prospectId}`}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500 hover:text-zinc-900 transition"
        >
          <span>Detail 360°</span>
          <ExternalLink size={11} />
        </Link>

        {p?.updatedAt && (
          <span className="text-[10px] text-zinc-400">
            Diperbarui: {new Date(p.updatedAt).toLocaleDateString('id-ID')}
          </span>
        )}
      </div>

      {/* Action Modals */}
      {p && (
        <>
          <QualificationModal
            open={showQualifyModal}
            onClose={() => setShowQualifyModal(false)}
            prospect={p}
            brandId={brandId}
            onShowToast={onShowToast}
          />

          <OfficialOfferModal
            open={showOfferModal}
            onClose={() => setShowOfferModal(false)}
            prospect={p}
            packages={packages}
            brandId={brandId}
            onInsertText={onInsertText}
            onShowToast={onShowToast}
          />

          <ObjectionModal
            open={showObjectionModal}
            onClose={() => setShowObjectionModal(false)}
            prospect={p}
            brandId={brandId}
            onShowToast={onShowToast}
          />

          <OfficialInvoiceModal
            open={showInvoiceModal}
            onClose={() => setShowInvoiceModal(false)}
            prospect={p}
            packages={packages}
            brandId={brandId}
            onInsertText={onInsertText}
            onShowToast={onShowToast}
          />

          <PaymentProofModal
            open={showPaymentProofModal}
            onClose={() => setShowPaymentProofModal(false)}
            prospect={p}
            brandId={brandId}
            onShowToast={onShowToast}
          />

          <FinanceVerifyModal
            open={showFinanceVerifyModal}
            onClose={() => setShowFinanceVerifyModal(false)}
            prospect={p}
            brandId={brandId}
            onShowToast={onShowToast}
          />

          <LostReasonModal
            open={showLostModal}
            onClose={() => setShowLostModal(false)}
            prospect={p}
            brandId={brandId}
            onShowToast={onShowToast}
          />
        </>
      )}
    </div>
  );
}

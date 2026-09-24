import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileCheck2,
  FoldHorizontal,
  GripVertical,
  KanbanSquare,
  List,
  MessageCircleWarning,
  MessageSquareText,
  MoreHorizontal,
  Receipt,
  Search,
  SlidersHorizontal,
  UserPlus2,
  UnfoldHorizontal,
  UserRound,
  X,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  businessDateKey,
  canTransitionStatus,
  canonicalStatus,
  dateOnlyKey,
  isLostStatus,
  isWonStatus,
  objectionLabel,
  pipelineStatuses,
  type ProspectStatus,
} from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { toCsv } from '../../lib/csv';
import { useBrandScope } from '../../lib/scope';
import { queryClient } from '../../app/query';
import { useAuth } from '../../app/auth';
import { Badge, statusLabels } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PageError } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { cn } from '../../lib/cn';
import { ProspectAvatar } from '../../components/ui/avatar';
import { useWhatsAppAvatars } from '../../lib/avatars';
import { OfficialOfferModal } from '../chat/OfficialOfferModal';
import { ObjectionModal } from '../chat/ObjectionModal';
import { OfficialInvoiceModal } from '../chat/OfficialInvoiceModal';
import { PaymentProofModal } from '../chat/PaymentProofModal';
import { FinanceVerifyModal } from '../chat/FinanceVerifyModal';
import { LostReasonModal } from '../chat/LostReasonModal';
import { QualificationModal } from '../chat/QualificationModal';

type Prospect = Record<string, any>;
type GuidedType = 'qualify' | 'offer' | 'objection' | 'invoice' | 'payment_proof' | 'finance_verify' | 'lose';

const money = (value: unknown) =>
  new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0));
const columns = pipelineStatuses.map((id, index) => ({ id, number: index + 1, label: statusLabels[id] ?? id }));
const FINANCE_ROLES = ['finance', 'admin', 'superadmin'];
const COLUMN_PAGE = 30;
const TABLE_PAGE = 100;

const FOLLOWUP_TYPES = [
  { value: 'call', label: 'Telepon' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'meeting', label: 'Pertemuan' },
  { value: 'email', label: 'Email' },
] as const;

const LEAD_SOURCES = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'meta_ads', label: 'Meta Ads' },
  { value: 'website', label: 'Website' },
  { value: 'referral', label: 'Referral' },
  { value: 'walk_in', label: 'Walk-in' },
];

const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const isOpen = (p: Prospect) => !isWonStatus(p.status) && !isLostStatus(p.status);
const lastActivity = (p: Prospect): number | null => p.messages?.[0]?.timestamp ?? null;
const awaitingReply = (p: Prospect) => Boolean(p.messages?.[0] && !p.messages[0].isFromMe) && isOpen(p);

function timeAgo(seconds: number | null) {
  if (!seconds) return null;
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60));
  if (minutes < 60) return `${Math.max(1, minutes)} mnt`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam`;
  return `${Math.round(hours / 24)} hr`;
}

/** Baris kedua kartu: kota, atau nomor bila berbeda dari nama (kontak tanpa nama sudah menampilkan nomor). */
function subtitleOf(p: Prospect) {
  if (p.city) return p.city;
  if (p.phone && digits(p.phone) !== digits(p.name)) return p.phone;
  return null;
}

/**
 * "Menunggu balasan": pesan terakhir percakapan berasal dari jamaah (bisa di tahap mana pun, mis. jamaah
 * bertanya lagi setelah penawaran). Bukan berarti CS belum pernah membalas.
 */
/** Filter cepat. Semuanya dihitung di klien dengan helper yang sama dengan backend (tanggal bisnis WIB). */
const QUICK_FILTERS: { id: string; label: string; test(p: Prospect, today: string): boolean }[] = [
  { id: 'all', label: 'Semua', test: () => true },
  { id: 'reply', label: 'Menunggu balasan', test: (p) => awaitingReply(p) },
  { id: 'today', label: 'Follow-up hari ini', test: (p, today) => isOpen(p) && dateOnlyKey(p.nextFollowupDate) === today },
  { id: 'overdue', label: 'Follow-up terlambat', test: (p, today) => { const d = dateOnlyKey(p.nextFollowupDate); return isOpen(p) && d !== null && d < today; } },
  { id: 'unassigned', label: 'Belum ada PIC', test: (p) => isOpen(p) && !p.userId },
  { id: 'hot', label: 'Minat tinggi', test: (p) => ['offer', 'offered', 'closing'].includes(p.status) },
  { id: 'won', label: 'Deal', test: (p) => isWonStatus(p.status) },
  { id: 'lost', label: 'Batal', test: (p) => isLostStatus(p.status) },
];

/**
 * Apa yang terjadi bila kartu dilepas di kolom tertentu. Kolom Baru/Terhubung diisi otomatis oleh sistem,
 * kolom lain membuka langkah resmi (penawaran, invoice, verifikasi, dst.) — label ini ditampilkan saat drag.
 */
function dropAction(target: ProspectStatus, prospect: Prospect | undefined, role?: string) {
  if (!prospect) return { allowed: false, label: '' };
  if (canonicalStatus(prospect.status) === target) return { allowed: false, label: 'Kolom saat ini' };
  if (target === 'new') return { allowed: false, label: 'Otomatis saat prospek masuk' };
  if (target === 'contact') return { allowed: false, label: 'Otomatis setelah pesan pertama' };
  if (!canTransitionStatus(prospect.status as ProspectStatus, target)) return { allowed: false, label: 'Deal hanya bisa dibatalkan' };
  const labels: Partial<Record<ProspectStatus, string>> = {
    qualified: 'Lepas untuk kualifikasi',
    offer: 'Lepas untuk buat penawaran resmi',
    objection: 'Lepas untuk catat keberatan',
    followup: 'Lepas untuk catat follow-up',
    closing: 'Lepas untuk kirim invoice',
    deal: FINANCE_ROLES.includes(role ?? '') ? 'Lepas untuk verifikasi pembayaran' : 'Lepas untuk unggah bukti transfer',
    lose: 'Lepas untuk catat alasan batal',
  };
  return { allowed: true, label: labels[target] ?? 'Lepaskan di sini' };
}

/** Info hilang sendiri setelah 5 detik; error tetap tampil sampai ditutup (tidak kritis vs kritis). */
function useToast() {
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((message: string, options?: { error?: boolean }) => {
    const error = Boolean(options?.error);
    setToast({ message, error });
    clearTimeout(timer.current);
    if (!error) timer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { message: toast?.message ?? '', error: toast?.error ?? false, show, dismiss: () => setToast(null) };
}

/** Gulir halus kecuali pengguna meminta gerak minimal (opsi JS tidak ikut aturan CSS reduced-motion). */
const scrollMotion = (): ScrollBehavior =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

function readCollapsed(): string[] {
  try {
    return JSON.parse(localStorage.getItem('pipeline:collapsed') ?? '[]');
  } catch {
    return [];
  }
}

export function PipelinePage() {
  const { user } = useAuth();
  const { brandId, query } = useBrandScope();
  const [params, setParams] = useSearchParams();
  // Filter & tampilan disimpan di URL: tetap sama saat reload dan bisa dibagikan.
  // Split-screen ±700 px hanya memuat ±2 kolom Kanban: di bawah 900 px, Tabel jadi tampilan default.
  const [narrowDefault] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 899px)').matches));
  const viewParam = params.get('view');
  const view = viewParam === 'table' || viewParam === 'kanban' ? viewParam : narrowDefault ? 'table' : 'kanban';
  const quick = params.get('quick') ?? 'all';
  const search = params.get('q') ?? '';
  const filterPaket = params.get('paket') ?? '';
  const filterLeadSource = params.get('sumber') ?? '';
  const setParam = (key: string, value: string | null) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  };

  const [showFilters, setShowFilters] = useState(Boolean(filterPaket || filterLeadSource));
  const [followupFor, setFollowupFor] = useState<Prospect | null>(null);
  const [assignFor, setAssignFor] = useState<Prospect | null>(null);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<ProspectStatus | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  const [guided, setGuided] = useState<{ type: GuidedType; prospect: Prospect } | null>(null);
  const toast = useToast();
  // Kolom/tabel panjang dirender bertahap agar board tetap ringan (virtualize-lists: 50+ item).
  const [columnLimit, setColumnLimit] = useState<Record<string, number>>({});
  const [tableLimit, setTableLimit] = useState(TABLE_PAGE);

  const isCs = user?.role === 'cs';
  const isManager = user?.role === 'admin' || user?.role === 'superadmin';

  const prospects = useQuery({
    queryKey: ['prospects', brandId],
    queryFn: () => api.get<Prospect[]>(`/prospects${query}`),
    enabled: !!brandId,
  });
  const packages = useQuery({
    queryKey: ['packages', brandId],
    queryFn: () => api.get<any[]>(`/catalog/packages${query}`),
    enabled: !!brandId,
  });

  const photoFor = useWhatsAppAvatars(prospects.data, brandId);

  const packageOptions = useMemo(
    () => (packages.data ?? []).map((p) => ({ value: String(p.id), label: p.name })),
    [packages.data],
  );

  // Pencarian + filter paket + sumber lead diterapkan bersama (AND), lalu filter cepat di atasnya.
  const today = businessDateKey();
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (prospects.data ?? []).filter((p) => {
      if (q && !`${p.name} ${p.phone ?? ''} ${p.city ?? ''}`.toLowerCase().includes(q)) return false;
      if (filterPaket && p.packageId !== Number(filterPaket)) return false;
      if (filterLeadSource && p.leadSource !== filterLeadSource) return false;
      return true;
    });
  }, [prospects.data, search, filterPaket, filterLeadSource]);
  const quickCounts = useMemo(
    () => Object.fromEntries(QUICK_FILTERS.map((f) => [f.id, base.filter((p) => f.test(p, today)).length])),
    [base, today],
  );
  const activeQuick = QUICK_FILTERS.find((f) => f.id === quick) ?? QUICK_FILTERS[0]!;
  const filtered = useMemo(() => base.filter((p) => activeQuick.test(p, today)), [base, activeQuick, today]);

  const toggleCollapsed = (id: string) => {
    setCollapsed((current) => {
      const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
      try { localStorage.setItem('pipeline:collapsed', JSON.stringify(next)); } catch { /* opsional */ }
      return next;
    });
  };

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.patch(`/prospects/${id}/status`, { status }),
    onMutate: async ({ id, status }) => {
      const queryKey = ['prospects', brandId] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Prospect[]>(queryKey);
      queryClient.setQueryData<Prospect[]>(queryKey, (current) =>
        current?.map((item) => (item.id === id ? { ...item, status } : item)),
      );
      return { previous, queryKey };
    },
    onError: (error: Error, { id }, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
      const name = (prospects.data ?? []).find((p) => p.id === id)?.name ?? 'Prospek';
      toast.show(`${name} tidak dipindahkan: ${error.message}`, { error: true });
    },
    onSuccess: (_data, { id, status }) => {
      const moved = (prospects.data ?? []).find((item) => item.id === id);
      setMoveAnnouncement(`${moved?.name ?? 'Prospek'} dipindahkan ke ${statusLabels[status] ?? status}.`);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  });

  const logFollowup = useMutation({
    mutationFn: (payload: { prospectId: number; type: string; note: string; nextFollowupDate?: string }) =>
      api.post(`/prospects/${payload.prospectId}/activities`, {
        type: payload.type,
        note: payload.note,
        nextFollowupDate: payload.nextFollowupDate,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      toast.show('Follow-up tercatat.');
    },
    onError: (error: Error) => toast.show(`Follow-up gagal dicatat: ${error.message}`, { error: true }),
  });

  const claim = useMutation({
    mutationFn: (id: number) => api.post(`/prospects/${id}/claim`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      toast.show('Anda menjadi PIC prospek ini.');
    },
    onError: (error: Error) => toast.show(`Klaim gagal: ${error.message}`, { error: true }),
  });

  const handleStatusChange = useCallback(
    (id: number, status: string) => {
      const prospect = (prospects.data ?? []).find((p) => p.id === id);
      if (!prospect) return;
      const action = dropAction(status as ProspectStatus, prospect, user?.role);
      if (!action.allowed) {
        setMoveAnnouncement(action.label);
        toast.show(`${statusLabels[status] ?? status}: ${action.label.toLowerCase()}.`);
        return;
      }
      if (status === 'qualified') {
        const totalPax = (prospect.paxQuad ?? 0) + (prospect.paxTriple ?? 0) + (prospect.paxDouble ?? 0) + (prospect.paxInfant ?? 0);
        if (!(prospect.targetMonth && prospect.roomPreference && totalPax > 0)) {
          setGuided({ type: 'qualify', prospect });
          return;
        }
      }
      if (status === 'offer') return setGuided({ type: 'offer', prospect });
      if (status === 'objection') return setGuided({ type: 'objection', prospect });
      if (status === 'closing') return setGuided({ type: 'invoice', prospect });
      if (status === 'deal') {
        return setGuided({ type: FINANCE_ROLES.includes(user?.role ?? '') ? 'finance_verify' : 'payment_proof', prospect });
      }
      if (status === 'lose') return setGuided({ type: 'lose', prospect });
      if (status === 'followup') return setFollowupFor(prospect);
      updateStatus.mutate({ id, status });
    },
    [prospects.data, updateStatus, user?.role, toast],
  );

  function exportCsv() {
    const rows = [
      ['Nama', 'WhatsApp', 'Kota', 'Status', 'PIC', 'Paket', 'Nilai'],
      ...filtered.map((p) => [p.name, p.phone, p.city, statusLabels[p.status] ?? p.status, p.user?.name ?? '', p.package?.name ?? '', Number(p.dealValue) || 0]),
    ];
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'pipeline-csumroh.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  const dragged = (prospects.data ?? []).find((item) => item.id === draggedId);

  function startDrag(event: DragEvent<HTMLElement>, prospect: Prospect) {
    if (updateStatus.isPending) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(prospect.id));
    setDraggedId(prospect.id);
    setMoveAnnouncement(`Memindahkan ${prospect.name}. Pilih kolom tujuan.`);
  }
  function allowDrop(event: DragEvent<HTMLElement>, target: ProspectStatus) {
    if (!dropAction(target, dragged, user?.role).allowed) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverStatus(target);
  }
  function dropCard(event: DragEvent<HTMLElement>, target: ProspectStatus) {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData('text/plain') || draggedId);
    setDraggedId(null);
    setDragOverStatus(null);
    handleStatusChange(id, target);
  }
  function endDrag() { setDraggedId(null); setDragOverStatus(null); }

  // Petunjuk kolom di luar layar: bayangan tepi + tombol geser.
  const boardRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const updateEdges = useCallback(() => {
    const el = boardRef.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 8, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8 });
  }, []);
  useEffect(() => {
    updateEdges();
    window.addEventListener('resize', updateEdges);
    return () => window.removeEventListener('resize', updateEdges);
  }, [updateEdges, view, filtered.length, collapsed]);
  // Tinggi kolom = sisa tinggi layar di bawah board, diukur (bukan ditebak), agar halaman tidak ikut
  // menggulir; hanya isi kolom yang punya scroll.
  const [columnHeight, setColumnHeight] = useState(520);
  useLayoutEffect(() => {
    const measure = () => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return;
      const bottomSpace = 44; // padding bawah <main> + scrollbar horizontal board
      setColumnHeight(Math.max(360, Math.floor(window.innerHeight - (rect.top + window.scrollY) - bottomSpace)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [view, showFilters, prospects.isLoading]);
  const scrollBoard = (direction: 1 | -1) => boardRef.current?.scrollBy({ left: direction * 600, behavior: scrollMotion() });
  const jumpToColumn = (id: string) => {
    if (collapsed.includes(id)) toggleCollapsed(id);
    requestAnimationFrame(() =>
      document.getElementById(`pipeline-col-${id}`)?.scrollIntoView({ behavior: scrollMotion(), inline: 'start', block: 'nearest' }),
    );
  };

  if (!brandId) return <PageError title="Belum ada brand aktif" description="Buat brand melalui menu Brand agar pipeline dapat memakai data prospek sebenarnya." />;
  if (prospects.isError) return <PageError description={prospects.error.message} onRetry={() => void prospects.refetch()} />;

  const activeFiltersCount = [filterPaket, filterLeadSource].filter(Boolean).length;
  const hasAnyFilter = Boolean(search || quick !== 'all' || filterPaket || filterLeadSource);
  const clearAllFilters = () => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      ['q', 'quick', 'paket', 'sumber'].forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
  };
  const columnItems = (id: string) => filtered.filter((p) => canonicalStatus(p.status) === id);
  const cardProps = (p: Prospect) => ({
    prospect: p,
    photoUrl: photoFor(p),
    today,
    canClaim: isCs && !p.userId,
    canAssign: isManager,
    onClaim: () => claim.mutate(p.id),
    onAssign: () => setAssignFor(p),
    onLogFollowup: () => setFollowupFor(p),
    onStatus: (status: string) => handleStatusChange(p.id, status),
    role: user?.role,
  });

  return (
    <div className="app-page space-y-4">
      <PageHeader
        title="Prospek Jamaah"
        subtitle="Kelola perjalanan setiap calon jamaah dari sapaan pertama hingga deal."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 shadow-xs" role="group" aria-label="Tampilan pipeline">
              {([['kanban', 'Papan', KanbanSquare], ['table', 'Tabel', List]] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  aria-pressed={view === id}
                  onClick={() => setParam('view', id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
                    view === id ? 'bg-zinc-950 text-white font-semibold shadow-xs' : 'text-zinc-600 hover:text-zinc-950',
                  )}
                >
                  <Icon size={13} />{label}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={exportCsv}><Download size={14} />Ekspor CSV</Button>
          </div>
        }
      />

      <section className="surface flex flex-col gap-2.5 p-3 xl:flex-row xl:items-start">
        <div className="relative w-full xl:w-72 xl:shrink-0">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setParam('q', e.target.value)}
            aria-label="Cari prospek"
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-8 text-xs text-zinc-900 placeholder:text-zinc-500 shadow-xs outline-none transition focus:border-black focus:ring-1 focus:ring-black"
            placeholder="Cari nama, nomor, atau kota..."
          />
          {search && (
            <button onClick={() => setParam('q', null)} aria-label="Hapus pencarian" className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex flex-1 flex-wrap gap-1.5" role="group" aria-label="Filter cepat">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.id}
              aria-pressed={quick === f.id}
              onClick={() => setParam('quick', f.id)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                quick === f.id ? 'bg-zinc-950 text-white font-semibold shadow-xs' : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950',
              )}
            >
              {f.label}
              <span className={cn('rounded-full px-1.5 text-[11px] tabular-nums', quick === f.id ? 'bg-white/20' : 'bg-zinc-100 text-zinc-600')}>
                {quickCounts[f.id] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
          className={cn(
            'flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium shadow-xs transition',
            showFilters || activeFiltersCount > 0 ? 'border-zinc-950 bg-zinc-950 text-white font-semibold' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400',
          )}
        >
          <SlidersHorizontal size={13} />Filter
          {activeFiltersCount > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[11px] font-bold text-zinc-950">{activeFiltersCount}</span>
          )}
          <ChevronDown size={12} className={cn('transition', showFilters && 'rotate-180')} />
        </button>
      </section>

      {showFilters && (
        <section className="surface flex flex-wrap items-end gap-3 px-4 py-3">
          <div className="min-w-[200px] flex-1">
            <p className="mb-1 text-xs font-semibold text-zinc-500">Paket</p>
            <Select
              value={filterPaket || 'all'}
              onValueChange={(value) => setParam('paket', value === 'all' ? null : value)}
              aria-label="Filter paket"
              options={[{ value: 'all', label: 'Semua paket' }, ...packageOptions]}
              className="w-full"
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <p className="mb-1 text-xs font-semibold text-zinc-500">Sumber lead</p>
            <Select
              value={filterLeadSource || 'all'}
              onValueChange={(value) => setParam('sumber', value === 'all' ? null : value)}
              aria-label="Filter sumber lead"
              options={[{ value: 'all', label: 'Semua sumber' }, ...LEAD_SOURCES]}
              className="w-full"
            />
          </div>
          {activeFiltersCount > 0 && (
            <button onClick={() => { setParam('paket', null); setParam('sumber', null); }} className="min-h-6 rounded px-1.5 py-1 text-xs font-semibold text-zinc-700 underline hover:text-zinc-950">
              Reset filter
            </button>
          )}
        </section>
      )}

      <p className="sr-only" aria-live="polite">{moveAnnouncement}</p>

      {!prospects.isLoading && hasAnyFilter && filtered.length === 0 && (prospects.data ?? []).length > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
          <span>Tidak ada prospek yang cocok dengan pencarian atau filter ini.</span>
          <Button type="button" variant="secondary" size="sm" onClick={clearAllFilters}>Hapus semua filter</Button>
        </div>
      )}

      {prospects.isLoading ? (
        <PipelineSkeleton />
      ) : view === 'kanban' ? (
        <>
          {/* Satu baris ringkas: lompat ke tahap (berguna saat kolom di luar layar) + info/petunjuk. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
            <nav aria-label="Lompat ke tahap" className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-zinc-700">
              <span className="mr-1 font-medium text-zinc-600">Lompat ke</span>
              {columns.map((column) => (
                <button
                  key={column.id}
                  onClick={() => jumpToColumn(column.id)}
                  className="min-h-6 rounded px-1.5 py-1 hover:bg-zinc-100 hover:text-zinc-950"
                >
                  {column.label} <span className="tabular-nums text-zinc-600">{columnItems(column.id).length}</span>
                </button>
              ))}
            </nav>
            <p className="flex items-center gap-1.5 text-zinc-600">
              {dragged ? (
                <><GripVertical size={14} />{dropHint(dragOverStatus, dragged, user?.role)}</>
              ) : filtered.length !== (prospects.data ?? []).length ? (
                <span className="font-semibold">Menampilkan {filtered.length} dari {(prospects.data ?? []).length} prospek</span>
              ) : (
                <><GripVertical size={14} />Tarik kartu atau pakai menu … untuk langkah berikutnya</>
              )}
            </p>
          </div>

          <div className="relative">
            {edges.left && (
              <button
                onClick={() => scrollBoard(-1)}
                aria-label="Geser ke kolom sebelumnya"
                className="absolute -left-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:text-zinc-950"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            {edges.right && (
              <button
                onClick={() => scrollBoard(1)}
                aria-label="Geser ke kolom berikutnya"
                className="absolute -right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:text-zinc-950"
              >
                <ChevronRight size={16} />
              </button>
            )}
            <div ref={boardRef} onScroll={updateEdges} className="thin-scrollbar overflow-x-auto pb-3">
              <div className="flex min-w-max gap-3">
                {columns.map((column) => {
                  const items = columnItems(column.id);
                  const action = dropAction(column.id, dragged, user?.role);
                  const isCollapsed = collapsed.includes(column.id);
                  const total = items.reduce((sum, p) => sum + (Number(p.dealValue) || 0), 0);
                  const isOver = dragOverStatus === column.id && action.allowed;
                  return (
                    <section
                      key={column.id}
                      id={`pipeline-col-${column.id}`}
                      aria-label={`Kolom ${column.label}, ${items.length} prospek`}
                      onDragOver={(event) => allowDrop(event, column.id)}
                      onDragEnter={(event) => allowDrop(event, column.id)}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverStatus(null);
                      }}
                      onDrop={(event) => dropCard(event, column.id)}
                      style={{ height: columnHeight }}
                      className={cn(
                        'flex flex-col rounded-2xl border bg-zinc-100/70 transition-all',
                        isCollapsed ? 'w-14' : 'w-[272px]',
                        dragged && action.allowed && 'border-zinc-400 bg-zinc-100',
                        isOver && 'border-zinc-950 bg-zinc-200/80 ring-2 ring-zinc-950/10',
                        dragged && !action.allowed && 'opacity-45',
                      )}
                    >
                      {isCollapsed ? (
                        <button
                          onClick={() => toggleCollapsed(column.id)}
                          aria-label={`Buka kolom ${column.label}`}
                          className="flex h-full w-full flex-col items-center gap-2 py-3 text-zinc-700 hover:text-zinc-950"
                        >
                          <UnfoldHorizontal size={14} />
                          <span className="rounded-full border border-zinc-200 bg-white px-1.5 text-[11px] font-semibold tabular-nums">{items.length}</span>
                          <span className="text-xs font-semibold [writing-mode:vertical-rl]">{column.label}</span>
                        </button>
                      ) : (
                        <>
                          <header className="shrink-0 space-y-1 px-3 pb-2 pt-3">
                            <div className="flex items-center gap-2">
                              <span className="grid h-6 w-6 place-items-center rounded-lg border border-zinc-300 bg-white text-xs font-bold text-zinc-700">{column.number}</span>
                              <h3 className="flex-1 truncate text-xs font-bold text-zinc-900">{column.label}</h3>
                              <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums text-zinc-700">{items.length}</span>
                              <button
                                onClick={() => toggleCollapsed(column.id)}
                                aria-label={`Lipat kolom ${column.label}`}
                                title="Lipat kolom"
                                className="grid h-6 w-6 place-items-center rounded text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900"
                              >
                                <FoldHorizontal size={13} />
                              </button>
                            </div>
                            <p className="text-xs text-zinc-600">
                              {total > 0 ? <>Potensi <b className="text-zinc-800">Rp {money(total)}</b></> : 'Belum ada nilai penawaran'}
                            </p>
                          </header>
                          <div className={cn('thin-scrollbar flex-1 space-y-2 overflow-y-auto px-2.5 pb-2.5', isOver && 'rounded-xl bg-white/50')}>
                            {dragged && (
                              <p className={cn(
                                'rounded-lg border border-dashed px-2 py-1.5 text-center text-xs',
                                action.allowed ? 'border-zinc-500 text-zinc-800' : 'border-zinc-300 text-zinc-500',
                              )}>
                                {action.label}
                              </p>
                            )}
                            {items.slice(0, columnLimit[column.id] ?? COLUMN_PAGE).map((p) => (
                              <ProspectCard
                                key={p.id}
                                {...cardProps(p)}
                                dragging={draggedId === p.id}
                                disabled={updateStatus.isPending}
                                onDragStart={(event) => startDrag(event, p)}
                                onDragEnd={endDrag}
                              />
                            ))}
                            {items.length > (columnLimit[column.id] ?? COLUMN_PAGE) && (
                              <button
                                type="button"
                                onClick={() => setColumnLimit((current) => ({ ...current, [column.id]: (current[column.id] ?? COLUMN_PAGE) + COLUMN_PAGE }))}
                                className="w-full rounded-lg border border-zinc-300 bg-white py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                              >
                                Tampilkan {Math.min(COLUMN_PAGE, items.length - (columnLimit[column.id] ?? COLUMN_PAGE))} lainnya
                              </button>
                            )}
                            {!items.length && !dragged && (
                              <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-600">Belum ada prospek</div>
                            )}
                          </div>
                        </>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <div className="thin-scrollbar overflow-x-auto">
            <table className="w-full min-w-[960px] text-left">
              <thead className="border-b border-zinc-200 bg-zinc-50/75 text-xs font-semibold uppercase tracking-wider text-zinc-600">
                <tr>
                  <th className="px-5 py-3">Jamaah</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Paket</th>
                  <th className="px-4 py-3">Nilai</th>
                  <th className="px-4 py-3">PIC</th>
                  <th className="px-4 py-3">Follow-up</th>
                  <th className="px-4 py-3">Aktivitas</th>
                  <th className="px-5 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.slice(0, tableLimit).map((p) => {
                  const due = dateOnlyKey(p.nextFollowupDate);
                  return (
                    <tr key={p.id} className="text-sm hover:bg-zinc-50/60">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <ProspectAvatar photoUrl={photoFor(p)} size="sm" className="shrink-0" />
                          <div className="min-w-0">
                            <Link to={`/prospects/${p.id}`} className="font-semibold hover:underline">{p.name}</Link>
                            {subtitleOf(p) && <p className="mt-0.5 text-xs text-zinc-500">{subtitleOf(p)}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4"><Badge value={p.status} /></td>
                      <td className="px-4 text-xs text-zinc-600">{p.package?.name ?? '—'}</td>
                      <td className="px-4 text-xs">{Number(p.dealValue) > 0 ? <b>Rp {money(p.dealValue)}</b> : <span className="text-zinc-500">Belum ada penawaran</span>}</td>
                      <td className="px-4 text-xs">
                        <PicControl prospect={p} canClaim={isCs && !p.userId} canAssign={isManager} onClaim={() => claim.mutate(p.id)} onAssign={() => setAssignFor(p)} />
                      </td>
                      <td className="px-4 text-xs">
                        {due ? (
                          <span className={cn(isOpen(p) && due < today ? 'font-semibold text-zinc-950' : 'text-zinc-600')}>
                            {formatDateKey(due)}{isOpen(p) && due < today ? ' · terlambat' : ''}
                          </span>
                        ) : <span className="text-zinc-500">—</span>}
                      </td>
                      <td className="px-4 text-xs text-zinc-600">
                        {timeAgo(lastActivity(p)) ?? '—'}{awaitingReply(p) && <span className="ml-1 font-semibold text-zinc-950" title="Pesan terakhir dari jamaah dan belum dijawab CS">· menunggu balasan</span>}
                      </td>
                      <td className="px-5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link to={`/inbox?prospectId=${p.id}`} aria-label={`Chat ${p.name}`} title="Buka chat" className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950">
                            <MessageSquareText size={15} />
                          </Link>
                          <button onClick={() => setFollowupFor(p)} aria-label={`Catat follow-up ${p.name}`} title="Catat follow-up" className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950">
                            <ClipboardList size={15} />
                          </button>
                          <Link to={`/prospects/${p.id}`} aria-label={`Buka profil ${p.name}`} title="Buka profil" className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950">
                            <ArrowUpRight size={15} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length && (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-sm text-zinc-600">
                      {hasAnyFilter ? 'Tidak ada prospek yang cocok dengan filter.' : 'Belum ada prospek.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > tableLimit && (
            <div className="border-t border-zinc-200 bg-zinc-50/50 px-4 py-3 text-center">
              <Button type="button" variant="secondary" size="sm" onClick={() => setTableLimit((n) => n + TABLE_PAGE)}>
                Tampilkan {Math.min(TABLE_PAGE, filtered.length - tableLimit)} lainnya dari {filtered.length}
              </Button>
            </div>
          )}
        </div>
      )}

      {followupFor && (
        <FollowupLogDialog
          prospectName={followupFor.name}
          onSave={(payload) => {
            logFollowup.mutate({ prospectId: followupFor.id, ...payload });
            setFollowupFor(null);
          }}
          isSaving={logFollowup.isPending}
          onClose={() => setFollowupFor(null)}
        />
      )}
      {assignFor && (
        <AssignPicDialog
          prospect={assignFor}
          onDone={(message) => { toast.show(message); setAssignFor(null); }}
          onClose={() => setAssignFor(null)}
        />
      )}

      {guided && (
        <>
          <QualificationModal open={guided.type === 'qualify'} onClose={() => setGuided(null)} prospect={guided.prospect} brandId={brandId} onShowToast={toast.show} />
          <OfficialOfferModal open={guided.type === 'offer'} onClose={() => setGuided(null)} prospect={guided.prospect} packages={packages.data ?? []} brandId={brandId} onShowToast={toast.show} />
          <ObjectionModal open={guided.type === 'objection'} onClose={() => setGuided(null)} prospect={guided.prospect} brandId={brandId} onShowToast={toast.show} />
          <OfficialInvoiceModal open={guided.type === 'invoice'} onClose={() => setGuided(null)} prospect={guided.prospect} packages={packages.data ?? []} brandId={brandId} onShowToast={toast.show} />
          <PaymentProofModal open={guided.type === 'payment_proof'} onClose={() => setGuided(null)} prospect={guided.prospect} brandId={brandId} onShowToast={toast.show} />
          <FinanceVerifyModal open={guided.type === 'finance_verify'} onClose={() => setGuided(null)} prospect={guided.prospect} brandId={brandId} onShowToast={toast.show} />
          <LostReasonModal open={guided.type === 'lose'} onClose={() => setGuided(null)} prospect={guided.prospect} brandId={brandId} onShowToast={toast.show} />
        </>
      )}

      {toast.message && (
        <div
          role={toast.error ? 'alert' : 'status'}
          className={cn(
            'fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl px-4 py-3 text-xs font-semibold text-white shadow-lift animate-fade-up',
            toast.error ? 'bg-rose-700' : 'bg-zinc-950',
          )}
        >
          {toast.error && <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
          <span className="flex-1">{toast.message}</span>
          <button onClick={toast.dismiss} aria-label="Tutup notifikasi" className="-my-1 -mr-1.5 grid h-6 w-6 shrink-0 place-items-center rounded text-zinc-300 hover:bg-white/10 hover:text-white"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}

function dropHint(over: ProspectStatus | null, prospect: Prospect, role?: string) {
  if (!over) return `Memindahkan ${prospect.name}: pilih kolom yang aktif.`;
  const action = dropAction(over, prospect, role);
  return action.allowed ? `${statusLabels[over]}: ${action.label}` : `${statusLabels[over]}: ${action.label}`;
}

function formatDateKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function PipelineSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden" aria-busy="true" aria-label="Memuat pipeline">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="h-[420px] w-[272px] shrink-0 space-y-2 rounded-2xl border bg-zinc-100/70 p-3">
          <div className="h-5 w-32 animate-pulse rounded bg-zinc-200" />
          <div className="h-3 w-24 animate-pulse rounded bg-zinc-200" />
          {Array.from({ length: 3 }).map((__, card) => (
            <div key={card} className="h-20 animate-pulse rounded-xl bg-white" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Lencana kartu: palet monokrom (AGENTS §3); hitam penuh = butuh tindakan segera. */
function CardBadge({ urgent, icon: Icon, children, title }: { urgent?: boolean; icon: typeof Bell; children: string; title?: string }) {
  // Satu baris, dibatasi lebar kartu: label tidak pernah patah di dalam pill (Compact Label Overflow).
  return (
    <span title={title} className={cn(
      'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-semibold',
      urgent ? 'bg-zinc-950 text-white' : 'border border-zinc-300 bg-white text-zinc-700',
    )}>
      <Icon size={11} className="shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

function PicControl({ prospect, canClaim, canAssign, onClaim, onAssign }: {
  prospect: Prospect; canClaim: boolean; canAssign: boolean; onClaim(): void; onAssign(): void;
}) {
  if (prospect.user?.name) {
    return canAssign ? (
      <button onClick={onAssign} title="Ganti PIC" className="inline-flex max-w-[180px] items-center gap-1 truncate rounded-md px-1 text-xs text-zinc-700 hover:bg-zinc-100">
        <UserRound size={12} className="shrink-0" /><span className="truncate">{prospect.user.name}</span>
      </button>
    ) : (
      <span className="inline-flex max-w-[180px] items-center gap-1 truncate text-xs text-zinc-700" title="PIC">
        <UserRound size={12} className="shrink-0" /><span className="truncate">{prospect.user.name}</span>
      </span>
    );
  }
  if (canClaim) {
    return (
      <button onClick={onClaim} className="inline-flex min-h-6 items-center gap-1 rounded-md border border-zinc-900 bg-white px-2 py-0.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-100">
        <UserPlus2 size={12} />Klaim
      </button>
    );
  }
  if (canAssign) {
    return (
      <button onClick={onAssign} className="inline-flex items-center gap-1 rounded-md border border-dashed border-zinc-500 px-2 py-0.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100">
        <UserPlus2 size={12} />Tugaskan PIC
      </button>
    );
  }
  return <span className="rounded-md border border-dashed border-zinc-400 px-1.5 py-0.5 text-xs font-semibold text-zinc-600">Belum ada PIC</span>;
}

function ProspectCard({
  prospect, photoUrl, today, role, dragging, disabled, onDragStart, onDragEnd, onStatus, onClaim, onAssign, onLogFollowup, canClaim, canAssign,
}: {
  prospect: Prospect;
  photoUrl: string | null;
  today: string;
  role?: string;
  dragging: boolean;
  disabled: boolean;
  onDragStart(event: DragEvent<HTMLElement>): void;
  onDragEnd(): void;
  onStatus(status: string): void;
  onClaim(): void;
  onAssign(): void;
  onLogFollowup(): void;
  canClaim: boolean;
  canAssign: boolean;
}) {
  const due = dateOnlyKey(prospect.nextFollowupDate);
  const open = isOpen(prospect);
  const followupOverdue = open && due !== null && due < today;
  const followupToday = open && due === today;
  const invoiceOverdue = prospect.status === 'closing' && prospect.invoiceDueAt && new Date(prospect.invoiceDueAt) < new Date();
  const hasProof = Boolean(prospect.paymentProofUrl) && !isWonStatus(prospect.status);
  const unanswered = awaitingReply(prospect);
  const subtitle = subtitleOf(prospect);
  const activity = timeAgo(lastActivity(prospect));
  const value = Number(prospect.dealValue) || 0;
  // Menu "Pindahkan status" hanya berisi langkah yang memang bisa dilakukan manual.
  const moves = pipelineStatuses.filter((status) => dropAction(status, prospect, role).allowed);

  return (
    <article
      aria-label={`Kartu prospek ${prospect.name}`}
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'group cursor-grab rounded-xl border border-zinc-200 bg-white p-3 shadow-2xs transition hover:border-zinc-300 hover:shadow-xs active:cursor-grabbing',
        dragging && 'scale-95 opacity-40 ring-2 ring-zinc-950/20',
        disabled && 'cursor-wait',
      )}
    >
      <div className="flex items-start gap-2">
        <ProspectAvatar photoUrl={photoUrl} size="sm" className="mt-0.5 shrink-0" />
        <Link to={`/prospects/${prospect.id}`} draggable={false} className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-bold text-zinc-950 hover:underline">{prospect.name}</h4>
          <p className="truncate text-xs text-zinc-500">
            {/* Waktu tunggu sudah tampil di lencana "Menunggu balasan"; jangan diulang di sini. */}
            {[subtitle, activity && !unanswered && `aktif ${activity} lalu`].filter(Boolean).join(' · ') || 'Kontak belum lengkap'}
          </p>
        </Link>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="-mr-1 -mt-0.5 rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" aria-label={`Aksi ${prospect.name}`}>
            <MoreHorizontal size={16} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" className="z-50 w-60 rounded-xl border bg-white p-1 shadow-lift">
              <DropdownMenu.Item onSelect={onLogFollowup} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs outline-none data-[highlighted]:bg-zinc-100">
                <ClipboardList size={13} className="text-zinc-500" />Catat follow-up
              </DropdownMenu.Item>
              {canAssign && (
                <DropdownMenu.Item onSelect={onAssign} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs outline-none data-[highlighted]:bg-zinc-100">
                  <UserPlus2 size={13} className="text-zinc-500" />{prospect.userId ? 'Ganti PIC' : 'Tugaskan PIC'}
                </DropdownMenu.Item>
              )}
              {moves.length > 0 && (
                <>
                  <DropdownMenu.Separator className="my-1 border-t border-zinc-100" />
                  <p className="px-2 py-1.5 text-xs font-semibold text-zinc-500">Langkah berikutnya</p>
                  {moves.map((status) => (
                    <DropdownMenu.Item
                      key={status}
                      onSelect={() => onStatus(status)}
                      className="cursor-pointer rounded-lg px-2 py-2 text-xs outline-none data-[highlighted]:bg-zinc-100"
                    >
                      <span className="font-semibold">{statusLabels[status]}</span>
                      <span className="block text-xs text-zinc-500">{dropAction(status, prospect, role).label.replace(/^Lepas untuk /, '')}</span>
                    </DropdownMenu.Item>
                  ))}
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="mt-2 flex min-w-0 items-baseline gap-2">
        {value > 0 ? (
          <span className="shrink-0 whitespace-nowrap text-sm font-extrabold tabular-nums text-zinc-900">Rp {money(value)}</span>
        ) : (
          <span className="shrink-0 text-xs text-zinc-500">Belum ada penawaran</span>
        )}
      </div>
      {/* Nama paket dibungkus (maks. 2 baris), bukan dipotong dengan teks lengkap yang hanya ada di hover. */}
      {prospect.package?.name && (
        <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-zinc-600">{prospect.package.name}</p>
      )}

      {(unanswered || invoiceOverdue || followupOverdue || followupToday || hasProof || prospect.status === 'closing' || prospect.status === 'objection') && (
        <div className="mt-2 flex flex-wrap gap-1">
          {unanswered && (
            <CardBadge urgent icon={MessageCircleWarning} title="Pesan terakhir dari jamaah dan belum dijawab CS">
              {activity ? `Menunggu balasan · ${activity}` : 'Menunggu balasan'}
            </CardBadge>
          )}
          {invoiceOverdue && <CardBadge urgent icon={AlertTriangle}>Invoice lewat</CardBadge>}
          {!invoiceOverdue && prospect.status === 'closing' && <CardBadge icon={Receipt}>Invoice terkirim</CardBadge>}
          {hasProof && <CardBadge icon={FileCheck2}>Bukti ada</CardBadge>}
          {prospect.status === 'objection' && <CardBadge icon={AlertTriangle}>{objectionLabel(prospect.objectionCategory)}</CardBadge>}
          {followupOverdue && <CardBadge urgent icon={CalendarClock}>Follow-up lewat</CardBadge>}
          {followupToday && <CardBadge icon={Bell}>Follow-up hari ini</CardBadge>}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-zinc-100 pt-2">
        <PicControl prospect={prospect} canClaim={canClaim} canAssign={canAssign} onClaim={onClaim} onAssign={onAssign} />
        <div className="flex shrink-0 items-center gap-0.5">
          {due && !followupOverdue && !followupToday && open && (
            <span className="mr-1 inline-flex items-center gap-1 text-xs text-zinc-500" title="Follow-up berikutnya">
              <CalendarDays size={11} />{formatDateKey(due)}
            </span>
          )}
          <Link
            to={`/inbox?prospectId=${prospect.id}&brandId=${prospect.brandId}`}
            draggable={false}
            aria-label={`Buka chat ${prospect.name}`}
            title="Buka chat WhatsApp"
            className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
          >
            <MessageSquareText size={14} />
          </Link>
          <button
            onClick={onLogFollowup}
            aria-label={`Catat follow-up ${prospect.name}`}
            title="Catat follow-up"
            className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
          >
            <ClipboardList size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

/** Admin/Superadmin menugaskan atau melepas PIC; backend memvalidasi CS aktif dengan akses brand prospek. */
function AssignPicDialog({ prospect, onDone, onClose }: { prospect: Prospect; onDone(message: string): void; onClose(): void }) {
  const [userId, setUserId] = useState<string>(prospect.userId ? String(prospect.userId) : '');
  const staff = useQuery({
    queryKey: ['staff', prospect.brandId],
    queryFn: () => api.get<any[]>(`/catalog/users?brandId=${prospect.brandId}`),
  });
  const candidates = (staff.data ?? []).filter((s) =>
    s.role === 'cs' && s.isActive && (s.brandId === prospect.brandId || s.userBrands?.some((ub: any) => ub.brand?.id === prospect.brandId)),
  );
  const assign = useMutation({
    mutationFn: (target: number | null) => api.post(`/prospects/${prospect.id}/assign`, { userId: target, brandId: prospect.brandId }),
    onSuccess: (_data, target) => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      const name = candidates.find((c) => c.id === target)?.name;
      onDone(target ? `PIC ${prospect.name} sekarang ${name ?? 'CS terpilih'}.` : `PIC ${prospect.name} dilepas ke antrean.`);
    },
  });

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-white p-6 shadow-lift">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-bold text-zinc-950">Tugaskan PIC</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-zinc-500">
                Pilih CS aktif yang menangani <strong>{prospect.name}</strong>.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-2 hover:bg-zinc-100" aria-label="Tutup"><X size={18} /></Dialog.Close>
          </div>
          <div className="mt-5">
            {staff.isLoading ? (
              <p className="text-xs text-zinc-500">Memuat daftar CS…</p>
            ) : candidates.length === 0 ? (
              <p className="text-xs text-zinc-600">Belum ada CS aktif untuk brand ini. Tambahkan di menu Staff.</p>
            ) : (
              <Select
                value={userId || undefined}
                onValueChange={setUserId}
                aria-label="CS penanggung jawab"
                placeholder="Pilih CS"
                className="w-full"
                options={candidates.map((c) => ({ value: String(c.id), label: c.name }))}
              />
            )}
            {assign.error && <p className="mt-2 text-xs text-red-700" role="alert">{assign.error.message}</p>}
          </div>
          <div className="mt-6 flex items-center justify-between gap-2">
            {prospect.userId ? (
              <Button type="button" variant="ghost" onClick={() => assign.mutate(null)} disabled={assign.isPending}>Lepas PIC</Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>Batal</Button>
              <Button type="button" onClick={() => assign.mutate(Number(userId))} disabled={!userId || assign.isPending || Number(userId) === prospect.userId}>
                {assign.isPending ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FollowupLogDialog({
  prospectName, onSave, isSaving, onClose,
}: {
  prospectName: string;
  onSave(payload: { type: string; note: string; nextFollowupDate?: string }): void;
  isSaving: boolean;
  onClose(): void;
}) {
  const [type, setType] = useState('whatsapp');
  const [note, setNote] = useState('');
  const [nextDate, setNextDate] = useState('');
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    onSave({ type, note: note.trim(), nextFollowupDate: nextDate || undefined });
  }
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-white p-6 shadow-lift">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-zinc-950">
                <ClipboardList size={18} className="text-white" />
              </span>
              <div>
                <Dialog.Title className="text-base font-bold text-zinc-950">Catat follow-up</Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-zinc-500">
                  Interaksi dengan <strong>{prospectName}</strong>
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="rounded-lg p-2 hover:bg-zinc-100" aria-label="Tutup"><X size={18} /></Dialog.Close>
          </div>
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <span className="label">Jenis interaksi</span>
              <div className="mt-1.5 grid grid-cols-4 gap-2" role="group" aria-label="Jenis interaksi">
                {FOLLOWUP_TYPES.map((ft) => (
                  <button
                    key={ft.value}
                    type="button"
                    aria-pressed={type === ft.value}
                    onClick={() => setType(ft.value)}
                    className={cn(
                      'rounded-xl border py-2 text-xs font-semibold transition',
                      type === ft.value ? 'border-zinc-950 bg-zinc-950 text-white' : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-400',
                    )}
                  >
                    {ft.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="followup-note">Catatan *</label>
              <textarea
                id="followup-note"
                className="field mt-1 h-24 resize-none"
                placeholder="Apa yang dibicarakan? Bagaimana respons calon jamaah?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label flex items-center gap-1.5" htmlFor="followup-next">
                <CalendarDays size={13} />Follow-up berikutnya
              </label>
              <input
                id="followup-next"
                type="date"
                className="field mt-1"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
                min={businessDateKey()}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={onClose}>Batal</Button>
              <Button disabled={!note.trim() || isSaving}>{isSaving ? 'Menyimpan...' : 'Simpan catatan'}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

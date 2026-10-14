import { useSessionState } from '../../lib/useSessionState';
import { useInboxNavigation } from './useInboxNavigation';
import { useOnline } from '../../app/pwa';
import { useChatAutoScroll } from './useChatAutoScroll';
import { appendDraft, appendFlyerCaption, useConversationDraft } from './profileDraft';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { businessDateKey, dateOnlyKey, formatCatalogRupiah, isLostStatus, isTakeoverOpen, isWonStatus, targetMonthLabel, waDisconnectReasonText } from '@csumroh/shared-types';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AlertCircle, ArrowLeft, ArrowDown, ArrowUp, CalendarDays, Check, ChevronDown, CornerUpLeft, CreditCard, FileText, HandCoins, ImageIcon, Lock, Menu, MessageSquareText, Video, Paperclip, Plane, RefreshCw, Search, Send, ShieldAlert, ShieldCheck, MapPin, Smartphone, Sparkles, Upload, User, UserPlus2, WifiOff, Smile, X } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, resolveMediaUrl } from '../../lib/api';
import { useWhatsAppAvatars } from '../../lib/avatars';
import { useNow } from '../../lib/useNow';
import { NotificationBell } from '../notifications/NotificationBell';

import { cn } from '../../lib/cn';

import { ChatSidePanel } from './ChatSidePanel';
import { canAccessBrand, useBrandScope } from '../../lib/scope';
import { useAuth } from '../../app/auth';
import { useUiStore } from '../../app/store';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { formatWaNumber } from '../../lib/phone';
import { FLYER_CAPTION_CLOSING, formatWaFlyerCaption, formatWaPackageSummary } from '../packages/packageQuote';
import { unresolvedScript } from './scriptLibrary';

import { picTag, stageTag } from './conversationTags';
import { ConversationTagButton, ConversationTagChip, PicChip, StageChip } from './ConversationTagChip';

import { GalleryBrowser } from '../gallery/GalleryBrowser';
import { QuickReplyPicker } from '../quick-replies/QuickReplyPicker';
import { matchQuickReplies, slashKey, slashQueryAt, unresolvedTokens, useQuickReplies, type QuickReply, type SlashToken } from '../quick-replies/quickRepliesApi';
import { galleryAssetToFile, type GalleryAsset } from '../gallery/galleryApi';
import { EmojiPicker } from './EmojiPicker';
import { autoCompressMedia, formatFileSize } from './mediaCompressor';
import { getInboxQueue, inboxWorkFilters, type InboxWorkFilter } from './inboxFilters';
import { useSpamToggle } from './useSpamToggle';
import { waMessage } from './waFormat';
import { showFeedback } from '../../app/toast';
import { ConfirmDialog, ModalFrame } from '../../components/ui/modal';
import { ImageLightbox } from '../../components/ui/image-lightbox';
import { isTouchDevice } from '../../lib/useMobile';
import { useStableCallback } from '../../lib/useStableCallback';
import { ConversationRow, ContactAvatar } from './ConversationRow';
import { MessageBubble } from './MessageBubble';

const NO_PACKAGES: any[] = [];
const MAX_UPLOAD_MB = 30;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// Intl.DateTimeFormat mahal dibuat berulang; dipakai per pesan di riwayat chat, jadi dibuat sekali.
const dateSeparatorFormat = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long' });
const dateSeparatorFormatWithYear = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

function formatDateSeparator(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return 'Hari ini';
  if (isYesterday) return 'Kemarin';

  return (date.getFullYear() !== now.getFullYear() ? dateSeparatorFormatWithYear : dateSeparatorFormat).format(date);
}



type MediaPreviewState = {
  file: File;
  url: string;
  type: string;
  name: string;
  originalSize: number;
  compressedSize: number;
  savingsPercent: number;
  isCompressed: boolean;
  isPackageFlyer?: boolean;
  packageName?: string;
  packageId?: number;
};

function normalizePhone(value?: string | null) {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  // Nomor WhatsApp selalu internasional; awalan 8 bisa nomor luar negeri (852…, 82…, 81…), bukan 62….
  return digits;
}



/** Jumlah pesan per halaman riwayat chat (sama dengan bawaan API). */
const MESSAGE_PAGE = 40;
// Daftar percakapan bisa ratusan baris: dirender bertahap (mount/unmount ratusan baris membuat ganti brand terasa lama).
const ROW_PAGE = 60;
const ROW_HEIGHT = 72;

/** Penanda akhir daftar: memuat baris berikutnya saat mendekati layar. */
function ListSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') { onVisible(); return; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onVisible(); }, { rootMargin: '600px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible]);
  return <div ref={ref} aria-hidden="true" className="h-px" />;
}

export function InboxPage() {
  const { user } = useAuth();
  const { brandId, query } = useBrandScope();
  const setActiveBrandId = useUiStore((state) => state.setActiveBrandId);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Sync ?brandId= parameter if provided in URL
  const brandParam = searchParams.get('brandId');
  useEffect(() => {
    if (brandParam) {
      const parsed = Number(brandParam);
      if (parsed && parsed !== brandId && canAccessBrand(user, parsed)) {
        setActiveBrandId(parsed);
      }
    }
  }, [brandParam, brandId, setActiveBrandId, user]);

  // Reset selected conversation when switching brand
  useEffect(() => {
    setSelectedId(null);
  }, [brandId]);
  const listKey = `azhan.inbox.${user?.id}:${brandId}`;
  const [search, setSearch] = useSessionState(`${listKey}.search`, '');
  const [chatFilter, setChatFilter] = useSessionState<InboxWorkFilter>(`${listKey}.filter`, 'all');
  const [ownerFilter, setOwnerFilter] = useSessionState(`${listKey}.owner`, 'all');
  const restoreList = useCallback((node: HTMLDivElement | null) => {
    if (node) { try { node.scrollTop = Number(sessionStorage.getItem(`${listKey}.scroll`)) || 0; } catch { /* Optional scroll restore. */ } }
  }, [listKey]);
  const [today, setToday] = useState(() => businessDateKey());
  // Posisi gulir yang dipulihkan harus tetap terjangkau: batas awal mengikuti posisi tersimpan.
  const initialRowLimit = () => {
    try { return Math.max(ROW_PAGE, Math.ceil((Number(sessionStorage.getItem(`${listKey}.scroll`)) || 0) / ROW_HEIGHT) + ROW_PAGE); } catch { return ROW_PAGE; }
  };
  const [rowLimit, setRowLimit] = useState(initialRowLimit);
  useEffect(() => { setRowLimit(initialRowLimit()); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, chatFilter, ownerFilter, search]);
  const showMoreRows = useCallback(() => setRowLimit((limit) => limit + ROW_PAGE), []);

  useEffect(() => {
    // Keep the due queue correct for CS sessions that stay open across midnight WIB.
    const updateDay = () => setToday(businessDateKey());
    const timer = window.setInterval(updateDay, 60_000);
    window.addEventListener('focus', updateDay);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', updateDay);
    };
  }, []);

  const [message, setMessage] = useConversationDraft(`${user?.id}:${brandId}:${selectedId}`);
  const [activeReactionMessageId, setActiveReactionMessageId] = useState<number | null>(null);
  const { mobile, mobileView, sidePanelTab, setSidePanelTab, backToList } = useInboxNavigation();
  const [previewFlyer, setPreviewFlyer] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: number; messageId: string; senderName: string; text: string } | null>(null);
  const [showDeletedMessages, setShowDeletedMessages] = useState(false);
  const [revealedDeletedIds, setRevealedDeletedIds] = useState<Set<number>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  // Identitas tetap untuk gelembung `memo`: tanpa ini setiap ketukan huruf merender ulang seluruh riwayat chat.
  const scrollToMessageStable = useStableCallback((messageId?: string | null) => scrollToMessage(messageId));
  const showToastStable = useStableCallback((text: string) => showToast(text));
  const handleSelectConversationStable = useStableCallback((id: number) => handleSelectConversation(id));
  const insertTextStable = useStableCallback((text: string) => handleInsertDirectText(text));
  const sendFlyerStable = useStableCallback((pkg: any) => openSendFlyerModal(pkg));
  const sendItineraryStable = useStableCallback((pkg: any) => void loadItineraryImageAsMediaPreview(pkg));
  const openPackagePicker = useCallback(() => setShowPackagePickerModal(true), []);
  const closeSidePanel = useStableCallback(() => setSidePanelTab(null));
  const changeSidePanelTab = useStableCallback((tab: Parameters<typeof setSidePanelTab>[0]) => setSidePanelTab(tab));
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPackagePickerModal, setShowPackagePickerModal] = useState(false);
  const [packageSearch, setPackageSearch] = useState('');
  const [packageMonth, setPackageMonth] = useState('all');
  useEffect(() => { setPackageMonth('all'); }, [brandId]);
  const [linkPackageToProspect, setLinkPackageToProspect] = useState(true);
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewState | null>(null);
  // Lampiran yang belum terkirim disimpan per chat: caption flyer ada di draf chat itu, jadi lampirannya harus ikut
  // kembali saat CS membuka chat itu lagi (kalau tidak, caption terkirim tanpa gambar).
  const mediaPreviewRef = useRef(mediaPreview);
  mediaPreviewRef.current = mediaPreview;
  const stashedMedia = useRef(new Map<number, MediaPreviewState>());
  const previousChatRef = useRef<number | null>(null);
  const pendingFlyerChatRef = useRef<number | null>(null);
  const isAdmin = user?.role === 'superadmin' || user?.role === 'admin';
  // Chat yang terbuka saat ini, untuk kiriman yang selesai setelah CS pindah chat.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const focusDraftAfterPanel = useRef(false);
  useEffect(() => {
    if (sidePanelTab || !focusDraftAfterPanel.current) return;
    const frame = requestAnimationFrame(() => {
      focusDraftAfterPanel.current = false;
      adjustTextareaHeight(composerRef.current);
      composerRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [sidePanelTab]);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const [showGalleryPicker, setShowGalleryPicker] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const flyerInputRef = useRef<HTMLInputElement>(null);
  const pendingFlyerPackageRef = useRef<any>(null);
  const emojiPickerContainerRef = useRef<HTMLDivElement>(null);
  const appliedDraftKey = useRef<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ['whatsapp-device', brandId],
    queryFn: () => api.get<{ status: string; phoneNumber?: string | null; disconnectReason?: string | null }>(`/chat/wa/status${query}`),
    enabled: !!brandId,
    refetchInterval: (queryData) => {
      const status = queryData?.state?.data?.status;
      if (status === 'connecting' || status === 'qr_ready') return 2000;
      return 5000;
    },
  });

  const isConnected = sessionQuery.data?.status === 'connected';
  // Putus sesaat: device yang sama sedang tersambung kembali (biasanya beberapa detik). Daftar & riwayat tetap tampil,
  // hanya pengiriman yang ditahan; bukan layar "WhatsApp Tidak Terhubung".
  const isReconnecting = sessionQuery.data?.status === 'connecting' && Boolean(sessionQuery.data?.phoneNumber);
  const canManageDevice = user?.role === 'superadmin' || user?.role === 'admin';

  const conversations = useQuery({
    queryKey: ['conversations', brandId],
    queryFn: () => api.get<any[]>(`/chat/conversations${query}`),
    enabled: !!brandId,
  });

  // Foto profil WhatsApp untuk percakapan teratas (sisanya disalin API di latar belakang saat daftar dimuat).
  const photoFor = useWhatsAppAvatars(conversations.data?.slice(0, 80), brandId);

  const packages = useQuery({
    queryKey: ['packages', brandId],
    queryFn: () => api.get<any[]>(`/catalog/packages${query}`),
    enabled: !!brandId,
  });

  const brandsQuery = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<any[]>('/catalog/brands'),
  });
  const activeBrand = brandsQuery.data?.find((b) => b.id === brandId) ?? user?.brand;

  // Chat yang baru diklik dan URL-nya belum diperbarui (lihat efek di bawah).
  const pendingSelection = useRef<number | null>(null);

  // Riwayat tetap dapat dibaca saat WhatsApp terputus (A10); hanya pengiriman yang dikunci.
  useEffect(() => {
    const items = conversations.data;
    if (!items?.length) {
      setSelectedId(null);
      return;
    }
    const requestedId = Number(searchParams.get('prospectId')) || null;
    // Klik chat mengganti pilihan seketika, tetapi URL baru (React Router: transisi) menyusul sesaat kemudian.
    // Selama URL masih menunjuk chat lama, jangan kembalikan pilihan ke sana: itu menimbulkan kedipan B → A → B.
    if (pendingSelection.current !== null) {
      if (requestedId !== pendingSelection.current) return;
      pendingSelection.current = null;
    }
    const requestedPhone = normalizePhone(searchParams.get('phone'));
    const requestedJid = searchParams.get('jid');
    const requested = items.find((item) => (
      item.id === requestedId
      || item.duplicateIds?.includes(requestedId)
      || (requestedPhone && normalizePhone(item.phone) === requestedPhone)
      || (requestedJid && item.remoteJid === requestedJid)
    ));
    const currentExists = items.some((item) => item.id === selectedId);
    const nextId = requested?.id ?? (currentExists ? selectedId : items[0].id);
    if (nextId !== selectedId) {
      setSelectedId(nextId);
    }
  }, [conversations.data, searchParams, selectedId]);

  useEffect(() => {
    const draft = (location.state as { draft?: string } | null)?.draft;
    if (!draft || appliedDraftKey.current === location.key) return;
    appliedDraftKey.current = location.key;
    setMessage(draft);
    requestAnimationFrame(() => {
      if (composerRef.current) {
        adjustTextareaHeight(composerRef.current);
        composerRef.current.focus();
      }
    });
  }, [location.key, location.state]);

  const selected = conversations.data?.find((item) => item.id === selectedId);
  // Balas cepat: mengetik "/" di kolom pesan membuka daftar template (brand + pribadi), token diisi dari prospek.
  const quickReplies = useQuickReplies(brandId, selected?.id ?? null);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashDismissed = useRef<string | null>(null);
  // Pindah chat: token lama merujuk teks chat sebelumnya.
  useEffect(() => { setSlash(null); slashDismissed.current = null; }, [selectedId]);
  const slashMatches = useMemo(() => (slash ? matchQuickReplies(quickReplies.data ?? [], slash.query) : []), [slash, quickReplies.data]);
  const isPic = Boolean(selected?.userId && selected.userId === user?.id);
  const isUnassigned = !selected?.userId;
  const canReply = isAdmin || isPic || (isUnassigned && user?.role === 'cs');
  // Aturan ambil alih: CS lain boleh mengambil prospek bila jamaah belum dibalas lebih dari 15 menit, hanya pada jam
  // operasional 08.00–22.00 WIB (di luar jam itu PIC tetap terkunci).
  const now = useNow();
  // Brand dengan PIC dikunci: tidak ada ambil alih, hanya Admin yang mengganti PIC.
  const picLocked = Boolean(brandsQuery.data?.find((b) => b.id === (selected?.brandId ?? brandId))?.picLocked);
  const canTakeOver = Boolean(
    selected && user?.role === 'cs' && !isPic && !isUnassigned && !selected.isGroup
    && !isWonStatus(selected.status) && !isLostStatus(selected.status)
    && !picLocked
    && isTakeoverOpen(selected.awaitingSince, now),
  );
  // Hak membalas (role/PIC) dan kemampuan mengirim (perangkat terhubung) dibedakan.
  const online = useOnline();
  const canSend = canReply && isConnected && online;

  const currentPackage = useMemo(() => {
    return packages.data?.find((p) => p.id === (selected?.packageId || selected?.package?.id));
  }, [packages.data, selected?.packageId, selected?.package?.id]);

  // Bulan keberangkatan yang tersedia (YYYY-MM dari tanggal berangkat paket aktif), terurut naik.
  const packageMonthOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const p of packages.data ?? []) {
      const key = p.isActive ? dateOnlyKey(p.departureDate)?.slice(0, 7) : null;
      if (key) keys.add(key);
    }
    return [{ value: 'all', label: 'Semua bulan' }, ...[...keys].sort().map((key) => ({ value: key, label: targetMonthLabel(key) ?? key }))];
  }, [packages.data]);

  const filteredPackages = useMemo(() => {
    const list = (packages.data ?? []).filter((p) =>
      p.isActive && (packageMonth === 'all' || dateOnlyKey(p.departureDate)?.slice(0, 7) === packageMonth));
    const q = packageSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      `${p.name ?? ''} ${p.airline ?? ''} ${p.departureInfo ?? ''} ${p.hotelMakkah ?? ''} ${p.hotelMadinah ?? ''} ${p.price ?? ''} ${p.priceQuad ?? ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [packages.data, packageSearch, packageMonth]);

  const quickReplyChips = [
    { id: 'greeting', label: 'Sapaan', icon: Sparkles },
    { id: 'package', label: 'Ringkasan paket', icon: FileText },
    { id: 'flyer', label: 'Kirim brosur', icon: ImageIcon },
    { id: 'bank', label: 'Rekening resmi', icon: CreditCard },
    { id: 'closing', label: 'Ajak mendaftar', icon: HandCoins },
    { id: 'ppiu', label: 'Legalitas PPIU', icon: ShieldCheck },
    { id: 'address', label: 'Alamat kantor', icon: MapPin },
  ] as const;
  // Prospek yang sudah Deal atau batal tidak lagi diajak mendaftar/transfer (audit C08).
  const prospectClosed = Boolean(selected && (isWonStatus(selected.status) || isLostStatus(selected.status)));
  const visibleQuickReplies = quickReplyChips.filter((chip) => !prospectClosed || (chip.id !== 'bank' && chip.id !== 'closing'));

  function handleInsertTemplate(type: string) {
    if (type === 'flyer') {
      openSendFlyerModal();
      return;
    }
    const travelName = activeBrand?.name || 'Layanan Resmi Umroh';
    const csName = user?.name || 'Customer Service';

    // Naskah cepat mengikuti aturan pustaka script: sapaan netral, satu pertanyaan, tanpa janji di luar data (audit C01, C06–C09).
    let text = '';
    if (type === 'greeting') {
      text = `Assalamu'alaikum, Bapak/Ibu. Saya ${csName} dari ${travelName}. 😊\n\nRencananya ingin berangkat bulan apa?`;
    } else if (type === 'package') {
      text = currentPackage
        ? formatWaPackageSummary(currentPackage, travelName)
        : `Ada beberapa pilihan paket di ${travelName}.\n\nAgar saya kirimkan yang sesuai, rencananya ingin berangkat bulan apa?`;
    } else if (type === 'bank') {
      // Data rekening hanya dari data resmi brand; tanpa data lengkap tidak ada teks yang dibuat.
      const bank = activeBrand?.bankName?.trim();
      const accNumber = activeBrand?.bankAccountNumber?.trim();
      const accHolder = activeBrand?.bankAccountHolder?.trim();
      if (!bank || !accNumber || accNumber === '-' || !accHolder) {
        showToast('Rekening resmi brand belum lengkap.');
        return;
      }
      text = `Pembayaran ${travelName} hanya melalui rekening resmi berikut:\n\n${bank} a/n ${accHolder}\n*${accNumber}*\n\nSetelah transfer, kirim foto bukti transfernya di chat ini untuk diverifikasi tim Finance.`;
    } else if (type === 'closing') {
      // Kuota hanya disebut bila datanya ada dan masih tersisa.
      const quota = currentPackage?.quotaRemaining;
      const quotaLine = currentPackage && typeof quota === 'number' && quota > 0
        ? `Sisa kuota *${currentPackage.name}* saat ini ${quota} orang.\n\n`
        : '';
      text = `${quotaLine}Kalau paketnya sudah cocok, langkah berikutnya pembayaran (DP atau lunas) sesuai invoice resmi.\n\nMasih ada yang ingin ditanyakan sebelum mendaftar?`;
    } else if (type === 'ppiu') {
      const ppiu = activeBrand?.ppiuNumber?.trim();
      if (!ppiu) {
        showToast('Nomor PPIU brand belum diisi.');
        return;
      }
      text = `${travelName} adalah penyelenggara umroh berizin Kemenag (PPIU) dengan nomor izin *${ppiu}*.\n\nNomor ini bisa dicek di situs resmi Kementerian Agama.`;
    } else if (type === 'address') {
      // Alamat dan link Maps hanya dari data resmi brand; yang kosong tidak ditulis, keduanya kosong = tidak ada teks.
      const address = activeBrand?.address?.trim();
      const maps = activeBrand?.gmapsUrl?.trim();
      if (!address && !maps) {
        showToast('Alamat kantor brand belum diisi.');
        return;
      }
      text = waMessage(
        address ? [`Kantor ${travelName} beralamat di:`, address] : `Lokasi kantor ${travelName}:`,
        maps && [address ? 'Lokasi di Google Maps:' : null, maps],
        'Rencananya ingin datang ke kantor hari apa?',
      );
    }

    if (text) {
      handleInsertDirectText(text);
    }
  }

  function handleInsertDirectText(text: string) {
    focusDraftAfterPanel.current = mobile && Boolean(sidePanelTab);
    setMessage(previous => appendDraft(previous, text));
    showToast('Teks ditambahkan ke draft; belum dikirim.');
    requestAnimationFrame(() => {
      if (composerRef.current) {
        adjustTextareaHeight(composerRef.current);
        composerRef.current.focus();
      }
    });
  }

  // Riwayat berhalaman: 100 pesan terbaru dulu; "Muat pesan lebih lama" menambah halaman di atas. Muat ulang
  // (pesan baru, dsb.) mempertahankan jumlah yang sudah dimuat agar pesan lama tidak hilang dari layar.
  const messagesIdentity = `${selectedId ?? ''}:${brandId ?? ''}`;
  // 'Ada pesan lebih lama' disimpan per percakapan: kembali ke chat dari cache (tanpa refetch) tetap menampilkan tombolnya.
  const [hasOlderBy, setHasOlderBy] = useState<Record<string, boolean>>({});
  const [olderLoading, setOlderLoading] = useState(false);
  const messagesUrl = (params: Record<string, number>) =>
    `/chat/prospects/${selectedId}/messages${query}${query ? '&' : '?'}${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`;
  const messages = useQuery({
    queryKey: ['messages', selectedId, brandId],
    queryFn: async () => {
      const identity = messagesIdentity;
      const loaded = queryClient.getQueryData<any[]>(['messages', selectedId, brandId])?.length ?? 0;
      const limit = Math.min(1000, Math.max(MESSAGE_PAGE, loaded));
      const data = await api.get<any[]>(messagesUrl({ limit }));
      setHasOlderBy((current) => ({ ...current, [identity]: data.length >= limit }));
      return data;
    },
    enabled: !!selectedId && !!brandId,
  });

  useQuery({
    queryKey: ['history-sync', selectedId, brandId],
    queryFn: () => api.post(`/chat/prospects/${selectedId}/history-sync`, { ...(query ? { brandId } : {}) }),
    enabled: !!selectedId && !!brandId && isConnected,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { timelineRef, contentRef, showScrollToLatest, scrollToLatest, isFollowing } = useChatAutoScroll(`${brandId}:${selected?.id ?? ''}`, messages.data);

  async function loadOlderMessages() {
    const oldest = messages.data?.[0];
    if (!oldest || olderLoading) return;
    const identity = messagesIdentity;
    setOlderLoading(true);
    try {
      const older = await api.get<any[]>(messagesUrl({ limit: MESSAGE_PAGE, beforeTs: oldest.timestamp, beforeId: oldest.id }));
      // Posisi baca dijaga: tinggi yang bertambah di atas dikompensasi ke scrollTop.
      const timeline = timelineRef.current;
      const previousHeight = timeline?.scrollHeight ?? 0;
      const previousTop = timeline?.scrollTop ?? 0;
      queryClient.setQueryData<any[]>(['messages', selectedId, brandId], (current = []) => {
        const known = new Set(current.map((m) => m.id));
        return [...older.filter((m) => !known.has(m.id)), ...current];
      });
      setHasOlderBy((current) => ({ ...current, [identity]: older.length >= MESSAGE_PAGE }));
      setOlderLoading(false);
      // Dilewati bila CS sudah kembali mengikuti pesan terbaru (mis. baru mengirim pesan): jangan tarik ke atas lagi.
      requestAnimationFrame(() => { if (timeline && !isFollowing()) timeline.scrollTop = previousTop + (timeline.scrollHeight - previousHeight); });
    } catch (error) {
      setOlderLoading(false);
      showToast((error as Error).message || 'Pesan lama gagal dimuat');
    }
  }

  // Label tanggal (Intl) dihitung sekali per perubahan data, bukan di setiap ketukan huruf di kolom pesan.
  const bubbleItems = useMemo(() => {
    const visible = (messages.data ?? []).filter((item) => item.messageType !== 'protocolMessage' && item.messageType !== 'reactionMessage');
    let previousLabel: string | null = null;
    return visible.map((item) => {
      const dateLabel = formatDateSeparator(item.timestamp);
      const isNewDate = dateLabel !== previousLabel;
      previousLabel = dateLabel;
      return { item, dateLabel, isNewDate };
    });
    // today: label "Hari ini" ikut berganti saat tanggal bisnis berganti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.data, today]);

  function scrollToMessage(messageId?: string | null) {
    if (!messageId) return;
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('bg-emerald-100/60');
      setTimeout(() => {
        el.classList.remove('bg-emerald-100/60');
      }, 2000);
    }
  }

  // Semua data kiriman diambil saat tombol ditekan. onSuccess baru jalan 1–3 detik kemudian, saat CS mungkin sudah
  // membuka chat lain: draft yang dihapus harus draft chat pengirim, bukan chat yang sedang terbuka.
  const send = useMutation({
    mutationFn: (vars: { text: string; prospectId: number | null; quoted: typeof replyingTo; clearDraft: typeof setMessage }) =>
      api.post(`/chat/messages${query}`, {
        brandId,
        prospectId: vars.prospectId,
        text: vars.text,
        quotedMessageId: vars.quoted?.messageId,
        quotedText: vars.quoted?.text,
        quotedSender: vars.quoted?.senderName,
      }),
    onSuccess: (_data, vars) => {
      vars.clearDraft('');
      if (selectedIdRef.current === vars.prospectId) {
        setReplyingTo(null);
        if (composerRef.current) composerRef.current.style.height = '44px';
        // Mengirim pesan = ingin melihatnya: kembali mengikuti pesan terbaru walau CS sedang membaca riwayat di atas.
        scrollToLatest();
      }
      void queryClient.invalidateQueries({ queryKey: ['messages', vars.prospectId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  // Kutipan, lampiran, dan error kirim milik chat sebelumnya tidak boleh terbawa: isi chat jamaah A bisa terkirim ke B.
  const resetSend = send.reset;
  useEffect(() => {
    setReplyingTo(null);
    // Lampiran chat yang ditinggalkan disimpan (bukan dibuang) dan dikembalikan saat chat itu dibuka lagi.
    const leaving = previousChatRef.current;
    const current = mediaPreviewRef.current;
    if (current && leaving != null && leaving !== selectedId) stashedMedia.current.set(leaving, current);
    else if (current) URL.revokeObjectURL(current.url);
    previousChatRef.current = selectedId;
    const restored = selectedId != null ? stashedMedia.current.get(selectedId) ?? null : null;
    if (selectedId != null) stashedMedia.current.delete(selectedId);
    setMediaPreview(restored);
    resetSend();
  }, [selectedId, brandId, resetSend]);

  useEffect(() => () => {
    for (const item of stashedMedia.current.values()) URL.revokeObjectURL(item.url);
    stashedMedia.current.clear();
  }, []);

  /** Lampiran selesai disiapkan (async): masuk ke chat asalnya, bukan chat yang kebetulan terbuka sekarang. */
  function attachPreview(chatId: number, preview: MediaPreviewState) {
    if (selectedIdRef.current === chatId) {
      const previous = mediaPreviewRef.current;
      if (previous?.url) URL.revokeObjectURL(previous.url);
      setMediaPreview(preview);
      return;
    }
    const stale = stashedMedia.current.get(chatId);
    if (stale) URL.revokeObjectURL(stale.url);
    stashedMedia.current.set(chatId, preview);
  }

  // Tinggi kotak ketik mengikuti draf chat yang sedang terbuka. Tanpa ini tinggi dari draf panjang chat sebelumnya
  // (mis. caption flyer) terbawa ke chat lain yang draftnya kosong. Dihitung sebelum paint agar tidak berkedip.
  useLayoutEffect(() => {
    adjustTextareaHeight(composerRef.current);
  }, [selectedId, brandId]);

  const starMutation = useMutation({
    mutationFn: (messageId: number) => api.post<{ isStarred?: boolean }>(`/chat/messages/${messageId}/star${query}`),
    onSuccess: (data: any) => {
      void queryClient.invalidateQueries({ queryKey: ['messages', selectedId, brandId] });
      showToast(data?.isStarred ? 'Pesan diberi bintang' : 'Bintang pesan dihapus');
    },
    onError: (err: any) => {
      showToast(err?.message || 'Gagal mengubah status bintang pesan');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (messageId: number) => api.delete(`/chat/messages/${messageId}${query}`),
    onSuccess: () => {
      setDeleteConfirmId(null);
      void queryClient.invalidateQueries({ queryKey: ['messages', selectedId, brandId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      showToast('Pesan berhasil dihapus');
    },
    onError: (err: any) => {
      showToast(err?.message || 'Gagal menghapus pesan');
    },
  });

  const proofFromMessage = useMutation({
    mutationFn: (messageId: number) =>
      api.post(`/prospects/${selectedId}/payment-proof-from-message`, { messageId, brandId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['prospect', selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['verification-queue'] });
      showToast('Bukti transfer dikirim ke antrean verifikasi Finance');
    },
    onError: (err: any) => showToast(err?.message || 'Gagal mengirim bukti ke Finance'),
  });

  const spamToggle = useSpamToggle(brandId, showToast);

  const takeoverMutation = useMutation({
    mutationFn: (prospect: { id: number; brandId?: number }) => api.post(`/prospects/${prospect.id}/takeover`, { brandId: prospect.brandId ?? brandId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      showToast('Anda sekarang PIC percakapan ini.');
    },
    onError: (err: any) => showToast(err?.message || 'Gagal mengambil alih percakapan'),
  });

  const reactMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: number; emoji: string }) =>
      api.post(`/chat/messages/${messageId}/react${query}`, { emoji, brandId }),
    onMutate: async ({ messageId, emoji }) => {
      setActiveReactionMessageId(null);
      const queryKey = ['messages', selectedId, brandId];
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<any[]>(queryKey);
      if (prev) {
        queryClient.setQueryData<any[]>(queryKey, (old) => {
          if (!old) return old;
          return old.map((m) => {
            if (m.id === messageId) {
              const isSame = m.reaction === emoji && m.reactionUserId === user?.id;
              const nextReaction = isSame ? null : emoji;
              return { ...m, reaction: nextReaction, reactionUserId: nextReaction ? user?.id : null };
            }
            return m;
          });
        });
      }
      return { prev, queryKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(context.queryKey, context.prev);
      }
      showToast('Gagal mengirim reaksi WhatsApp');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', selectedId, brandId] });
    },
  });



  const { conversations: filtered, counts: filterCounts } = useMemo(() =>
    getInboxQueue(conversations.data ?? [], {
      work: chatFilter, owner: ownerFilter, userId: user?.id, search, today,
    }), [conversations.data, chatFilter, ownerFilter, user?.id, search, today]);

  const ownerOptions = useMemo(() => {
    const team = new Map<number, string>();
    for (const item of conversations.data ?? []) {
      if (item.userId && item.user?.name && !(user?.role === 'cs' && item.userId === user.id)) {
        team.set(item.userId, item.user.name);
      }
    }
    return [
      { value: 'all', label: 'Semua PIC' },
      ...(user?.role === 'cs' ? [{ value: 'mine', label: 'PIC saya' }] : []),
      { value: 'unassigned', label: 'Belum ada PIC' },
      ...Array.from(team).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ value: `user:${id}`, label: name })),
    ];
  }, [conversations.data, user?.id, user?.role]);

  const activeFilter = inboxWorkFilters.find((filter) => filter.id === chatFilter) ?? inboxWorkFilters[0];

  // Chat yang sedang terbuka = sudah dibaca, apa pun cara membukanya (klik daftar, tautan notifikasi, chat pertama)
  // dan juga saat pesan baru masuk ke chat yang terbuka. Hanya saat tab terlihat. Pemantau (bukan PIC) tidak
  // menghapus tanda belum dibaca milik PIC; server yang memutuskan.
  const selectedUnread = selected?.unreadCount ?? 0;
  useEffect(() => {
    if (!selectedId || selectedUnread <= 0) return;
    const id = selectedId;
    const markRead = () => {
      if (document.visibilityState !== 'visible') return;
      void api.post<{ observerOnly?: boolean }>(`/chat/prospects/${id}/read${query}`).then((result) => {
        if (result?.observerOnly) return;
        queryClient.setQueryData<any[]>(['conversations', brandId], (old) => old?.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
      }).catch(() => null);
    };
    markRead();
    document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [selectedId, selectedUnread, brandId, query]);

  function handleSelectConversation(id: number) {
    // Keep the deep link aligned with the user's choice; otherwise the selection
    // effect immediately restores the prospect/phone/jid from the previous URL.
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('prospectId', String(id));
      if (brandId) next.set('brandId', String(brandId));
      next.delete('phone');
      next.delete('jid');
      next.delete('panel');
      return next;
    }, { state: mobile ? { inboxList: true } : null });
    pendingSelection.current = id;
    setSelectedId(id);
  }

  function adjustTextareaHeight(element: HTMLTextAreaElement | null) {
    if (!element) return;
    element.style.height = 'auto';
    // scrollHeight tidak termasuk border; tanpa tambahan ini teks terpotong 2px dan scrollbar muncul walau satu baris.
    const border = element.offsetHeight - element.clientHeight;
    const fullHeight = element.scrollHeight + border;
    element.style.height = `${Math.max(Math.min(fullHeight, 144), 44)}px`;
    element.style.overflowY = fullHeight > 144 ? 'auto' : 'hidden';
  }

  /** Perbarui token "/" dari teks dan posisi kursor; Esc menutup sampai token berubah. */
  function updateSlash(element: HTMLTextAreaElement) {
    const token = slashQueryAt(element.value, element.selectionStart ?? element.value.length);
    if (!token || slashDismissed.current === slashKey(token)) {
      if (!token) slashDismissed.current = null;
      setSlash(null);
      return;
    }
    setSlash((previous) => {
      if (!previous || previous.query !== token.query || previous.start !== token.start) setSlashIndex(0);
      return token;
    });
  }

  /** Keyboard saat daftar balas cepat terbuka; true bila tombol sudah ditangani (jangan lanjut ke kirim). */
  function handleSlashKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!slash || event.nativeEvent.isComposing) return false;
    const count = slashMatches.length;
    if (event.key === 'ArrowDown' && count) { event.preventDefault(); setSlashIndex((index) => (index + 1) % count); return true; }
    if (event.key === 'ArrowUp' && count) { event.preventDefault(); setSlashIndex((index) => (index - 1 + count) % count); return true; }
    if (event.key === 'Enter' || event.key === 'Tab') {
      // Tanpa hasil: Enter tidak mengirim "/xyz" ke jamaah; Esc menutup daftar lebih dulu bila memang ingin mengirimnya.
      if (event.key === 'Enter' || count) event.preventDefault();
      if (count) pickQuickReply(slashMatches[Math.min(slashIndex, count - 1)]!);
      return true;
    }
    if (event.key === 'Escape') { event.preventDefault(); slashDismissed.current = slashKey(slash); setSlash(null); return true; }
    return false;
  }

  function pickQuickReply(item: QuickReply) {
    const textarea = composerRef.current;
    if (!slash || !textarea) return;
    const next = message.slice(0, slash.start) + item.text + message.slice(slash.end);
    setMessage(next);
    setSlash(null);
    slashDismissed.current = null;
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = slash.start + item.text.length;
      textarea.setSelectionRange(caret, caret);
      adjustTextareaHeight(textarea);
    });
    if (item.missing.length) showToast('Data belum lengkap untuk: ' + item.missing.join(', ') + '. Lengkapi sebelum mengirim.');
  }

  function handleComposerChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setMessage(e.target.value);
    adjustTextareaHeight(e.target);
    updateSlash(e.target);
  }

  useEffect(() => {
    if (!showEmojiPicker) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        emojiPickerContainerRef.current &&
        !emojiPickerContainerRef.current.contains(e.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker]);

  function handleInsertEmoji(emoji: string) {
    const textarea = composerRef.current;
    if (!textarea) {
      setMessage((prev) => prev + emoji);
      return;
    }
    const start = textarea.selectionStart ?? message.length;
    const end = textarea.selectionEnd ?? message.length;
    const nextMessage = message.slice(0, start) + emoji + message.slice(end);
    setMessage(nextMessage);
    requestAnimationFrame(() => {
      textarea.focus();
      const nextPos = start + emoji.length;
      textarea.setSelectionRange(nextPos, nextPos);
      adjustTextareaHeight(textarea);
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    // Token {{...}} yang datanya belum ada (dari balas cepat/script) tidak boleh terkirim apa adanya ke jamaah.
    const unresolved = unresolvedTokens(message);
    if (unresolved.length) {
      showToast('Lengkapi dulu data: ' + unresolved.join(', ') + '.');
      return;
    }
    // Lampiran masih disiapkan (kompres/unduh): kirim sekarang hanya mengirim teksnya tanpa gambar.
    if (isCompressing) {
      showToast('Gambar masih disiapkan.');
      return;
    }
    if (mediaPreview) {
      void handleSendMedia();
    } else if (message.trim() && !send.isPending) {
      sendDraft();
    }
  }

  /** Titik kirim terakhir: draft yang masih memuat {{token}} tidak boleh sampai ke jamaah (audit S15). */
  function sendDraft() {
    if (!canSend) return;
    const text = message.trim();
    if (!text) return;
    // Draf tersimpan di sessionStorage, lampiran tidak: setelah muat ulang, caption flyer bisa tertinggal tanpa gambar.
    if (text.includes(FLYER_CAPTION_CLOSING)) {
      showToast('Caption flyer belum ada gambarnya.');
      return;
    }
    if (unresolvedScript(text)) {
      showToast('Draft masih memuat tanda {{…}}.');
      return;
    }
    // Langsung ke pesan terbaru saat kirim; menunggu respons API membuat tampilan terasa tertahan.
    scrollToLatest();
    send.mutate({ text, prospectId: selectedId, quoted: replyingTo, clearDraft: setMessage });
  }

  function showToast(msg: string) {
    showFeedback(msg);
  }

  function openSendFlyerModal(targetPkg?: any) {
    if (!selectedId) {
      showToast('Pilih kontak obrolan terlebih dahulu');
      return;
    }
    const pkgToUse = targetPkg || currentPackage;
    if (!pkgToUse) {
      setShowPackagePickerModal(true);
      return;
    }
    void loadFlyerAsMediaPreview(pkgToUse);
  }

  async function loadFlyerAsMediaPreview(pkg: any) {
    if (!pkg || !selectedId) return;
    const travelName = activeBrand?.name || 'Layanan Resmi Umroh';
    const captionText = formatWaFlyerCaption(pkg, travelName);

    // Caption baru masuk draf setelah gambarnya siap (handleProcessFlyerFile): batal memilih berkas tidak
    // boleh meninggalkan caption flyer tanpa gambar.
    if (!pkg.flyerImage) {
      pendingFlyerChatRef.current = selectedId;
      pendingFlyerPackageRef.current = pkg;
      flyerInputRef.current?.click();
      showToast(`Pilih berkas flyer dari komputer untuk ${pkg.name}`);
      return;
    }

    const chatId = selectedId;
    setIsCompressing(true);
    try {
      const fullUrl = resolveMediaUrl(pkg.flyerImage);
      const res = await fetch(fullUrl);
      if (!res.ok) throw new Error('Gagal mengambil berkas flyer dari server');
      const blob = await res.blob();
      const ext = blob.type === 'image/png' ? 'png' : 'jpg';
      const cleanName = (pkg.name || 'paket').replace(/[^a-zA-Z0-9_-]/g, '_');
      const file = new File([blob], `Flyer_${cleanName}.${ext}`, { type: blob.type || 'image/jpeg' });

      const result = await autoCompressMedia(file);
      const objectUrl = URL.createObjectURL(result.file);

      attachPreview(chatId, {
        file: result.file,
        url: objectUrl,
        type: result.file.type,
        name: `Flyer - ${pkg.name}`,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        savingsPercent: result.savingsPercent,
        isCompressed: result.isCompressed,
        isPackageFlyer: true,
        packageName: pkg.name,
        packageId: pkg.id,
      });

      // setMessage terikat ke chat asal (lihat useConversationDraft): caption masuk ke draf chat itu walau CS sudah pindah.
      setMessage(previous => appendFlyerCaption(previous, captionText));
      if (selectedIdRef.current === chatId) {
        revealComposer();
        showToast(`Flyer ${pkg.name} siap dikirim dengan format resmi`);
      }
    } catch (err: any) {
      console.warn('Fallback loading flyer:', err);
      pendingFlyerChatRef.current = chatId;
      pendingFlyerPackageRef.current = pkg;
      flyerInputRef.current?.click();
      showToast('Pilih gambar flyer manual');
    } finally {
      setIsCompressing(false);
    }
  }

  /** Di HP panel profil menutupi chat: tutup agar pratinjau media dan kolom pesan langsung terlihat dan bisa dikirim. */
  function revealComposer() {
    if (mobile && sidePanelTab) {
      focusDraftAfterPanel.current = true;
      setSidePanelTab(null);
    }
    requestAnimationFrame(() => {
      if (composerRef.current) {
        adjustTextareaHeight(composerRef.current);
        composerRef.current.focus();
      }
    });
  }

  /** Itinerary paket sebagai gambar: dirender server di atas template brand, lalu masuk pratinjau media seperti flyer. */
  async function loadItineraryImageAsMediaPreview(pkg: any) {
    if (!pkg || !selectedId) return;
    const chatId = selectedId;
    setIsCompressing(true);
    try {
      const blob = await api.blob(`/api/v1/catalog/packages/${pkg.id}/itinerary-image`);
      const cleanName = (pkg.name || 'paket').replace(/[^a-zA-Z0-9_-]/g, '_');
      const file = new File([blob], `Itinerary_${cleanName}.png`, { type: 'image/png' });
      attachPreview(chatId, {
        file,
        url: URL.createObjectURL(file),
        type: file.type,
        name: `Itinerary - ${pkg.name}`,
        originalSize: file.size,
        compressedSize: file.size,
        savingsPercent: 0,
        isCompressed: false,
        isPackageFlyer: true,
        packageName: pkg.name,
        packageId: pkg.id,
      });
      // Gambar saja, tanpa caption: nama paket dan tanggal sudah ada di gambar.
      if (selectedIdRef.current === chatId) {
        revealComposer();
        showToast(`Itinerary ${pkg.name} siap dikirim sebagai gambar`);
      }
    } catch (err: any) {
      showToast(err?.message || 'Gagal membuat gambar itinerary.');
    } finally {
      setIsCompressing(false);
    }
  }

  async function handleProcessFlyerFile(file: File) {
    if (!file || !selectedId) return;
    // Paket yang dipilih di chat lain tidak boleh ikut ke chat ini.
    const pendingPkg = pendingFlyerChatRef.current === selectedId ? pendingFlyerPackageRef.current : null;
    const pkg = pendingPkg || currentPackage;
    const travelName = activeBrand?.name || 'Layanan Resmi Umroh';
    const captionText = pkg ? formatWaFlyerCaption(pkg, travelName) : '';
    const chatId = selectedId;

    setIsCompressing(true);
    try {
      const result = await autoCompressMedia(file);
      const objectUrl = URL.createObjectURL(result.file);

      attachPreview(chatId, {
        file: result.file,
        url: objectUrl,
        type: result.file.type,
        name: `Flyer - ${pkg?.name || file.name}`,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        savingsPercent: result.savingsPercent,
        isCompressed: result.isCompressed,
        isPackageFlyer: true,
        packageName: pkg?.name || 'Paket Umroh',
        packageId: pkg?.id,
      });

      if (captionText) setMessage(previous => appendFlyerCaption(previous, captionText));
      if (selectedIdRef.current === chatId) {
        requestAnimationFrame(() => {
          if (composerRef.current) adjustTextareaHeight(composerRef.current);
        });
        showToast('Flyer berhasil disiapkan');
      }
    } finally {
      setIsCompressing(false);
      pendingFlyerPackageRef.current = null;
      pendingFlyerChatRef.current = null;
    }
  }

  async function handleProcessFile(file: File) {
    if (!file || !selectedId) return;

    // Berkas dikirim sebagai base64 dalam JSON (+33%) dan body API dibatasi 50 MB,
    // jadi batas efektif berkas asli ±37 MB. Tolak lebih awal daripada gagal 413 setelah upload panjang.
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast(`Ukuran file maksimal ${MAX_UPLOAD_MB} MB`);
      return;
    }

    const chatId = selectedId;
    // Auto-compress image to reduce server load
    if (file.type.startsWith('image/') && file.type !== 'image/gif' && file.type !== 'image/svg+xml') {
      setIsCompressing(true);
      try {
        const result = await autoCompressMedia(file);
        const objectUrl = URL.createObjectURL(result.file);
        attachPreview(chatId, {
          file: result.file,
          url: objectUrl,
          type: result.file.type,
          name: result.file.name,
          originalSize: result.originalSize,
          compressedSize: result.compressedSize,
          savingsPercent: result.savingsPercent,
          isCompressed: result.isCompressed,
        });
      } finally {
        setIsCompressing(false);
      }
    } else {
      const objectUrl = URL.createObjectURL(file);
      attachPreview(chatId, {
        file,
        url: objectUrl,
        type: file.type,
        name: file.name,
        originalSize: file.size,
        compressedSize: file.size,
        savingsPercent: 0,
        isCompressed: false,
      });
    }
  }

  async function handleSendMedia(fileToSend?: File, customCaption?: string) {
    if (!canSend) return;
    const targetFile = fileToSend || mediaPreview?.file;
    if (!selectedId || uploadingMedia || !targetFile) return;
    scrollToLatest();
    setUploadingMedia(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
        reader.onerror = reject;
        reader.readAsDataURL(targetFile);
      });

      const mediaType = targetFile.type.startsWith('image/')
        ? 'imageMessage'
        : targetFile.type.startsWith('video/')
        ? 'videoMessage'
        : 'documentMessage';

      const caption = customCaption ?? (message.trim() || '');

      await api.post(`/chat/messages/media${query}`, {
        brandId,
        prospectId: selectedId,
        fileName: targetFile.name,
        mimeType: targetFile.type,
        base64Data: base64,
        packageId: mediaPreview?.packageId,
        mediaType,
        caption,
        quotedMessageId: replyingTo?.messageId,
        quotedText: replyingTo?.text,
        quotedSender: replyingTo?.senderName,
      });

      // Auto link package to prospect if not yet assigned
      if (mediaPreview?.packageId && !selected?.packageId) {
        void api.patch(`/prospects/${selectedId}/profile`, { packageId: mediaPreview.packageId })
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: ['conversations'] });
          })
          .catch(() => null);
      }

      // setMessage di sini milik chat pengirim (closure saat kirim). Lampiran & kutipan hanya dibersihkan bila
      // chat itu masih terbuka; bila sudah pindah, efek pergantian chat sudah membersihkannya.
      setMessage('');
      if (selectedIdRef.current === selectedId) {
        if (mediaPreview?.url) URL.revokeObjectURL(mediaPreview.url);
        setMediaPreview(null);
        setReplyingTo(null);
        if (composerRef.current) composerRef.current.style.height = '44px';
        scrollToLatest();
      } else {
        // CS pindah chat saat mengunggah: lampiran yang baru terkirim tersimpan di chat asal dan harus dibuang.
        const sent = stashedMedia.current.get(selectedId);
        if (sent) URL.revokeObjectURL(sent.url);
        stashedMedia.current.delete(selectedId);
      }
      void queryClient.invalidateQueries({ queryKey: ['messages', selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      showToast('Media berhasil dikirim!');
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengirim media');
    } finally {
      setUploadingMedia(false);
    }
  }

  if (!brandId) return <PageError title="Belum ada brand aktif" description="Buat brand melalui menu Administrasi dan hubungkan WhatsApp untuk menerima percakapan sebenarnya." />;
  if (sessionQuery.isLoading) return <PageLoading label="Memeriksa status perangkat WhatsApp…" />;
  if (conversations.isLoading) return <PageLoading label="Membuka kotak masuk…" />;
  if (conversations.isError) return <PageError description={conversations.error.message} onRetry={() => void conversations.refetch()} />;

  return (
    <div className="inbox-mobile-root relative h-screen w-full overflow-hidden bg-white" data-mobile-view={mobileView}>

      <div className={cn('inbox-workspace', selected && sidePanelTab && 'has-side-panel')}>
        {/* Left Column: WhatsApp Web Conversation List */}
        <aside className={cn(
          'inbox-conversation-list flex flex-col border-r border-[#e9edef] bg-white',
          mobileView === 'chat' && 'hidden md:flex'
        )}>
          {/* WhatsApp Header Bar */}
          <div className="flex h-[60px] items-center justify-between bg-[#f0f2f5] px-4 shrink-0 border-b border-[#e9edef]">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={toggleSidebar}
                className="hidden md:inline-flex lg:hidden p-1.5 rounded-lg text-[#54656f] hover:bg-black/5 hover:text-[#111b21] transition shrink-0 cursor-pointer"
                aria-label="Buka menu navigasi"
              >
                <Menu size={20} />
              </button>
              {brandsQuery.data && brandsQuery.data.length > 1 ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      className="flex items-center gap-3 min-w-0 hover:bg-black/5 p-1 -ml-1 rounded-lg transition text-left cursor-pointer group outline-none"
                      title="Klik untuk ganti sesi WhatsApp Brand"
                    >
                      <div className="relative shrink-0">
                        {activeBrand?.logoUrl ? (
                          <img
                            src={resolveMediaUrl(activeBrand.logoUrl)}
                            alt={activeBrand.name}
                            className="h-10 w-10 rounded-full object-cover shadow-2xs border border-zinc-200 bg-white"
                          />
                        ) : (
                          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#00a884] font-bold text-xs text-white shadow-2xs">
                            {activeBrand?.name ? String(activeBrand.name).slice(0, 2).toUpperCase() : 'WA'}
                          </span>
                        )}
                        {isConnected && (
                          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-[#25d366]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h2 className="font-semibold text-sm text-[#111b21] truncate leading-tight group-hover:text-emerald-700">
                            {activeBrand?.name ?? 'WhatsApp Live Chat'}
                          </h2>
                          <ChevronDown size={14} className="text-zinc-400 group-hover:text-zinc-700 shrink-0" />
                        </div>
                        <p className="text-xs text-[#667781] truncate">
                          {isConnected ? (formatWaNumber(sessionQuery.data?.phoneNumber) ?? 'Terhubung') : isReconnecting ? 'Menyambung ulang…' : 'Terputus'}
                        </p>
                      </div>
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      side="bottom"
                      align="start"
                      sideOffset={8}
                      className="z-50 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl animate-fade-up"
                    >
                      <div className="px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 mb-1">
                        Pilih Sesi WhatsApp Brand
                      </div>
                      {brandsQuery.data.map((b: any) => {
                        const isActive = b.id === brandId;
                        return (
                          <DropdownMenu.Item
                            key={b.id}
                            onSelect={() => {
                              setSearchParams(previous => {
                                const next = new URLSearchParams(previous);
                                next.set('brandId', String(b.id));
                                next.delete('prospectId');
                                next.delete('phone');
                                next.delete('jid');
                                next.delete('panel');
                                return next;
                              });
                              setActiveBrandId(b.id);
                              setSelectedId(null);
                            }}
                            className={cn(
                              "flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer outline-none transition",
                              isActive ? "bg-emerald-50 text-emerald-800 font-bold" : "text-zinc-700 hover:bg-zinc-100"
                            )}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {b.logoUrl ? (
                                <img
                                  src={resolveMediaUrl(b.logoUrl)}
                                  alt={b.name}
                                  className="h-7 w-7 shrink-0 rounded-full object-cover border border-zinc-200 bg-white"
                                />
                              ) : (
                                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-700">
                                  {b.name ? String(b.name).slice(0, 2).toUpperCase() : 'B'}
                                </span>
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-xs">{b.name}</p>
                                <p className="truncate text-xs tabular-nums text-zinc-500">
                                  {b.whatsappSession?.status === 'connected' ? (formatWaNumber(b.whatsappSession.phoneNumber) ?? 'Terhubung') : 'Terputus'}
                                </p>
                              </div>
                            </div>
                            {isActive && <Check size={14} className="text-emerald-600 shrink-0" />}
                          </DropdownMenu.Item>
                        );
                      })}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              ) : (
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    {activeBrand?.logoUrl ? (
                      <img
                        src={resolveMediaUrl(activeBrand.logoUrl)}
                        alt={activeBrand.name}
                        className="h-10 w-10 rounded-full object-cover shadow-2xs border border-zinc-200 bg-white"
                      />
                    ) : (
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-[#00a884] font-bold text-xs text-white shadow-2xs">
                        {activeBrand?.name ? String(activeBrand.name).slice(0, 2).toUpperCase() : 'WA'}
                      </span>
                    )}
                    {isConnected && (
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-[#25d366]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-sm text-[#111b21] truncate leading-tight">
                      {activeBrand?.name ?? 'WhatsApp Live Chat'}
                    </h2>
                    <p className="text-xs text-[#667781] truncate">
                      {isConnected ? (formatWaNumber(sessionQuery.data?.phoneNumber) ?? 'Terhubung') : isReconnecting ? 'Menyambung ulang…' : 'Terputus'}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {/* Inbox tanpa header aplikasi: di layar kecil lonceng notifikasi ada di sini (desktop: rail sidebar). */}
              <NotificationBell placement="header" className="lg:hidden" />
              {isConnected && canManageDevice && (
                <Link to={`/devices/${brandId}`} title="Kelola Perangkat WA">
                  <Button size="icon" variant="ghost" className="text-[#54656f] hover:text-[#111b21]">
                    <Smartphone size={18} />
                  </Button>
                </Link>
              )}
            </div>
          </div>

          {(
            <div className="p-2 border-b border-[#e9edef] bg-white shrink-0 space-y-2">
              {/* Pencarian + filter PIC sebaris agar tidak memakan ruang daftar */}
              <div className="flex items-center gap-2">
              <div className="relative flex min-w-0 flex-1 items-center">
                <Search className="absolute left-3 text-[#54656f]" size={15} />
                <input
                  aria-label="Cari atau mulai chat baru"
                  className="h-9 w-full rounded-lg bg-[#f0f2f5] pl-9 pr-8 text-xs text-[#111b21] placeholder:text-[#8696a0] outline-none transition focus:bg-white focus:ring-1 focus:ring-[#00a884]"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari atau mulai chat baru"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Hapus pencarian"
                    className="absolute right-2.5 text-[#8696a0] hover:text-[#111b21]"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="w-[7.5rem] shrink-0">
                <Select
                  value={ownerFilter}
                  onValueChange={setOwnerFilter}
                  options={ownerOptions}
                  aria-label="Filter penanggung jawab percakapan"
                  size="sm"
                  className="w-full"
                />
              </div>
              </div>
              <div className="mobile-compact-filters scroll-row flex flex-nowrap items-center gap-1.5 text-xs font-medium" role="group" aria-label="Filter pekerjaan CS">
                {inboxWorkFilters.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={(event) => {
                      setChatFilter(filter.id);
                      // Chip di tepi baris yang bisa digeser: bawa ke area terlihat penuh.
                      event.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
                    }}
                    aria-pressed={chatFilter === filter.id}
                    title={filter.description}
                    className={cn(
                      'mobile-compact-control shrink-0 rounded-full px-2.5 py-1.5 transition-colors whitespace-nowrap',
                      chatFilter === filter.id
                        ? 'bg-[#d9fdd3] text-[#008069] font-bold'
                        : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'
                    )}
                  >
                    {filter.label} ({filterCounts[filter.id]})
                  </button>
                ))}
              </div>
              {chatFilter !== 'all' && <p className="px-1 text-xs leading-relaxed text-[#667781]">{activeFilter.description}</p>}

            </div>
          )}

          {isReconnecting && (
            <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs text-zinc-700" role="status">
              <RefreshCw size={13} className="shrink-0 animate-spin text-zinc-500" />
              <span>Menyambung ulang ke WhatsApp… Pesan baru menyusul otomatis.</span>
            </div>
          )}
          {!isConnected && !isReconnecting && (
            <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900" role="status">
              <WifiOff size={14} className="mt-0.5 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p className="font-semibold">WhatsApp terputus</p>
                {waDisconnectReasonText(sessionQuery.data?.disconnectReason) && (
                  <p className="mt-0.5 text-amber-800">{waDisconnectReasonText(sessionQuery.data?.disconnectReason)}</p>
                )}
                {canManageDevice && (
                  <Link to={`/devices/${brandId}`} className="mt-1 inline-flex items-center gap-1 font-semibold underline">
                    <Smartphone size={12} /> Hubungkan
                  </Link>
                )}
              </div>
            </div>
          )}
          {(
            <div ref={restoreList} onScroll={event => { if (event.currentTarget.clientHeight) { try { sessionStorage.setItem(`${listKey}.scroll`, String(event.currentTarget.scrollTop)); } catch { /* Optional scroll restore. */ } } }} className="thin-scrollbar flex-1 overflow-y-auto divide-y divide-[#f0f2f5]">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#8696a0]">
                <p className="font-semibold text-[#54656f]">
                  {search.trim() ? 'Percakapan tidak ditemukan' : chatFilter === 'needs_reply' ? 'Tidak ada pesan yang perlu dibalas' : chatFilter === 'followup' ? 'Tidak ada follow-up jatuh tempo' : chatFilter === 'qualified' ? 'Belum ada jamaah Terkualifikasi' : chatFilter === 'won' ? 'Belum ada jamaah Deal' : chatFilter === 'lost' ? 'Belum ada jamaah Batal' : 'Tidak ada percakapan'}
                </p>
                <button type="button" onClick={() => { setSearch(''); setOwnerFilter('all'); setChatFilter('all'); }} className="mt-3 font-semibold text-[#008069] hover:underline">Tampilkan semua</button>
              </div>
            ) : (
              <>
              {filtered.slice(0, rowLimit).map((item) => (
                <ConversationRow
                  key={item.id}
                  item={item}
                  active={item.id === selectedId}
                  today={today}
                  photoUrl={photoFor(item)}
                  onSelect={handleSelectConversationStable}
                />
              ))}
              {filtered.length > rowLimit && <ListSentinel key={rowLimit} onVisible={showMoreRows} />}
              </>
            )}
            </div>
          )}
        </aside>

        {/* Center Column: WhatsApp Web Chat Space */}
        <section className={cn(
          'inbox-chat flex flex-col bg-white min-w-0',
          mobileView === 'list' && 'hidden md:flex'
        )}>
          {!isConnected && !isReconnecting && !selected ? (
            <div className="grid h-full place-items-center p-8 bg-zinc-50/40">
              <div className="max-w-md text-center">
                <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-amber-50 text-amber-600 border border-amber-200 shadow-sm">
                  <WifiOff size={36} />
                </div>
                <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700">
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                  <span>
                    Status: {sessionQuery.data?.status === 'qr_ready' ? 'Menunggu Scan QR' : sessionQuery.data?.status === 'connecting' ? 'Menghubungkan...' : 'Tidak Terhubung'}
                  </span>
                </div>
                <h2 className="mt-4 font-display text-2xl font-black tracking-tight text-zinc-950">
                  WhatsApp Tidak Terhubung
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                  Perangkat WhatsApp untuk brand <strong>{activeBrand?.name ?? ''}</strong> saat ini tidak terhubung. Riwayat percakapan tetap bisa dibuka dari daftar; pesan baru dan pengiriman menunggu perangkat terhubung.
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  {canManageDevice ? (
                    <Link to={`/devices/${brandId}`}>
                      <Button size="md" className="gap-2 shadow-sm font-bold">
                        <Smartphone size={16} />
                        Hubungkan Perangkat Sekarang
                      </Button>
                    </Link>
                  ) : (
                    <p className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-xs text-zinc-600">
                      Silakan hubungi Administrator untuk menghubungkan perangkat WhatsApp biro ini.
                    </p>
                  )}
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      void sessionQuery.refetch();
                      void conversations.refetch();
                    }}
                    className="gap-2"
                  >
                    <RefreshCw size={14} className={sessionQuery.isFetching ? 'animate-spin' : ''} />
                    Periksa Status
                  </Button>
                </div>
              </div>
            </div>
          ) : selected ? (
            <>
              {/* WhatsApp Web Chat Header */}
              <header className="chat-header flex h-[60px] shrink-0 items-center justify-between border-b border-[#e9edef] bg-[#f0f2f5] px-4">
                <div className="flex flex-1 items-center gap-3 min-w-0 pr-3">
                  {/* Mobile Back Button — di luar area profil agar kliknya tidak ikut membuka/menutup panel. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden mr-0.5 shrink-0 text-[#54656f]"
                    onClick={backToList}
                    aria-label="Kembali ke daftar percakapan"
                  >
                    <ArrowLeft size={18} />
                  </Button>

                  {/* Avatar + nama: satu tombol untuk membuka/menutup panel Profil & Copilot (bisa dengan keyboard). */}
                  <button
                    type="button"
                    onClick={() => setSidePanelTab((prev) => (prev ? null : 'profile'))}
                    title={sidePanelTab ? 'Klik untuk menutup panel samping' : 'Klik untuk membuka profil prospek'}
                    aria-expanded={Boolean(sidePanelTab)}
                    className="flex min-w-0 flex-1 items-center gap-2 md:gap-3 rounded-lg text-left outline-none cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
                  >
                  <ContactAvatar
                    size="md"
                    photoUrl={photoFor(selected)}
                    isGroup={selected.isGroup}
                    isWhatsAppOfficial={selected.remoteJid === '0@s.whatsapp.net' || selected.name === 'WhatsApp'}
                  />

                  <span className="block min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="block min-w-0 flex-1 truncate text-sm font-semibold leading-tight text-[#111b21] md:leading-5">{selected.name}</span>
                    </span>

                    <span className="hidden md:block truncate text-xs text-[#667781]">
                      {selected.remoteJid === '0@s.whatsapp.net' || selected.name === 'WhatsApp'
                        ? 'Akun Resmi WhatsApp'
                        : selected.name?.includes('(Anda)')
                        ? 'Pesan ke nomor Anda sendiri'
                        : selected.isGroup
                        ? 'Grup WhatsApp'
                        : selected.phone
                        ? (selected.phone.startsWith('+') ? selected.phone : `+${selected.phone}`)
                        : 'WhatsApp'}
                    </span>
                    {/* HP: semua badge dalam satu baris di bawah nama (urutan sama dengan desktop: spam, tahap, PIC, brand). */}
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs leading-4 md:hidden">
                      {selected.spamAt && <span className="flex shrink-0"><ConversationTagChip tag={{ key: 'spam', label: 'Spam', tone: 'urgent' }} /></span>}
                      {!selected.isGroup && <span className="flex shrink-0"><StageChip item={selected} /></span>}
                      <span className="flex shrink-0"><PicChip item={selected} /></span>
                      <span className="flex min-w-0 max-w-20" title={activeBrand?.name} aria-label={`Brand: ${activeBrand?.name || activeBrand?.code || brandId}`}>
                        <ConversationTagChip shrinkable tag={{ key: 'brand', label: activeBrand?.code || `Brand ${brandId}`, tone: 'muted' }} />
                      </span>
                    </span>
                  </span>
                  </button>
                </div>

                {/* Right Action Tools */}
                <div className="hidden md:flex items-center gap-2 shrink-0">
                  {/* Kelompok status (satu garis): spam, tahap pipeline, PIC. Chip sama dengan daftar percakapan. */}
                  {selected.spamAt && <ConversationTagChip tag={{ key: 'spam', label: 'Spam', tone: 'urgent' }} />}
                  {!selected.isGroup && stageTag(selected) && (
                    <ConversationTagButton
                      tag={stageTag(selected)!}
                      onClick={() => setSidePanelTab('profile')}
                      title="Status Pipeline (Klik untuk membuka profil)"
                      ariaLabel={`Status ${stageTag(selected)!.label}: buka profil prospek`}
                    />
                  )}

                  {picTag(selected) && (
                    <ConversationTagButton
                      tag={picTag(selected)!}
                      onClick={() => setSidePanelTab('profile')}
                      title={isPic ? 'Anda penanggung jawab chat ini (Klik untuk membuka profil)' : `${picTag(selected)!.title ?? 'Percakapan belum memiliki PIC'} (Klik untuk membuka profil)`}
                    />
                  )}

                  {/* Pemisah: kiri status (label), kanan aksi (tombol). */}
                  <span className="hdr-collapse mx-1 h-5 w-px shrink-0 bg-zinc-300" aria-hidden="true" />

                  {canTakeOver && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-1.5 text-xs font-semibold ml-0.5"
                      onClick={() => takeoverMutation.mutate(selected)}
                      disabled={takeoverMutation.isPending}
                      title={`Jamaah belum dibalas lebih dari 15 menit oleh ${selected.user?.name ?? 'PIC'}`}
                    >
                      <UserPlus2 size={14} />
                      <span className="hdr-label">Ambil alih</span>
                    </Button>
                  )}

                  {!sidePanelTab && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSidePanelTab('profile')}
                      className="gap-1.5 text-xs text-[#54656f] hover:text-[#111b21] hover:bg-black/5"
                      title="Buka Profil Prospek & Copilot"
                      aria-label="Info prospek"
                    >
                      <User size={15} className="text-[#00a884]" />
                      <span className="hdr-label">Info Prospek</span>
                    </Button>
                  )}

                  {canReply && !selected.isGroup && !selected.isOwn && !isWonStatus(selected.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => spamToggle.mutate({ prospectId: selected.id, spam: !selected.spamAt })}
                      disabled={spamToggle.isPending}
                      className={cn('gap-1.5 text-xs hover:bg-black/5', selected.spamAt ? 'text-[#54656f] hover:text-[#111b21]' : 'text-rose-700 hover:text-rose-800')}
                      title={selected.spamAt ? 'Bukan spam' : 'Tandai spam'}
                      aria-label={selected.spamAt ? 'Bukan spam' : 'Tandai spam'}
                    >
                      <ShieldAlert size={15} />
                      <span className="hdr-label">{selected.spamAt ? 'Bukan spam' : 'Tandai spam'}</span>
                    </Button>
                  )}
                </div>
              </header>

              {/* Chat Message Timeline with WhatsApp Web Wallpaper */}
              <div className="relative flex min-h-0 flex-1">
              <div ref={timelineRef} className="thin-scrollbar min-w-0 flex-1 overflow-y-auto wa-chat-bg px-3 py-4 sm:px-6">
                <div ref={contentRef} className="mx-auto max-w-3xl space-y-1.5">
                  {/* Encrypted Notice Banner */}
                  <div className="mb-4 text-center">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#ffeecd] px-3 py-1 text-xs text-[#54656f] shadow-2xs">
                      <ShieldCheck size={12} className="text-[#008069]" />
                      Pesan terenkripsi secara end-to-end oleh WhatsApp
                    </span>
                  </div>

                  {hasOlderBy[messagesIdentity] && !messages.isLoading && (
                    <div className="mb-3 text-center">
                      <button
                        type="button"
                        onClick={() => void loadOlderMessages()}
                        disabled={olderLoading}
                        className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-[#54656f] shadow-2xs hover:bg-white disabled:opacity-60"
                      >
                        {olderLoading ? 'Memuat…' : 'Muat pesan lebih lama'}
                      </button>
                    </div>
                  )}

                  {messages.isLoading && (
                    <div className="space-y-3" role="status" aria-label="Memuat percakapan">
                      <div className="h-14 w-2/3 animate-pulse rounded-lg bg-white/70" />
                      <div className="ml-auto h-16 w-3/4 animate-pulse rounded-lg bg-[#d9fdd3]/70" />
                      <div className="h-12 w-1/2 animate-pulse rounded-lg bg-white/70" />
                    </div>
                  )}

                  {messages.isError && (
                    <div className="mx-auto max-w-sm rounded-2xl border border-red-200 bg-white p-5 text-center shadow-sm">
                      <p className="text-sm font-bold text-red-600">Pesan gagal dimuat</p>
                      <p className="mt-1 text-xs text-zinc-500">{messages.error.message}</p>
                      <Button size="sm" variant="secondary" className="mt-3" onClick={() => void messages.refetch()}>
                        <RefreshCw size={13} />Coba lagi
                      </Button>
                    </div>
                  )}

                  {!messages.isLoading && !messages.isError && messages.data?.length === 0 && (
                    <div className="grid min-h-[260px] place-items-center text-center">
                      <div className="rounded-2xl bg-white/90 p-6 shadow-sm max-w-xs">
                        <MessageSquareText className="mx-auto text-[#00a884]" size={36} />
                        <p className="mt-3 text-sm font-bold text-[#111b21]">Belum ada riwayat pesan</p>
                        <p className="mt-1 text-xs leading-5 text-[#667781]">
                          Pesan baru dan riwayat WhatsApp akan otomatis tersinkronisasi di sini.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Render Message List with WhatsApp Bubbles */}
                  {bubbleItems.map(({ item, dateLabel, isNewDate }) => {
                      return (
                        <MessageBubble
                          key={item.id}
                          item={item}
                          isNewDate={isNewDate}
                          dateLabel={dateLabel}
                          isPickerOpen={activeReactionMessageId === item.id}
                          isRevealedByAdmin={isAdmin && (showDeletedMessages || revealedDeletedIds.has(item.id))}
                          isAdmin={isAdmin}
                          showDeletedMessages={showDeletedMessages}
                          canSend={canSend}
                          canReply={canReply}
                          selected={selected}
                          user={user}
                          composerRef={composerRef}
                          setActiveReactionMessageId={setActiveReactionMessageId}
                          setRevealedDeletedIds={setRevealedDeletedIds}
                          setReplyingTo={setReplyingTo}
                          setDeleteConfirmId={setDeleteConfirmId}
                          setPreviewFlyer={setPreviewFlyer}
                          reactMutate={reactMutation.mutate}
                          starMutate={starMutation.mutate}
                          proofMutate={proofFromMessage.mutate}
                          proofPending={proofFromMessage.isPending}
                          scrollToMessage={scrollToMessageStable}
                          showToast={showToastStable}
                        />
                      );
                    })}
                </div>
              </div>

                {showScrollToLatest && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={scrollToLatest}
                    size="icon"
                    aria-label="Ke pesan terbaru"
                    title="Ke pesan terbaru"
                    className="absolute bottom-3 right-3 z-20 h-11 w-11 rounded-full border-[#d1d7db] bg-white text-[#54656f] shadow-md hover:bg-[#f0f2f5] sm:bottom-4 sm:right-6"
                  >
                    <ArrowDown size={20} aria-hidden="true" />
                  </Button>
                )}
              </div>

              {/* Quick Reply Chips Bar — di HP disembunyikan saat CS sedang mengetik agar chat & kolom teks lebih lega. */}
              {selected && canSend && !(mobile && message.trim()) && (
                <div className="border-t border-[#e9edef] bg-[#f0f2f5] px-3 py-1.5 shrink-0">
                  <div className="quick-reply-row thin-scrollbar mx-auto flex max-w-3xl items-center gap-1.5 overflow-x-auto pb-0.5">
                    {/* Tinggi sama dengan tombol cepat lain agar baris rata dan ringkas; hitam = membuka panel, bukan mengisi pesan. */}
                    <button type="button" onClick={() => setSidePanelTab('copilot')} className="quick-reply-chip inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-950 bg-zinc-950 px-2.5 py-1 text-xs font-semibold text-white md:hidden"><Sparkles size={12} aria-hidden="true" />Script</button>
                    {visibleQuickReplies.map((chip) => {
                      const Icon = chip.icon;
                      return (
                        <button
                          key={chip.id}
                          type="button"
                          onClick={() => handleInsertTemplate(chip.id)}
                          className="quick-reply-chip shrink-0 inline-flex items-center gap-1.5 rounded-full border border-[#e9edef] bg-white px-2.5 py-1 text-xs font-semibold text-[#111b21] shadow-2xs transition hover:bg-[#f0f2f5] active:scale-95 cursor-pointer"
                        >
                          <Icon size={12} className="text-[#008069]" />
                          <span>{chip.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* WhatsApp Web Chat Composer Form or Locked Notice */}
              {isReconnecting ? (
                <div className="border-t border-[#e9edef] bg-[#f0f2f5] p-3.5 shrink-0" role="status">
                  <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-700">
                    <RefreshCw size={15} className="shrink-0 animate-spin text-zinc-500" />
                    <span>WhatsApp sedang menyambung ulang. Pesan bisa dikirim lagi dalam beberapa detik.</span>
                  </div>
                </div>
              ) : !isConnected ? (
                <div className="border-t border-[#e9edef] bg-[#f0f2f5] p-3.5 shrink-0" role="status">
                  <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <WifiOff size={16} className="shrink-0 text-amber-600" />
                    <span>WhatsApp terputus, pesan tidak bisa dikirim.</span>
                  </div>
                </div>
              ) : canReply ? (
                <form onSubmit={submit} className="chat-composer relative border-t border-[#e9edef] bg-[#f0f2f5] p-2.5 sm:px-4 sm:py-2.5 shrink-0">
                  {slash && (
                    <QuickReplyPicker
                      items={slashMatches}
                      activeIndex={Math.min(slashIndex, Math.max(slashMatches.length - 1, 0))}
                      query={slash.query}
                      onPick={pickQuickReply}
                      onHover={setSlashIndex}
                    />
                  )}
                  {/* Hidden file inputs: Dokumen, Foto & Video, dan Flyer Paket */}
                  <input
                    ref={documentInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleProcessFile(file);
                      e.target.value = '';
                    }}
                  />
                  {/* Kirim langsung dari perangkat tanpa menyimpan ke galeri (mis. GIF, MOV) */}
                  <input
                    ref={mediaInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,video/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleProcessFile(file);
                      e.target.value = '';
                    }}
                  />
                  <input
                    ref={flyerInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleProcessFlyerFile(file);
                      e.target.value = '';
                    }}
                  />

                  {/* Autocompress loading indicator */}
                  {isCompressing && (
                    <div className="mx-auto mb-2 max-w-3xl flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2 text-xs text-emerald-800 shadow-2xs animate-pulse">
                      <RefreshCw size={14} className="animate-spin text-[#00a884] shrink-0" />
                      <span className="font-medium">Sedang mengompres gambar otomatis agar tidak membebani server...</span>
                    </div>
                  )}

                  {/* WhatsApp Web Media Preview Card (before sending) */}
                  {mediaPreview && (
                    <div className="mx-auto mb-2 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-150">
                      <div className="relative flex items-center gap-3 rounded-2xl border border-[#e9edef] bg-white p-2.5 shadow-sm">
                        {mediaPreview.type.startsWith('image/') ? (
                          <div className="h-14 w-14 rounded-xl overflow-hidden border border-black/10 shrink-0 bg-zinc-100">
                            <img src={mediaPreview.url} alt="Pratinjau" className="h-full w-full object-cover" />
                          </div>
                        ) : mediaPreview.type.startsWith('video/') ? (
                          <div className="h-14 w-14 rounded-xl overflow-hidden border border-black/10 shrink-0 bg-black">
                            <video src={mediaPreview.url} className="h-full w-full object-cover" />
                          </div>
                        ) : (
                          <div className="grid h-14 w-14 place-items-center rounded-xl bg-purple-50 border border-purple-200 shrink-0">
                            <FileText size={24} className="text-purple-600" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-zinc-900 truncate">{mediaPreview.isPackageFlyer && mediaPreview.packageName ? mediaPreview.packageName : mediaPreview.name}</p>
                          <p className="text-xs text-zinc-500">{formatFileSize(mediaPreview.compressedSize)}</p>
                        </div>
                        {mediaPreview.isPackageFlyer && (
                          <button
                            type="button"
                            onClick={() => setShowPackagePickerModal(true)}
                            className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition cursor-pointer"
                          >
                            Ganti paket
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            URL.revokeObjectURL(mediaPreview.url);
                            setMediaPreview(null);
                          }}
                          className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition cursor-pointer"
                          title="Hapus lampiran"
                          aria-label="Hapus lampiran"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* WhatsApp Web Quoted Reply Preview Bar */}
                  {replyingTo && (
                    <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between rounded-lg border-l-4 border-[#00a884] bg-white p-2.5 shadow-2xs animate-fade-in">
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[#00a884]">
                          <CornerUpLeft size={13} />
                          <span>Membalas {replyingTo.senderName}</span>
                        </div>
                        <p className="truncate text-xs text-[#667781] mt-0.5">{replyingTo.text}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyingTo(null)}
                        className="h-6 w-6 rounded-full flex items-center justify-center text-[#54656f] hover:bg-black/5 hover:text-[#111b21] transition cursor-pointer"
                        title="Batal membalas"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  )}

                  <div className="mx-auto flex max-w-3xl items-end gap-1.5 sm:gap-2">
                    {/* Emoji Button & Picker Popover — hanya desktop; keyboard HP sudah punya emoji. */}
                    {!mobile && <div className="relative shrink-0" ref={emojiPickerContainerRef}>
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker((v) => !v)}
                        aria-label="Pilih Emoji"
                        title="Emoji (WhatsApp Web)"
                        className={cn(
                          'h-10 w-10 flex items-center justify-center rounded-full transition cursor-pointer',
                          showEmojiPicker ? 'text-[#00a884] bg-black/5' : 'text-[#54656f] hover:text-[#111b21] hover:bg-black/5'
                        )}
                      >
                        <Smile size={22} />
                      </button>

                      {showEmojiPicker && (
                        <div className="absolute bottom-12 left-0 z-50 shadow-2xl">
                          <EmojiPicker
                            onSelectEmoji={handleInsertEmoji}
                            onClose={() => setShowEmojiPicker(false)}
                          />
                        </div>
                      )}
                    </div>}

                    {/* Attachment Button & Dropdown Menu (Flyer Paket, Foto & Video, Dokumen) */}
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type="button"
                          aria-label="Lampirkan Dokumen, Foto & Video, atau Flyer Paket"
                          title="Lampirkan berkas atau flyer"
                          className={cn(
                            'h-10 w-10 shrink-0 flex items-center justify-center rounded-full text-[#54656f] hover:text-[#111b21] hover:bg-black/5 transition cursor-pointer',
                            // HP: tombol klip tampil di dalam kolom teks (sisi kanan), seperti WhatsApp.
                            mobile && 'relative z-10 order-2 -ml-11 self-end',
                          )}
                        >
                          <Paperclip size={20} />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          side="top"
                          align={mobile ? 'end' : 'start'}
                          sideOffset={14}
                          className="z-50 min-w-[230px] rounded-2xl bg-white p-2 shadow-2xl border border-zinc-200 animate-in fade-in slide-in-from-bottom-2 duration-150"
                        >
                          {/* Flyer Paket */}
                          <DropdownMenu.Item
                            onClick={() => openSendFlyerModal()}
                            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold text-[#111b21] hover:bg-[#f0f2f5] outline-none cursor-pointer transition border-b border-zinc-100"
                          >
                            <div className="grid h-8 w-8 place-items-center rounded-full bg-emerald-600 text-white shadow-xs shrink-0">
                              <ImageIcon size={16} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1">
                                <p className="font-semibold text-zinc-900">Flyer Paket</p>
                                {currentPackage && (
                                  <span className="text-[9.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 rounded px-1.5 py-0.5">
                                    Terpilih
                                  </span>
                                )}
                              </div>
                              <p className="text-xs font-normal text-zinc-500 truncate">
                                {currentPackage ? currentPackage.name : 'Brosur & jadwal resmi'}
                              </p>
                            </div>
                          </DropdownMenu.Item>

                          {currentPackage && (
                            <DropdownMenu.Item
                              onClick={() => setShowPackagePickerModal(true)}
                              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 outline-none cursor-pointer transition border-b border-zinc-100"
                            >
                              <RefreshCw size={12} className="shrink-0" aria-hidden="true" />
                              <span>Pilih brosur paket lain...</span>
                            </DropdownMenu.Item>
                          )}

                          {/* Foto & Video */}
                          <DropdownMenu.Item
                            onClick={() => setShowGalleryPicker(true)}
                            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold text-[#111b21] hover:bg-[#f0f2f5] outline-none cursor-pointer transition"
                          >
                            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#007bfc] text-white shadow-xs shrink-0">
                              <ImageIcon size={16} />
                            </div>
                            <div>
                              <p className="font-semibold text-zinc-900">Foto & Video</p>
                              <p className="text-xs font-normal text-zinc-500">Gambar, Video</p>
                            </div>
                          </DropdownMenu.Item>

                          {/* Dokumen */}
                          <DropdownMenu.Item
                            onClick={() => documentInputRef.current?.click()}
                            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold text-[#111b21] hover:bg-[#f0f2f5] outline-none cursor-pointer transition"
                          >
                            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#7f66ff] text-white shadow-xs shrink-0">
                              <FileText size={16} />
                            </div>
                            <div>
                              <p className="font-semibold text-zinc-900">Dokumen</p>
                              <p className="text-xs font-normal text-zinc-500">PDF, Word, Excel, ZIP</p>
                            </div>
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>

                    <textarea
                      ref={composerRef}
                      data-chat-composer
                      rows={1}
                      value={message}
                      onChange={handleComposerChange}
                      onKeyUp={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') updateSlash(event.currentTarget); }}
                      onClick={(event) => updateSlash(event.currentTarget)}
                      onBlur={() => setSlash(null)}
                      onKeyDown={(event) => {
                        if (handleSlashKey(event)) return;
                        if (!isTouchDevice() && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      placeholder={mediaPreview ? "Tambahkan keterangan (opsional)..." : "Ketik pesan..."}
                      aria-label="Tulis pesan WhatsApp"
                      className={cn(
                        // Fokus cukup garis hijau tipis ala WhatsApp; cincin hitam global (globals.css) dimatikan di sini.
                        'min-h-10 max-h-36 min-w-0 flex-1 resize-none bg-white py-2.5 text-sm text-[#111b21] placeholder:text-[#8696a0] border border-transparent focus:border-[#00a884]/50 focus:ring-0 outline-none leading-relaxed shadow-2xs',
                        // HP: 44px, sama dengan tombol lampiran dan kirim, agar ketiganya sejajar.
                        mobile ? 'order-1 min-h-11 rounded-[22px] py-2 pl-4 pr-12' : 'rounded-lg px-4',
                      )}
                    />

                    <button
                      type="submit"
                      disabled={!canSend || (!message.trim() && !mediaPreview) || send.isPending || uploadingMedia || isCompressing}
                      style={mobile ? { order: 3 } : undefined}
                      aria-label="Kirim pesan WhatsApp"
                      title={isTouchDevice() ? 'Kirim pesan' : 'Kirim pesan (Enter)'}
                      className={cn(
                        'h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-white transition shadow-xs cursor-pointer',
                        canSend && (message.trim() || mediaPreview) && !send.isPending && !uploadingMedia
                          ? 'bg-[#00a884] hover:bg-[#008f6f] active:scale-95'
                          : 'bg-[#8696a0] opacity-60 cursor-not-allowed'
                      )}
                    >
                      {send.isPending || uploadingMedia ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
                    </button>
                  </div>

                  {send.error && (
                    <div className="mx-auto mt-2 flex max-w-3xl items-center justify-between rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700" role="alert">
                      <div className="flex items-center gap-2">
                        <AlertCircle size={15} className="shrink-0" />
                        <span>{send.error.message}</span>
                      </div>
                      <button
                        type="button"
                        onClick={sendDraft}
                        className="font-bold underline hover:no-underline ml-3 shrink-0"
                      >
                        Coba kirim lagi
                      </button>
                    </div>
                  )}
                </form>
              ) : (
                /* Locked Composer Banner when not Admin and not PIC */
                <div className="border-t border-[#e9edef] bg-[#f0f2f5] p-3.5 shrink-0">
                  <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3.5 shadow-2xs">
                    <div className="flex items-center gap-3 text-xs text-zinc-700">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600 border border-amber-200">
                        <Lock size={16} />
                      </div>
                      <div>
                        {user?.role === 'finance' ? (
                          <>
                            <p className="font-bold text-zinc-950">Finance hanya melihat percakapan</p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              Balasan dikirim oleh PIC{selected.user?.name ? <> (<strong>{selected.user.name}</strong>)</> : ''} atau Admin. Kiriman gambar/PDF jamaah bisa dijadikan bukti transfer dari menu pesannya.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="font-bold text-zinc-950">
                              Hanya Admin dan PIC yang dapat membalas chat
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              Percakapan ini ditugaskan kepada PIC <strong>{selected.user?.name || 'CS lain'}</strong>.{' '}
                              {canTakeOver
                                ? 'Jamaah belum dibalas lebih dari 15 menit, jadi Anda boleh mengambil alih.'
                                : picLocked
                                  ? 'Anda hanya dapat membaca pesan. PIC brand ini dikunci; hanya Admin yang dapat menggantinya.'
                                  : 'Anda hanya dapat membaca pesan. Bila jamaah belum dibalas lebih dari 15 menit pada jam operasional (08.00–22.00 WIB), CS lain boleh mengambil alih.'}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                    {canTakeOver && (
                      <Button
                        size="sm"
                        onClick={() => takeoverMutation.mutate(selected)}
                        disabled={takeoverMutation.isPending}
                        icon={<UserPlus2 size={14} />}
                      >
                        {takeoverMutation.isPending ? 'Memproses…' : 'Ambil alih'}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* WhatsApp Web Default Empty Landing View */
            <div className="grid h-full place-items-center text-center p-8 bg-[#f0f2f5] border-b-[6px] border-[#25d366]">
              <div className="max-w-md">
                <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-50 text-[#00a884] mb-6 shadow-sm border border-emerald-100">
                  <MessageSquareText size={38} />
                </div>
                <h3 className="font-display text-2xl font-light tracking-tight text-[#41525d]">WhatsApp Web</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#667781]">
                  Kirim dan terima pesan WhatsApp secara real-time. Semua percakapan tersinkronisasi langsung dengan WhatsApp di handphone Anda.
                </p>
                <div className="mt-8 flex items-center justify-center gap-2 text-xs text-[#8696a0]">
                  <ShieldCheck size={14} className="text-[#8696a0]" />
                  <span>Terenkripsi secara end-to-end</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right Panel: Profil Prospek & Copilot Script */}
        {selected && sidePanelTab && (
          <ChatSidePanel
            key={`${user?.id}:${brandId}:${selected.id}`}
            connected={isConnected}
            isOpen={Boolean(sidePanelTab)}
            activeTab={sidePanelTab}
            onChangeTab={changeSidePanelTab}
            onClose={closeSidePanel}
            prospectId={selected.id}
            prospectName={selected.name}
            phone={selected.phone}
            packageId={currentPackage?.id ?? selected.packageId}
            packageName={currentPackage?.name}
            brandId={brandId}
            query={query}
            activeBrand={activeBrand}
            packages={packages.data ?? NO_PACKAGES}
            packagesLoading={packages.isPending}
            onInsertText={insertTextStable}
            onSendFlyer={sendFlyerStable}
            onSendItineraryImage={sendItineraryStable}
            onOpenPackagePicker={openPackagePicker}
            onPreviewImage={setPreviewFlyer}
            onShowToast={showToastStable}
            hasInboundMessage={(messages.data ?? []).some((message: any) => !message.isFromMe && !message.isDeleted && !['protocolMessage', 'reactionMessage'].includes(message.messageType))}
          />
        )}
      </div>

      {/* Pratinjau media: komponen bersama (kunci fokus, Escape, fokus kembali ke pemicu). */}
      <ImageLightbox
        open={Boolean(previewFlyer)}
        onClose={() => setPreviewFlyer(null)}
        src={previewFlyer ? resolveMediaUrl(previewFlyer) : ''}
        alt="Pratinjau media"
        download
      />

      <ConfirmDialog
        open={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
        pending={deleteMutation.isPending}
        title="Hapus pesan?"
        description="Pesan dihapus untuk semua orang di chat ini."
        confirmLabel="Hapus untuk semua"
      />

      {/* Galeri media bersama: Foto & Video memilih dari galeri brand (atau mengunggah ke galeri) */}
      <ModalFrame open={showGalleryPicker} onClose={() => setShowGalleryPicker(false)} title="Galeri media">
        <div className="relative flex h-[85vh] max-h-[640px] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl border border-zinc-200">
          {brandId && (
            <GalleryBrowser
              brandId={brandId}
              mode="picker"
              onClose={() => setShowGalleryPicker(false)}
              onPickFromDevice={() => { setShowGalleryPicker(false); mediaInputRef.current?.click(); }}
              onSelect={(asset: GalleryAsset) => {
                setShowGalleryPicker(false);
                void galleryAssetToFile(asset)
                  .then((file) => handleProcessFile(file))
                  .catch((error: Error) => showToast(error.message || 'Gagal mengambil media dari galeri.'));
              }}
            />
          )}
        </div>
      </ModalFrame>

      {/* Package Picker Modal (Brosur & Flyer Paket Umroh) */}
      <ModalFrame open={showPackagePickerModal} onClose={() => setShowPackagePickerModal(false)} title="Kirim flyer brosur paket umroh">
          <div className="relative flex flex-col max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl border border-zinc-200 animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 sm:px-6 sm:py-4 bg-[#f0f2f5]">
              <div className="flex items-center gap-3">
                <div>
                  <p aria-hidden="true" className="font-display text-sm font-bold text-zinc-900">
                    Kirim Flyer Brosur Paket Umroh
                  </p>
                  <p className="hidden text-xs text-zinc-500 sm:block">
                    Pilih paket umroh untuk menyiapkan flyer resmi & rincian jadwal ke WhatsApp prospek
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPackagePickerModal(false)}
                className="h-8 w-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 transition cursor-pointer"
                title="Tutup"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search & Options */}
            <div className="border-b border-zinc-100 p-4 bg-zinc-50/70 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={packageSearch}
                  onChange={(e) => setPackageSearch(e.target.value)}
                  placeholder="Cari paket, maskapai, tanggal, hotel"
                  className="w-full rounded-xl border border-zinc-200 bg-white pl-10 pr-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-500 focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884] outline-none"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="w-40 shrink-0">
                  <Select
                    value={packageMonth}
                    onValueChange={setPackageMonth}
                    options={packageMonthOptions}
                    aria-label="Filter bulan berangkat"
                    size="sm"
                    className="w-full"
                  />
                </div>
                <label className="inline-flex min-w-0 items-center gap-2 text-xs text-zinc-600 font-medium cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={linkPackageToProspect}
                    onChange={(e) => setLinkPackageToProspect(e.target.checked)}
                    className="shrink-0 rounded border-zinc-300 text-[#00a884] focus:ring-[#00a884]"
                  />
                  <span className="truncate">Hubungkan ke profil</span>
                </label>
              </div>
            </div>

            {/* Package List */}
            <div className="thin-scrollbar flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-3">
              {filteredPackages.length === 0 ? (
                <div className="text-center py-12">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-zinc-100 text-zinc-400 mb-3">
                    <Search size={22} />
                  </div>
                  <p className="text-sm font-bold text-zinc-700">Tidak ada paket umroh yang cocok</p>
                  <p className="text-xs text-zinc-400 mt-1">
                    {packageSearch || packageMonth !== 'all' ? 'Coba kata kunci atau bulan yang lain' : 'Belum ada paket umroh aktif pada brand ini'}
                  </p>
                </div>
              ) : (
                filteredPackages.map((pkg) => {
                  const isCurrent = pkg.id === currentPackage?.id;
                  const hasFlyer = Boolean(pkg.flyerImage);
                  const departureStr = pkg.departureDate
                    ? new Date(pkg.departureDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                    : (pkg.departureInfo || 'Sesuai Jadwal');

                  return (
                    <div
                      key={pkg.id}
                      className={cn(
                        'group flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 rounded-2xl border p-3 sm:p-4 transition duration-150',
                        isCurrent
                          ? 'border-emerald-300 bg-emerald-50/40 shadow-xs'
                          : 'border-zinc-200 bg-white hover:border-emerald-300 hover:shadow-xs'
                      )}
                    >
                      <div className="flex items-start gap-3.5 min-w-0 flex-1">
                        {/* Flyer Thumbnail Preview */}
                        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-black/10 bg-zinc-100">
                          {hasFlyer ? (
                            <img
                              src={resolveMediaUrl(pkg.flyerImage)}
                              alt={pkg.name}
                              className="h-full w-full object-cover group-hover:scale-105 transition duration-200"
                              loading="lazy"
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center bg-emerald-50 text-emerald-600">
                              <ImageIcon size={22} />
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-sm text-zinc-900 truncate" title={pkg.name}>{pkg.name}</h4>
                          {!hasFlyer && (
                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800 border border-amber-200">
                                <Upload size={12} className="shrink-0" aria-hidden="true" />Unggah saat kirim
                              </span>
                            </div>
                          )}

                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                            <span className="inline-flex max-w-full min-w-0 items-center gap-1"><CalendarDays size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{departureStr}{pkg.duration ? ` (${pkg.duration})` : ''}</span></span>
                            {pkg.airline && <span className="inline-flex max-w-full min-w-0 items-center gap-1"><Plane size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{pkg.airline}</span></span>}
                          </div>

                          <div className="mt-1 text-xs font-bold text-[#00a884]">
                            Quad mulai {formatCatalogRupiah(pkg.priceQuad || pkg.price) ?? `Rp ${pkg.priceQuad || pkg.price}`}
                          </div>
                        </div>
                      </div>

                      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center sm:justify-end shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-100">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          aria-disabled={isCurrent}
                          onClick={() => {
                            if (isCurrent) return;
                            if (selectedId) {
                              void api.patch(`/prospects/${selectedId}/profile`, {
                                packageId: pkg.id,
                                brandId,
                              })
                                .then(() => {
                                  void queryClient.invalidateQueries({ queryKey: ['prospect', selectedId] });
                                  void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
                                  void queryClient.invalidateQueries({ queryKey: ['prospects'] });
                                  setShowPackagePickerModal(false);
                                  showToast(`Paket berhasil dihubungkan: ${pkg.name}`);
                                })
                                .catch((err: any) => {
                                  showToast(err?.message || 'Gagal mengubah paket umroh');
                                });
                            }
                          }}
                          className={cn(
                            'mobile-compact-control w-full sm:w-auto gap-1 text-xs font-bold',
                            isCurrent
                              ? 'cursor-default !border-emerald-500 !bg-emerald-100 !text-emerald-900 hover:!bg-emerald-100'
                              : 'border-zinc-300 hover:bg-zinc-100 cursor-pointer',
                          )}
                        >
                          <Check size={14} className="text-[#00a884]" />
                          <span>{isCurrent ? 'Paket Terpilih' : 'Pilih Paket'}</span>
                        </Button>

                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            if (linkPackageToProspect && selectedId) {
                              void api.patch(`/prospects/${selectedId}/profile`, {
                                packageId: pkg.id,
                                brandId,
                              })
                                .then(() => {
                                  void queryClient.invalidateQueries({ queryKey: ['prospect', selectedId] });
                                  void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
                                  void queryClient.invalidateQueries({ queryKey: ['prospects'] });
                                })
                                .catch((err: any) => showToast(err?.message || 'Paket gagal dihubungkan ke prospek.'));
                            }
                            setShowPackagePickerModal(false);
                            void loadFlyerAsMediaPreview(pkg);
                          }}
                          className="mobile-compact-control w-full sm:w-auto gap-1.5 bg-[#00a884] hover:bg-[#008f6f] text-white font-bold text-xs shadow-xs cursor-pointer"
                        >
                          <ImageIcon size={14} />
                          <span>Kirim Flyer</span>
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-zinc-200 px-6 py-3 bg-zinc-50 text-xs text-zinc-500">
              <span>Total paket aktif: <strong>{packages.data?.filter((p: any) => p.isActive).length ?? 0}</strong></span>
              <Button variant="ghost" size="sm" className="mobile-compact-control" onClick={() => setShowPackagePickerModal(false)}>
                Tutup
              </Button>
            </div>
          </div>
      </ModalFrame>


    </div>
  );
}


import { appendDraft, appendFlyerCaption, useConversationDraft } from './profileDraft';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { businessDateKey, isLostStatus, isTakeoverOpen, isWonStatus } from '@csumroh/shared-types';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  Copy,
  CornerUpLeft,
  CreditCard,
  Download,
  Eye,
  FileText,
  HandCoins,
  ImageIcon,
  Lock,
  Menu,
  MessageSquareText,
  Megaphone,
  Mic,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  User,
  UserPlus2,
  Users,
  WifiOff,
  Smile,
  X,
} from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, resolveMediaUrl } from '../../lib/api';
import { useWhatsAppAvatars } from '../../lib/avatars';
import { useNow } from '../../lib/useNow';
import { NotificationBell } from '../notifications/NotificationBell';
import { ProspectAvatar } from '../../components/ui/avatar';
import { cn } from '../../lib/cn';
import { ChatSidePanel, type ChatSidePanelTab } from './ChatSidePanel';
import { canAccessBrand, useBrandScope } from '../../lib/scope';
import { useAuth } from '../../app/auth';
import { useUiStore } from '../../app/store';
import { queryClient } from '../../app/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { formatWaFlyerCaption, formatWaPackageSummary } from '../packages/packageQuote';
import { EmojiPicker } from './EmojiPicker';
import { autoCompressMedia, formatFileSize } from './mediaCompressor';
import { getInboxQueue, inboxWorkFilters, type InboxWorkFilter } from './inboxFilters';
import { showFeedback } from '../../app/toast';
import { ConfirmDialog, ModalFrame } from '../../components/ui/modal';
import { ImageLightbox } from '../../components/ui/image-lightbox';

const MAX_UPLOAD_MB = 30;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const QUICK_REACTIONS =['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

function formatDateSeparator(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return 'Hari ini';
  if (isYesterday) return 'Kemarin';

  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function formatWaTimestamp(timestampSeconds?: number): string {
  if (!timestampSeconds) return '';
  const date = new Date(timestampSeconds * 1000);
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
  }

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  if (isYesterday) return 'Kemarin';

  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7 && diffDays >= 0) {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    return days[date.getDay()] ?? '';
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatBubbleTime(timestampSeconds?: number): string {
  if (!timestampSeconds) return '';
  const date = new Date(timestampSeconds * 1000);
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
}

/** Elemen non-tombol yang bisa diklik juga harus bisa diaktifkan dengan Enter/Spasi (WCAG 2.1.1). */
function activateWithKeyboard(event: ReactKeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
}

function normalizePhone(value?: string | null) {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

/**
 * Avatar kontak = foto profil WhatsApp (lihat ProspectAvatar: tanpa foto tampil siluet, bukan inisial).
 * Grup dan akun resmi WhatsApp tetap memakai ikon.
 */
function ContactAvatar({
  photoUrl,
  isGroup,
  isWhatsAppOfficial,
  size = 'md',
}: {
  photoUrl?: string | null;
  isGroup?: boolean;
  isWhatsAppOfficial?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const avatarSize = size === 'sm' ? 'sm' : size === 'lg' ? 'xl' : 'lg';
  if (!isGroup && !isWhatsAppOfficial) return <ProspectAvatar photoUrl={photoUrl} size={avatarSize} />;

  const sizeClass = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 22 : 18;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full shadow-2xs select-none text-white',
        sizeClass,
        isWhatsAppOfficial ? 'bg-[#25d366]' : 'bg-[#00a884]'
      )}
    >
      {isWhatsAppOfficial ? <MessageSquareText size={iconSize} /> : <Users size={iconSize} />}
    </span>
  );
}

export function InboxPage() {
  const { user } = useAuth();
  const { brandId, query } = useBrandScope();
  const setActiveBrandId = useUiStore((state) => state.setActiveBrandId);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const location = useLocation();
  const [searchParams] = useSearchParams();
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
  const [search, setSearch] = useState('');
  const [chatFilter, setChatFilter] = useState<InboxWorkFilter>('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [today, setToday] = useState(() => businessDateKey());

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

  useEffect(() => {
    setOwnerFilter('all');
  }, [brandId]);
  const [message, setMessage] = useConversationDraft(`${user?.id}:${brandId}:${selectedId}`);
  const [activeReactionMessageId, setActiveReactionMessageId] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [previewFlyer, setPreviewFlyer] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: number; messageId: string; senderName: string; text: string } | null>(null);
  const [showDeletedMessages, setShowDeletedMessages] = useState(false);
  const [revealedDeletedIds, setRevealedDeletedIds] = useState<Set<number>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPackagePickerModal, setShowPackagePickerModal] = useState(false);
  const [packageSearch, setPackageSearch] = useState('');
  const [linkPackageToProspect, setLinkPackageToProspect] = useState(true);
  // Di bawah 1280 px panel tampil sebagai dialog modal; jangan dibuka otomatis agar tidak menutupi chat dan navigasi.
  const [sidePanelTab, setSidePanelTab] = useState<ChatSidePanelTab | null>(() =>
    window.matchMedia?.('(max-width: 1279px)').matches ? null : 'profile'
  );
  const [mediaPreview, setMediaPreview] = useState<{
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
  } | null>(null);
  const isAdmin = user?.role === 'superadmin' || user?.role === 'admin';
  const endRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const flyerInputRef = useRef<HTMLInputElement>(null);
  const pendingFlyerPackageRef = useRef<any>(null);
  const emojiPickerContainerRef = useRef<HTMLDivElement>(null);
  const appliedDraftKey = useRef<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ['whatsapp-device', brandId],
    queryFn: () => api.get<{ status: string; phoneNumber?: string | null }>(`/chat/wa/status${query}`),
    enabled: !!brandId,
    refetchInterval: (queryData) => {
      const status = queryData?.state?.data?.status;
      if (status === 'connecting' || status === 'qr_ready') return 2000;
      return 5000;
    },
  });

  const isConnected = sessionQuery.data?.status === 'connected';
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

  // Riwayat tetap dapat dibaca saat WhatsApp terputus (A10); hanya pengiriman yang dikunci.
  useEffect(() => {
    const items = conversations.data;
    if (!items?.length) {
      setSelectedId(null);
      return;
    }
    const requestedId = Number(searchParams.get('prospectId')) || null;
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
      if (requestedId) setMobileView('chat');
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
  const isPic = Boolean(selected?.userId && selected.userId === user?.id);
  const isUnassigned = !selected?.userId;
  const canReply = isAdmin || isPic || (isUnassigned && user?.role === 'cs');
  // Aturan ambil alih: CS lain boleh mengambil prospek bila jamaah belum dibalas lebih dari 15 menit.
  const now = useNow();
  const canTakeOver = Boolean(
    selected && user?.role === 'cs' && !isPic && !isUnassigned && !selected.isGroup
    && !isWonStatus(selected.status) && !isLostStatus(selected.status)
    && isTakeoverOpen(selected.awaitingSince, now),
  );
  // Hak membalas (role/PIC) dan kemampuan mengirim (perangkat terhubung) dibedakan.
  const canSend = canReply && isConnected;

  const currentPackage = useMemo(() => {
    return packages.data?.find((p) => p.id === (selected?.packageId || selected?.package?.id));
  }, [packages.data, selected?.packageId, selected?.package?.id]);

  const filteredPackages = useMemo(() => {
    const list = (packages.data ?? []).filter((p) => p.isActive);
    const q = packageSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      `${p.name ?? ''} ${p.airline ?? ''} ${p.departureInfo ?? ''} ${p.hotelMakkah ?? ''} ${p.hotelMadinah ?? ''} ${p.price ?? ''} ${p.priceQuad ?? ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [packages.data, packageSearch]);

  const quickReplyChips = [
    { id: 'greeting', label: 'Sapaan Hangat', icon: Sparkles },
    { id: 'package', label: 'Tawarkan Paket', icon: FileText },
    { id: 'flyer', label: 'Kirim Flyer Brosur', icon: ImageIcon },
    { id: 'bank', label: 'Rekening Resmi', icon: CreditCard },
    { id: 'closing', label: 'Dorong Closing', icon: HandCoins },
    { id: 'ppiu', label: 'Legalitas PPIU', icon: ShieldCheck },
  ] as const;

  function handleInsertTemplate(type: string) {
    if (type === 'flyer') {
      openSendFlyerModal();
      return;
    }
    const customerName = selected?.name && !/^\d+$/.test(selected.name) ? selected.name : 'Bapak/Ibu';
    const travelName = activeBrand?.name || 'Layanan Resmi Umroh';
    const csName = user?.name || 'Customer Service';

    let text = '';
    if (type === 'greeting') {
      text = `Assalamu'alaikum Warahmatullahi Wabarakatuh, ${customerName} 🙏\n\nSaya ${csName} dari tim layanan resmi ${travelName}.\n\nSenang sekali bisa membantu rencana ibadah umroh ${customerName} sekeluarga.\n\nApakah ada perkiraan bulan atau musim keberangkatan yang sedang direncanakan?`;
    } else if (type === 'package') {
      if (currentPackage) {
        text = formatWaPackageSummary(currentPackage, travelName);
      } else {
        text = `Bismillah ${customerName}, ${travelName} memiliki beberapa pilihan paket umroh.\n\nBoleh kami tahu rencana bulan keberangkatan, jumlah jamaah, dan preferensi kamar (quad/triple/double)? Kami kirimkan rincian paket yang paling sesuai. 🙏`;
      }
    } else if (type === 'bank') {
      // Data rekening hanya dari data resmi brand; tanpa data lengkap tidak ada teks yang dibuat.
      const bank = activeBrand?.bankName?.trim();
      const accNumber = activeBrand?.bankAccountNumber?.trim();
      const accHolder = activeBrand?.bankAccountHolder?.trim();
      if (!bank || !accNumber || accNumber === '-' || !accHolder) {
        showToast('Rekening resmi brand belum lengkap. Minta Admin melengkapi data bank di menu Brand.');
        return;
      }
      text = `Bismillah, untuk keamanan transaksi di ${travelName}, pembayaran resmi hanya melalui rekening perusahaan berikut:\n\n🏛️ Bank: ${bank}\n💳 No. Rekening: ${accNumber}\n👤 Atas Nama: ${accHolder}\n\nSetelah transfer, mohon kirimkan foto bukti transfernya agar dapat diverifikasi tim Finance kami. Terima kasih! 🙏`;
    } else if (type === 'closing') {
      // Klaim kuota hanya dari data kuota paket yang nyata.
      const quota = currentPackage?.quotaRemaining;
      const quotaLine = currentPackage && typeof quota === 'number'
        ? `Untuk paket ${currentPackage.name}, saat ini tersisa ${quota} seat.\n\n`
        : '';
      text = `Bismillah ${customerName}, ${quotaLine}Jika ${customerName} sudah mantap, seat dapat kami amankan dengan pembayaran DP sesuai invoice resmi.\n\nApakah ada hal lain yang masih perlu kami jelaskan sebelum pendaftaran? 🙏`;
    } else if (type === 'ppiu') {
      const ppiu = activeBrand?.ppiuNumber?.trim();
      if (!ppiu) {
        showToast('Nomor izin PPIU brand belum diisi. Minta Admin melengkapinya di menu Brand.');
        return;
      }
      text = `Alhamdulillah ${travelName} adalah Penyelenggara Perjalanan Ibadah Umrah (PPIU) dengan nomor izin: ${ppiu}.\n\nNomor izin tersebut dapat dicek di sistem resmi Kementerian Agama RI.`;
    }

    if (text) {
      handleInsertDirectText(text);
    }
  }

  function handleInsertDirectText(text: string) {
    setMessage(previous => appendDraft(previous, text));
    showToast('Teks ditambahkan ke draft; belum dikirim.');
    requestAnimationFrame(() => {
      if (composerRef.current) {
        adjustTextareaHeight(composerRef.current);
        composerRef.current.focus();
      }
    });
  }

  const messages = useQuery({
    queryKey: ['messages', selectedId, brandId],
    queryFn: () => api.get<any[]>(`/chat/prospects/${selectedId}/messages${query}`),
    enabled: !!selectedId && !!brandId,
  });

  useQuery({
    queryKey: ['history-sync', selectedId, brandId],
    queryFn: () => api.post(`/chat/prospects/${selectedId}/history-sync`, { ...(query ? { brandId } : {}) }),
    enabled: !!selectedId && !!brandId && isConnected,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const lastSelectedIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!timelineRef.current) return;
    const container = timelineRef.current;
    const isNewConversation = lastSelectedIdRef.current !== selectedId;
    lastSelectedIdRef.current = selectedId;

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 180;
    if (isNewConversation || isNearBottom) {
      // rAF ensures DOM is fully painted before we measure/scroll
      requestAnimationFrame(() => {
        if (timelineRef.current) {
          timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
        }
      });
    }
  }, [messages.data, selectedId]);

  // Instantly jump to bottom whenever the user switches conversation
  // (before new messages arrive, so there's no flash at the top)
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [selectedId]);

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

  const send = useMutation({
    mutationFn: (text: string) =>
      api.post(`/chat/messages${query}`, {
        brandId,
        prospectId: selectedId,
        text,
        quotedMessageId: replyingTo?.messageId,
        quotedText: replyingTo?.text,
        quotedSender: replyingTo?.senderName,
      }),
    onSuccess: () => {
      setMessage('');
      setReplyingTo(null);
      if (composerRef.current) composerRef.current.style.height = '44px';
      void queryClient.invalidateQueries({ queryKey: ['messages', selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const starMutation = useMutation({
    mutationFn: (messageId: number) => api.post<{ isStarred?: boolean }>(`/chat/messages/${messageId}/star${query}`),
    onSuccess: (data: any) => {
      void queryClient.invalidateQueries({ queryKey: ['messages', selectedId, brandId] });
      showToast(data?.isStarred ? 'Pesan diberi bintang ⭐' : 'Bintang pesan dihapus');
    },
    onError: () => {
      showToast('Gagal mengubah status bintang pesan');
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

  const claimMutation = useMutation({
    mutationFn: (prospectId: number) => api.post(`/prospects/${prospectId}/claim`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
      showToast('Anda berhasil menjadi PIC percakapan ini');
    },
    onError: (err: any) => {
      showToast(err?.message || 'Gagal mengklaim PIC');
    },
  });

  const takeoverMutation = useMutation({
    mutationFn: (prospect: { id: number; brandId?: number }) => api.post(`/prospects/${prospect.id}/takeover`, { brandId: prospect.brandId ?? brandId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      showToast('Anda sekarang PIC percakapan ini. Segera balas jamaah.');
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

  function handleSelectConversation(id: number) {
    setSelectedId(id);
    setMobileView('chat');
    void api.post(`/chat/prospects/${id}/read${query}`).catch(() => null);
    queryClient.setQueryData<any[]>(['conversations', brandId], (old) => {
      if (!old) return old;
      return old.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c));
    });
  }

  function adjustTextareaHeight(element: HTMLTextAreaElement | null) {
    if (!element) return;
    element.style.height = 'auto';
    const nextHeight = Math.min(element.scrollHeight, 140);
    element.style.height = `${Math.max(nextHeight, 44)}px`;
  }

  function handleComposerChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setMessage(e.target.value);
    adjustTextareaHeight(e.target);
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
    if (mediaPreview) {
      void handleSendMedia();
    } else if (message.trim() && !send.isPending) {
      send.mutate(message.trim());
    }
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

    if (!pkg.flyerImage) {
      pendingFlyerPackageRef.current = pkg;
      setMessage(previous => appendFlyerCaption(previous, captionText));
      requestAnimationFrame(() => {
        if (composerRef.current) {
          adjustTextareaHeight(composerRef.current);
          composerRef.current.focus();
        }
      });
      flyerInputRef.current?.click();
      showToast(`Pilih berkas flyer dari komputer untuk ${pkg.name}`);
      return;
    }

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

      if (mediaPreview?.url) {
        URL.revokeObjectURL(mediaPreview.url);
      }

      setMediaPreview({
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

      setMessage(previous => appendFlyerCaption(previous, captionText));
      requestAnimationFrame(() => {
        if (composerRef.current) {
          adjustTextareaHeight(composerRef.current);
          composerRef.current.focus();
        }
      });
      showToast(`Flyer ${pkg.name} siap dikirim dengan format resmi`);
    } catch (err: any) {
      console.warn('Fallback loading flyer:', err);
      pendingFlyerPackageRef.current = pkg;
      setMessage(previous => appendFlyerCaption(previous, captionText));
      requestAnimationFrame(() => {
        if (composerRef.current) {
          adjustTextareaHeight(composerRef.current);
          composerRef.current.focus();
        }
      });
      flyerInputRef.current?.click();
      showToast('Pilih gambar flyer manual');
    } finally {
      setIsCompressing(false);
    }
  }

  async function handleProcessFlyerFile(file: File) {
    if (!file || !selectedId) return;
    const pkg = pendingFlyerPackageRef.current || currentPackage;
    const travelName = activeBrand?.name || 'Layanan Resmi Umroh';
    const captionText = pkg ? formatWaFlyerCaption(pkg, travelName) : message;

    setIsCompressing(true);
    try {
      const result = await autoCompressMedia(file);
      const objectUrl = URL.createObjectURL(result.file);

      if (mediaPreview?.url) {
        URL.revokeObjectURL(mediaPreview.url);
      }

      setMediaPreview({
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

      if (captionText) {
        setMessage(previous => appendFlyerCaption(previous, captionText));
        requestAnimationFrame(() => {
          if (composerRef.current) adjustTextareaHeight(composerRef.current);
        });
      }
      showToast('Flyer berhasil disiapkan');
    } finally {
      setIsCompressing(false);
      pendingFlyerPackageRef.current = null;
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

    // Auto-compress image to reduce server load
    if (file.type.startsWith('image/') && file.type !== 'image/gif' && file.type !== 'image/svg+xml') {
      setIsCompressing(true);
      try {
        const result = await autoCompressMedia(file);
        const objectUrl = URL.createObjectURL(result.file);
        setMediaPreview({
          file: result.file,
          url: objectUrl,
          type: result.file.type,
          name: result.file.name,
          originalSize: result.originalSize,
          compressedSize: result.compressedSize,
          savingsPercent: result.savingsPercent,
          isCompressed: result.isCompressed,
        });
        if (result.isCompressed && result.savingsPercent > 5) {
          showToast(`Kompresi otomatis: hemat ${result.savingsPercent}%`);
        }
      } finally {
        setIsCompressing(false);
      }
    } else {
      const objectUrl = URL.createObjectURL(file);
      setMediaPreview({
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
    const targetFile = fileToSend || mediaPreview?.file;
    if (!selectedId || uploadingMedia || !targetFile) return;
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

      if (mediaPreview?.url) {
        URL.revokeObjectURL(mediaPreview.url);
      }
      setMediaPreview(null);
      setMessage('');
      setReplyingTo(null);
      if (composerRef.current) composerRef.current.style.height = '44px';
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
    <div className="relative h-screen w-full overflow-hidden bg-white">

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
                className="lg:hidden p-1.5 rounded-lg text-[#54656f] hover:bg-black/5 hover:text-[#111b21] transition shrink-0 cursor-pointer"
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
                      <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#00a884] font-bold text-xs text-white shadow-2xs">
                        {activeBrand?.name ? String(activeBrand.name).slice(0, 2).toUpperCase() : 'WA'}
                        {isConnected && (
                          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-[#25d366]" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h2 className="font-semibold text-sm text-[#111b21] truncate leading-tight group-hover:text-emerald-700">
                            {activeBrand?.name ?? 'WhatsApp Live Chat'}
                          </h2>
                          <ChevronDown size={14} className="text-zinc-400 group-hover:text-zinc-700 shrink-0" />
                        </div>
                        <p className="text-[11px] text-[#667781] truncate">
                          {isConnected ? (sessionQuery.data?.phoneNumber ? `+${sessionQuery.data.phoneNumber}` : 'Terhubung') : 'Terputus'} • <span className="text-emerald-600 font-semibold">Ganti Brand</span>
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
                      <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 mb-1">
                        Pilih Sesi WhatsApp Brand
                      </div>
                      {brandsQuery.data.map((b: any) => {
                        const isActive = b.id === brandId;
                        return (
                          <DropdownMenu.Item
                            key={b.id}
                            onSelect={() => {
                              setActiveBrandId(b.id);
                              setSelectedId(null);
                            }}
                            className={cn(
                              "flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer outline-none transition",
                              isActive ? "bg-emerald-50 text-emerald-800 font-bold" : "text-zinc-700 hover:bg-zinc-100"
                            )}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-700">
                                {b.name ? String(b.name).slice(0, 2).toUpperCase() : 'B'}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-xs">{b.name}</p>
                                {b.phone && <p className="text-[10px] text-zinc-400 truncate">+{b.phone}</p>}
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
                  <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#00a884] font-bold text-xs text-white shadow-2xs">
                    {activeBrand?.name ? String(activeBrand.name).slice(0, 2).toUpperCase() : 'WA'}
                    {isConnected && (
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-[#25d366]" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-sm text-[#111b21] truncate leading-tight">
                      {activeBrand?.name ?? 'WhatsApp Live Chat'}
                    </h2>
                    <p className="text-[11px] text-[#667781] truncate">
                      {isConnected ? (sessionQuery.data?.phoneNumber ? `+${sessionQuery.data.phoneNumber}` : 'Terhubung') : 'Terputus'}
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
              {/* WhatsApp Web Search Bar */}
              <div className="relative flex items-center">
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

              <Select
                value={ownerFilter}
                onValueChange={setOwnerFilter}
                options={ownerOptions}
                aria-label="Filter penanggung jawab percakapan"
                size="sm"
                className="w-full"
              />
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium" role="group" aria-label="Filter pekerjaan CS">
                {inboxWorkFilters.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setChatFilter(filter.id)}
                    aria-pressed={chatFilter === filter.id}
                    title={filter.description}
                    className={cn(
                      'rounded-full px-2.5 py-1.5 transition-colors whitespace-nowrap',
                      chatFilter === filter.id
                        ? 'bg-[#d9fdd3] text-[#008069] font-bold'
                        : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'
                    )}
                  >
                    {filter.label} ({filterCounts[filter.id]})
                  </button>
                ))}
              </div>
              {chatFilter !== 'all' && <p className="px-1 text-[11px] leading-relaxed text-[#667781]">{activeFilter.description}</p>}

            </div>
          )}

          {!isConnected && (
            <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] text-amber-900" role="status">
              <WifiOff size={14} className="mt-0.5 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p className="font-semibold">WhatsApp terputus — mode baca</p>
                <p className="text-amber-800">Riwayat tetap bisa dibaca; pesan baru belum masuk dan belum bisa dikirim.</p>
                {canManageDevice && (
                  <Link to={`/devices/${brandId}`} className="mt-1 inline-flex items-center gap-1 font-semibold underline">
                    <Smartphone size={12} /> Hubungkan WA
                  </Link>
                )}
              </div>
            </div>
          )}
          {(
            <div className="thin-scrollbar flex-1 overflow-y-auto divide-y divide-[#f0f2f5]">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#8696a0]">
                <p className="font-semibold text-[#54656f]">
                  {search.trim() ? 'Percakapan tidak ditemukan' : chatFilter === 'needs_reply' ? 'Tidak ada pesan yang perlu dibalas' : chatFilter === 'followup' ? 'Tidak ada follow-up jatuh tempo' : 'Tidak ada percakapan pada pilihan PIC ini'}
                </p>
                <p className="mt-1">Hasil mengikuti pencarian dan PIC yang dipilih.</p>
                <button type="button" onClick={() => { setSearch(''); setOwnerFilter('all'); setChatFilter('all'); }} className="mt-3 font-semibold text-[#008069] hover:underline">Tampilkan semua percakapan</button>
              </div>
            ) : (
              filtered.map((item) => {
                const last = item.messages?.[0];
                const active = item.id === selectedId;
                const hasUnread = (item.unreadCount ?? 0) > 0;
                const isGroup = Boolean(item.isGroup);

                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectConversation(item.id)}
                    onKeyDown={(event) => activateWithKeyboard(event, () => handleSelectConversation(item.id))}
                    aria-current={active ? 'true' : undefined}
                    aria-label={`Percakapan dengan ${item.name}`}
                    className={cn(
                      'flex h-[72px] items-center gap-3 px-3.5 cursor-pointer transition-colors select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00a884]',
                      active ? 'bg-[#f0f2f5]' : 'hover:bg-[#f5f6f6]'
                    )}
                  >
                    {/* Avatar */}
                    <ContactAvatar
                      size="lg"
                      photoUrl={photoFor(item)}
                      isGroup={isGroup}
                      isWhatsAppOfficial={item.remoteJid === '0@s.whatsapp.net' || item.name === 'WhatsApp'}
                    />

                    {/* Content Column */}
                    <div className="min-w-0 flex-1 pr-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-[15px] font-semibold text-[#111b21]">
                          {item.name}
                        </span>
                        <time className={cn(
                          'shrink-0 text-[12px]',
                          hasUnread ? 'font-semibold text-[#00a884]' : 'text-[#667781]'
                        )}>
                          {formatWaTimestamp(last?.timestamp)}
                        </time>
                      </div>

                      <div className="mt-0.5 flex items-center justify-between gap-1">
                        <span className="truncate text-[13px] text-[#667781] flex items-center gap-1">
                          {last?.isFromMe && (
                            last.status === 'pending' ? (
                              <span title="Menunggu" className="shrink-0 flex items-center text-[#8696a0]">
                                <Clock size={12} />
                              </span>
                            ) : last.status === 'sent' ? (
                              <span title="Terkirim" className="shrink-0 flex items-center">
                                <Check size={14} className="text-[#8696a0]" />
                              </span>
                            ) : (
                              <span title={last.status === 'read' ? 'Sudah dibaca' : 'Tersampaikan'} className="shrink-0 flex items-center">
                                <CheckCheck
                                  size={15}
                                  className={last.status === 'read' ? 'text-[#53bdeb]' : 'text-[#8696a0]'}
                                />
                              </span>
                            )
                          )}
                          {last?.messageType === 'imageMessage' ? (
                            <span className="inline-flex items-center gap-1"><ImageIcon size={13} /> Foto</span>
                          ) : last?.messageType === 'documentMessage' ? (
                            <span className="inline-flex items-center gap-1"><FileText size={13} /> Dokumen</span>
                          ) : last?.messageType === 'audioMessage' ? (
                            <span className="inline-flex items-center gap-1"><Mic size={13} /> Pesan suara</span>
                          ) : (
                            <span className="truncate">{last?.messageText || 'Belum ada pesan'}</span>
                          )}
                        </span>

                        {hasUnread && (
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#25d366] px-1.5 text-[11px] font-bold text-white shadow-2xs animate-fade-in">
                            {item.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            </div>
          )}
        </aside>

        {/* Center Column: WhatsApp Web Chat Space */}
        <section className={cn(
          'inbox-chat flex flex-col bg-white min-w-0',
          mobileView === 'list' && 'hidden md:flex'
        )}>
          {!isConnected && !selected ? (
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
              <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e9edef] bg-[#f0f2f5] px-4">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Mobile Back Button — di luar area profil agar kliknya tidak ikut membuka/menutup panel. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden mr-0.5 shrink-0 text-[#54656f]"
                    onClick={() => setMobileView('list')}
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
                    className="flex min-w-0 items-center gap-3 rounded-lg text-left outline-none cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
                  >
                  <ContactAvatar
                    size="md"
                    photoUrl={photoFor(selected)}
                    isGroup={selected.isGroup}
                    isWhatsAppOfficial={selected.remoteJid === '0@s.whatsapp.net' || selected.name === 'WhatsApp'}
                  />

                  <span className="block min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="block truncate text-sm font-semibold text-[#111b21]">{selected.name}</span>
                      {selected.leadSource === 'meta_ads' && (
                        <span
                          title={[selected.adHeadline, selected.adId && `Ad ${selected.adId}`].filter(Boolean).join(' · ')}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-950 px-2 py-0.5 text-[9px] font-bold text-white"
                        >
                          <Megaphone size={10} />Meta Ads
                        </span>
                      )}
                    </span>

                    <span className="block truncate text-[11px] text-[#667781]">
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
                  </span>
                  </button>
                </div>

                {/* Right Action Tools */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Status Pipeline Badge */}
                  {!selected.isGroup && (
                    <button
                      type="button"
                      onClick={() => setSidePanelTab('profile')}
                      className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
                      title="Status Pipeline (Klik untuk membuka profil)"
                      aria-label={`Status ${selected.status || 'new'}: buka profil prospek`}
                    >
                      <Badge value={selected.status || 'new'} className="shrink-0 cursor-pointer hover:opacity-85 transition-opacity" />
                    </button>
                  )}

                  {/* PIC Status Badge */}
                  {selected.user?.name ? (
                    <button
                      type="button"
                      onClick={() => setSidePanelTab('profile')}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold cursor-pointer hover:opacity-85 transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]',
                        isPic
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-zinc-100 text-zinc-600 border border-zinc-200'
                      )}
                      title={`Penanggung jawab chat: ${selected.user.name} (Klik untuk membuka profil)`}
                    >
                      {isPic ? 'PIC Anda' : `PIC: ${selected.user.name}`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSidePanelTab('profile')}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 text-[10px] font-bold cursor-pointer hover:opacity-85 transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
                      title="Percakapan belum memiliki PIC (Klik untuk membuka profil)"
                    >
                      Belum ada PIC
                    </button>
                  )}

                  {user?.role === 'cs' && isUnassigned && !isWonStatus(selected.status) && !isLostStatus(selected.status) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-1.5 text-xs bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 font-semibold ml-0.5"
                      onClick={() => claimMutation.mutate(selected.id)}
                      disabled={claimMutation.isPending}
                      title="Klaim percakapan ini sebagai PIC Anda"
                    >
                      <UserPlus2 size={14} />
                      <span className="hidden sm:inline">Klaim PIC</span>
                    </Button>
                  )}

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
                      <span className="hidden sm:inline">Ambil alih</span>
                    </Button>
                  )}

                  {!sidePanelTab && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSidePanelTab('profile')}
                      className="gap-1.5 text-xs text-[#54656f] hover:text-[#111b21] hover:bg-black/5"
                      title="Buka Profil Prospek & Copilot"
                    >
                      <User size={15} className="text-[#00a884]" />
                      <span className="hidden sm:inline">Info Prospek</span>
                    </Button>
                  )}
                </div>
              </header>

              {/* Chat Message Timeline with WhatsApp Web Wallpaper */}
              <div ref={timelineRef} className="thin-scrollbar flex-1 overflow-y-auto wa-chat-bg px-3 py-4 sm:px-6">
                <div className="mx-auto max-w-3xl space-y-1.5">
                  {/* Encrypted Notice Banner */}
                  <div className="mb-4 text-center">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#ffeecd] px-3 py-1 text-[11px] text-[#54656f] shadow-2xs">
                      <ShieldCheck size={12} className="text-[#008069]" />
                      Pesan terenkripsi secara end-to-end oleh WhatsApp
                    </span>
                  </div>

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
                  {(messages.data ?? [])
                    .filter((item) => item.messageType !== 'protocolMessage' && item.messageType !== 'reactionMessage')
                    .map((item, index, arr) => {
                    const prev = arr[index - 1];
                    const isNewDate = !prev || formatDateSeparator(item.timestamp) !== formatDateSeparator(prev.timestamp);
                    const isMessageDeleted = Boolean(item.isDeleted);
                    const isRevealedByAdmin = isAdmin && (showDeletedMessages || revealedDeletedIds.has(item.id));

                    return (
                      <div key={item.id} id={`msg-${item.messageId}`} className="transition-colors duration-500 rounded-lg">
                        {isNewDate && (
                          <div className="my-3 flex items-center justify-center">
                            <span className="rounded-lg bg-white/95 px-3 py-1 text-[11px] font-medium text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] uppercase">
                              {formatDateSeparator(item.timestamp)}
                            </span>
                          </div>
                        )}

                        {(() => {
                          const isPickerOpen = activeReactionMessageId === item.id;

                          const reactionTrigger = (
                            <div className="relative shrink-0 flex items-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveReactionMessageId((prev) => (prev === item.id ? null : item.id));
                                }}
                                className={cn(
                                  'h-6 w-6 sm:h-7 sm:w-7 rounded-full bg-white text-[#54656f] hover:text-[#111b21] shadow-[0_1px_2px_rgba(0,0,0,0.15)] border border-black/10 flex items-center justify-center transition-all hover:scale-110 active:scale-95 cursor-pointer',
                                  isPickerOpen
                                    ? 'opacity-100 ring-2 ring-[#00a884]/30'
                                    : 'opacity-0 group-hover:opacity-100 transition-opacity duration-150'
                                )}
                                title="Beri reaksi"
                                aria-label="Beri reaksi"
                              >
                                <Smile size={15} />
                              </button>

                              {/* Quick Reaction Floating Popover */}
                              {isPickerOpen && (
                                <>
                                  <div
                                    className="fixed inset-0 z-30 cursor-default"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveReactionMessageId(null);
                                    }}
                                  />
                                  <div
                                    className={cn(
                                      'absolute bottom-full mb-2 z-40 flex items-center gap-1 rounded-full bg-white px-2 py-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.18)] border border-black/10 animate-in fade-in zoom-in-95 duration-150 select-none',
                                      item.isFromMe ? 'right-0 sm:right-auto sm:left-0' : 'left-0'
                                    )}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {QUICK_REACTIONS.map((emoji) => {
                                      const isSelected = item.reaction === emoji;
                                      // Jika emoji ini sudah dipilih oleh orang lain (bukan saya), disable toggle
                                      const isAdmin = user?.role === 'superadmin' || user?.role === 'admin';
                                      const isProspectReaction = isSelected && item.reactionUserId === null && !item.isFromMe;
                                      const isOtherCSReaction = isSelected && item.reactionUserId !== null && item.reactionUserId !== user?.id && !isAdmin;
                                      const canToggleThisEmoji = !isProspectReaction && !isOtherCSReaction;
                                      return (
                                        <button
                                          key={emoji}
                                          type="button"
                                          disabled={!canToggleThisEmoji}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (canToggleThisEmoji) reactMutation.mutate({ messageId: item.id, emoji });
                                          }}
                                          className={cn(
                                            'h-8 w-8 rounded-full flex items-center justify-center text-lg hover:scale-125 active:scale-90 transition-all hover:bg-black/5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100',
                                            isSelected && 'bg-emerald-100 ring-1 ring-emerald-500 scale-110'
                                          )}
                                          title={
                                            isProspectReaction ? 'Reaksi jamaah (tidak bisa dihapus)' :
                                            isOtherCSReaction ? 'Reaksi CS lain (tidak bisa dihapus)' :
                                            isSelected ? `Hapus reaksi ${emoji}` : `Beri reaksi ${emoji}`
                                          }
                                        >
                                          <span className="leading-none">{emoji}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                            </div>
                          );

                          return (
                            <div className={cn(
                              'group relative flex items-center gap-1.5 my-1',
                              item.isFromMe ? 'justify-end' : 'justify-start',
                              item.reaction ? 'mb-3' : 'mb-1'
                            )}>
                              {item.isFromMe && !isMessageDeleted && canSend && reactionTrigger}

                              <div className={cn(
                                'relative max-w-[82%] sm:max-w-[65%] rounded-lg px-3 py-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] transition-all',
                                item.isFromMe
                                  ? 'rounded-tr-none bg-[#d9fdd3] text-[#111b21]'
                                  : 'rounded-tl-none bg-white text-[#111b21]',
                                isMessageDeleted && !isRevealedByAdmin && 'opacity-85 bg-[#f0f2f5] text-[#667781] border border-black/5'
                              )}>
                                {/* WhatsApp Web Context Menu Trigger (ChevronDown) on Bubble Hover */}
                                <div className="absolute top-1 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                  <DropdownMenu.Root>
                                    <DropdownMenu.Trigger asChild>
                                      <button
                                        type="button"
                                        className="h-5 w-5 rounded-full bg-white/90 hover:bg-white text-[#54656f] hover:text-[#111b21] shadow-xs flex items-center justify-center transition cursor-pointer border border-black/5"
                                        title="Menu pesan"
                                        aria-label="Menu pesan"
                                      >
                                        <ChevronDown size={13} />
                                      </button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Portal>
                                      <DropdownMenu.Content
                                        align={item.isFromMe ? 'end' : 'start'}
                                        sideOffset={4}
                                        className="z-50 min-w-[160px] rounded-xl bg-white p-1 shadow-[0_4px_16px_rgba(0,0,0,0.15)] border border-black/10 text-xs animate-in fade-in zoom-in-95"
                                      >
                                        <DropdownMenu.Item
                                          disabled={!canReply}
                                          onClick={() => {
                                            if (!canReply) return;
                                            setReplyingTo({
                                              id: item.id,
                                              messageId: item.messageId,
                                              senderName: item.isFromMe ? 'Anda' : (item.senderName || selected.name),
                                              text: item.messageText || (item.messageType === 'imageMessage' ? 'Foto' : 'Pesan'),
                                            });
                                            composerRef.current?.focus();
                                          }}
                                          className={cn(
                                            'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[#111b21] outline-none',
                                            canReply ? 'hover:bg-[#f0f2f5] cursor-pointer' : 'opacity-40 cursor-not-allowed'
                                          )}
                                          title={canReply ? 'Balas pesan' : `Hanya Admin dan PIC (${selected.user?.name || 'CS lain'}) yang dapat membalas`}
                                        >
                                          <CornerUpLeft size={14} className="text-[#54656f]" />
                                          <span>Balas {!canReply && '(Hanya Admin/PIC)'}</span>
                                        </DropdownMenu.Item>

                                        {item.messageText && !isMessageDeleted && (
                                          <DropdownMenu.Item
                                            onClick={() => {
                                              void navigator.clipboard.writeText(item.messageText);
                                              showToast('Teks pesan disalin');
                                            }}
                                            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[#111b21] hover:bg-[#f0f2f5] outline-none cursor-pointer"
                                          >
                                            <Copy size={14} className="text-[#54656f]" />
                                            <span>Salin</span>
                                          </DropdownMenu.Item>
                                        )}

                                        {!isMessageDeleted && canSend && (
                                          <DropdownMenu.Item
                                            onClick={() => {
                                              setActiveReactionMessageId(item.id);
                                            }}
                                            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[#111b21] hover:bg-[#f0f2f5] outline-none cursor-pointer"
                                          >
                                            <Smile size={14} className="text-[#54656f]" />
                                            <span>Reaksi</span>
                                          </DropdownMenu.Item>
                                        )}

                                        <DropdownMenu.Item
                                          onClick={() => {
                                            starMutation.mutate(item.id);
                                          }}
                                          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[#111b21] hover:bg-[#f0f2f5] outline-none cursor-pointer"
                                        >
                                          <Star size={14} className={cn(item.isStarred ? 'fill-amber-400 text-amber-500' : 'text-[#54656f]')} />
                                          <span>{item.isStarred ? 'Hapus bintang' : 'Beri bintang'}</span>
                                        </DropdownMenu.Item>

                                        {/* Bukti transfer langsung dari chat: server menyalin berkas, tanpa unduh-unggah ulang */}
                                        {!isMessageDeleted && !item.isFromMe && item.mediaUrl && (item.messageType === 'imageMessage' || item.messageType === 'documentMessage') && (
                                          selected?.paymentProofMessageId === item.messageId ? (
                                            <DropdownMenu.Item
                                              disabled
                                              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-emerald-700 outline-none"
                                            >
                                              <ShieldCheck size={14} />
                                              <span>Sudah diajukan ke Finance</span>
                                            </DropdownMenu.Item>
                                          ) : (
                                            <DropdownMenu.Item
                                              onClick={() => proofFromMessage.mutate(item.id)}
                                              disabled={proofFromMessage.isPending}
                                              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[#111b21] hover:bg-[#f0f2f5] outline-none cursor-pointer"
                                            >
                                              <ShieldCheck size={14} className="text-emerald-600" />
                                              <span>Kirim ke Finance sebagai bukti transfer</span>
                                            </DropdownMenu.Item>
                                          )
                                        )}

                                        {!isMessageDeleted && item.isFromMe && canSend && (
                                          <>
                                            <DropdownMenu.Separator className="my-1 h-px bg-[#e9edef]" />
                                            <DropdownMenu.Item
                                              onClick={() => setDeleteConfirmId(item.id)}
                                              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 outline-none cursor-pointer font-medium"
                                            >
                                              <Trash2 size={14} />
                                              <span>Hapus pesan</span>
                                            </DropdownMenu.Item>
                                          </>
                                        )}
                                      </DropdownMenu.Content>
                                    </DropdownMenu.Portal>
                                  </DropdownMenu.Root>
                                </div>

                                {isMessageDeleted && !isRevealedByAdmin ? (
                                  /* Deleted Message view for regular user / unrevealed */
                                  <div className="flex items-center gap-1.5 py-0.5 pr-6 text-[13px] italic text-[#667781] select-none">
                                    <Ban size={14} className="shrink-0 text-[#8696a0]" />
                                    <span>{item.isFromMe ? 'Anda telah menghapus pesan ini' : 'Pesan ini telah dihapus'}</span>
                                    {isAdmin && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setRevealedDeletedIds((prev) => {
                                            const next = new Set(prev);
                                            next.add(item.id);
                                            return next;
                                          });
                                        }}
                                        className="ml-2 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 hover:bg-amber-500/25 not-italic cursor-pointer"
                                        title="Lihat pesan yang dihapus (Mode Admin)"
                                      >
                                        <Eye size={11} /> Lihat
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  /* Normal Message or Admin-Revealed Deleted Message */
                                  <>
                                    {/* Admin Revealed Banner */}
                                    {isMessageDeleted && isRevealedByAdmin && (
                                      <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-amber-500/30 pb-1 text-[10.5px] font-bold text-amber-800">
                                        <span className="flex items-center gap-1">
                                          <Eye size={12} className="text-amber-600" />
                                          Pesan Dihapus {item.deletedAt ? `(${new Date(item.deletedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })})` : ''}
                                        </span>
                                        {!showDeletedMessages && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setRevealedDeletedIds((prev) => {
                                                const next = new Set(prev);
                                                next.delete(item.id);
                                                return next;
                                              });
                                            }}
                                            className="text-amber-700 hover:underline cursor-pointer"
                                          >
                                            Tutup
                                          </button>
                                        )}
                                      </div>
                                    )}

                                    {/* Sender Name (CS name on outgoing, contact name on incoming) - always shown */}
                                    {item.isFromMe && item.senderName && (
                                      <p className="text-[10.5px] font-bold text-[#008069] mb-0.5 leading-tight">
                                        {item.senderName}
                                      </p>
                                    )}
                                    {!item.isFromMe && (
                                      <p className="text-[10.5px] font-bold text-[#53bdeb] mb-0.5 leading-tight">
                                        {item.senderName || selected.name || 'Jamaah'}
                                      </p>
                                    )}

                                    {/* Quoted Message Preview inside bubble */}
                                    {(item.quotedText || item.quotedMessageId) && (
                                      <div
                                        role="button"
                                        tabIndex={0}
                                        aria-label="Lompat ke pesan yang dikutip"
                                        onClick={() => scrollToMessage(item.quotedMessageId)}
                                        onKeyDown={(event) => activateWithKeyboard(event, () => scrollToMessage(item.quotedMessageId))}
                                        className={cn(
                                          'mb-1.5 rounded border-l-4 px-2.5 py-1.5 text-xs cursor-pointer select-none transition-opacity hover:opacity-85',
                                          item.isFromMe
                                            ? 'border-[#00a884] bg-black/[0.04]'
                                            : 'border-[#53bdeb] bg-[#f0f2f5]'
                                        )}
                                        title="Klik untuk menuju ke pesan yang dikutip"
                                      >
                                        <div className="font-bold text-[11px] text-[#008069]">
                                          {item.quotedSender || (item.isFromMe ? 'Anda' : selected.name)}
                                        </div>
                                        <div className="truncate text-[12px] text-[#54656f]">
                                          {item.quotedText || 'Pesan'}
                                        </div>
                                      </div>
                                    )}

                                     {/* Image Media Preview */}
                                     {item.messageType === 'imageMessage' && (
                                       <div className="mb-1.5 overflow-hidden rounded-xl max-w-[280px]">
                                         {item.mediaUrl ? (
                                           <div
                                             role="button"
                                             tabIndex={0}
                                             aria-label="Lihat gambar"
                                             className="relative group cursor-pointer overflow-hidden rounded-xl border border-black/10 bg-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
                                             onClick={() => setPreviewFlyer(item.mediaUrl)}
                                             onKeyDown={(event) => activateWithKeyboard(event, () => setPreviewFlyer(item.mediaUrl))}
                                           >
                                             <img
                                               src={resolveMediaUrl(item.mediaUrl)}
                                               alt={item.messageText && item.messageText !== '[Gambar]' ? item.messageText : 'Foto'}
                                               className="w-full max-h-[300px] object-cover rounded-xl transition duration-200 group-hover:scale-[1.01]"
                                               loading="lazy"
                                             />
                                             <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100">
                                               <span className="bg-black/70 text-white text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-md">
                                                 <Eye size={13} /> Perbesar
                                               </span>
                                             </div>
                                           </div>
                                         ) : (
                                           <div className="flex items-center gap-2 rounded-lg bg-black/5 p-2 text-xs text-zinc-600">
                                             <ImageIcon size={16} className="shrink-0 text-[#00a884]" />
                                             <span className="font-semibold">Foto / Gambar</span>
                                           </div>
                                         )}
                                       </div>
                                     )}

                                     {/* Video Media Preview */}
                                     {item.messageType === 'videoMessage' && (
                                       <div className="mb-1.5 overflow-hidden rounded-xl max-w-[280px]">
                                         {item.mediaUrl ? (
                                           <div className="rounded-xl overflow-hidden bg-black border border-black/10">
                                             <video
                                               src={resolveMediaUrl(item.mediaUrl)}
                                               controls
                                               playsInline
                                               className="w-full rounded-xl max-h-[220px]"
                                               preload="metadata"
                                             />
                                           </div>
                                         ) : (
                                           <div className="flex items-center gap-2 rounded-lg bg-black/5 p-2 text-xs text-zinc-600">
                                             <ImageIcon size={16} className="shrink-0 text-purple-500" />
                                             <span className="font-semibold">Video</span>
                                           </div>
                                         )}
                                       </div>
                                     )}

                                     {/* Audio / Voicenote Player */}
                                     {(item.messageType === 'audioMessage' || item.messageType === 'pttMessage') && (
                                       <div className="mb-1.5">
                                         {item.mediaUrl ? (
                                           <div className="flex items-center gap-2 rounded-2xl bg-black/5 p-2 min-w-[220px] max-w-[280px] border border-black/5">
                                             <div className="grid h-8 w-8 place-items-center rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                                               <Mic size={16} />
                                             </div>
                                             <audio
                                               src={resolveMediaUrl(item.mediaUrl)}
                                               controls
                                               className="h-8 flex-1 outline-none min-w-0"
                                               preload="metadata"
                                             />
                                           </div>
                                         ) : (
                                           <div className="flex items-center gap-2 rounded-lg bg-black/5 p-2 text-xs text-zinc-600">
                                             <Mic size={16} className="shrink-0 text-amber-600" />
                                             <span className="font-semibold">Pesan Suara (Voice Note)</span>
                                           </div>
                                         )}
                                       </div>
                                     )}

                                     {/* Document / File */}
                                     {item.messageType === 'documentMessage' && (
                                       <div className="mb-1.5">
                                         {item.mediaUrl ? (
                                           <a
                                             href={resolveMediaUrl(item.mediaUrl)}
                                             download={item.messageText || 'dokumen'}
                                             target="_blank"
                                             rel="noopener noreferrer"
                                             className="flex items-center justify-between gap-3 rounded-xl bg-black/5 p-2.5 text-xs hover:bg-black/10 transition border border-black/5 group"
                                             title="Klik untuk mengunduh berkas"
                                           >
                                             <div className="flex items-center gap-2.5 min-w-0">
                                               <div className="grid h-9 w-9 place-items-center rounded-lg bg-purple-100 text-purple-700 shrink-0">
                                                 <FileText size={18} />
                                               </div>
                                               <div className="min-w-0">
                                                 <p className="font-bold text-zinc-900 truncate max-w-[160px]">
                                                   {item.messageText || 'Dokumen'}
                                                 </p>
                                                 <p className="text-[10px] text-zinc-500">Klik untuk mengunduh</p>
                                               </div>
                                             </div>
                                             <div className="grid h-7 w-7 place-items-center rounded-full bg-white text-zinc-600 shadow-2xs group-hover:text-[#00a884] shrink-0">
                                               <Download size={14} />
                                             </div>
                                           </a>
                                         ) : (
                                           <div className="flex items-center gap-2 rounded-lg bg-black/5 p-2 text-xs text-zinc-600">
                                             <FileText size={16} className="shrink-0 text-sky-600" />
                                             <span className="font-semibold">{item.messageText || 'Dokumen Berkas / PDF'}</span>
                                           </div>
                                         )}
                                       </div>
                                     )}

                                     {Boolean(item.messageText) &&
                                       !['[Gambar]', '[Video]', '[Audio]', '[Voice Note]', '[Dokumen]', '[Stiker]', '[Lokasi]'].includes(item.messageText!.trim()) && (
                                         <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words text-[#111b21] mt-1">
                                           {item.messageText}
                                         </p>
                                     )}
                                   </>
                                 )}

                                {/* Timestamp & Read Receipts inside bubble */}
                                <span className="float-right ml-3 mt-1 inline-flex items-center gap-1 text-[11px] text-[#667781] select-none leading-none">
                                  {item.isStarred && (
                                    <span title="Pesan berbintang">
                                      <Star size={11} className="fill-amber-400 text-amber-500" />
                                    </span>
                                  )}
                                  <span>{formatBubbleTime(item.timestamp)}</span>
                                  {item.isFromMe && !isMessageDeleted && (
                                    item.status === 'failed' ? (
                                      <span title="Gagal terkirim" className="text-red-500">
                                        <AlertCircle size={12} />
                                      </span>
                                    ) : item.status === 'pending' ? (
                                      <span title="Menunggu" className="text-[#8696a0]">
                                        <Clock size={11} />
                                      </span>
                                    ) : item.status === 'sent' ? (
                                      <span title="Terkirim" className="text-[#8696a0] inline-flex items-center">
                                        <Check size={14} />
                                      </span>
                                    ) : (
                                      <span title={item.status === 'read' ? 'Sudah dibaca' : 'Tersampaikan'} className="inline-flex items-center">
                                        <CheckCheck
                                          size={15}
                                          className={item.status === 'read' ? 'text-[#53bdeb]' : 'text-[#8696a0]'}
                                        />
                                      </span>
                                    )
                                  )}
                                </span>

                                {/* Pinned Reaction Emoji Badge on Bubble */}
                                {item.reaction && !isMessageDeleted && (() => {
                                  const isAdminUser = user?.role === 'superadmin' || user?.role === 'admin';
                                  const isProspectReaction = item.reactionUserId === null && !item.isFromMe;
                                  const isMyReaction = item.reactionUserId === user?.id;
                                  const canRemoveReaction = !isProspectReaction && (isMyReaction || isAdminUser);
                                  return (
                                    <button
                                      type="button"
                                      disabled={!canRemoveReaction}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (canRemoveReaction) reactMutation.mutate({ messageId: item.id, emoji: item.reaction! });
                                      }}
                                      title={
                                        isProspectReaction ? 'Reaksi dari jamaah' :
                                        !isMyReaction && !isAdminUser ? 'Reaksi dari CS lain' :
                                        'Klik untuk menghapus reaksi'
                                      }
                                      className={cn(
                                        'absolute -bottom-2.5 right-2 flex items-center gap-0.5 rounded-full bg-white px-1.5 py-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.15)] border border-black/10 select-none z-10 transition-all',
                                        canRemoveReaction ? 'cursor-pointer hover:scale-110 active:scale-95' : 'cursor-default opacity-90'
                                      )}
                                    >
                                      <span className="text-[13px] leading-none">{item.reaction}</span>
                                    </button>
                                  );
                                })()}
                              </div>

                              {!item.isFromMe && !isMessageDeleted && canSend && reactionTrigger}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                  <div ref={endRef} />
                </div>
              </div>

              {/* Quick Reply Chips Bar */}
              {selected && canSend && (
                <div className="border-t border-[#e9edef] bg-[#f0f2f5] px-3 py-1.5 shrink-0">
                  <div className="thin-scrollbar mx-auto flex max-w-3xl items-center gap-1.5 overflow-x-auto pb-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#667781] shrink-0 mr-1">
                      Template:
                    </span>
                    {quickReplyChips.map((chip) => {
                      const Icon = chip.icon;
                      return (
                        <button
                          key={chip.id}
                          type="button"
                          onClick={() => handleInsertTemplate(chip.id)}
                          className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-[#e9edef] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#111b21] shadow-2xs transition hover:bg-[#f0f2f5] active:scale-95 cursor-pointer"
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
              {!isConnected ? (
                <div className="border-t border-[#e9edef] bg-[#f0f2f5] p-3.5 shrink-0" role="status">
                  <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <WifiOff size={16} className="shrink-0 text-amber-600" />
                    <span>Pengiriman dinonaktifkan karena WhatsApp brand terputus. Riwayat dan profil tetap dapat dibaca.</span>
                  </div>
                </div>
              ) : canReply ? (
                <form onSubmit={submit} className="border-t border-[#e9edef] bg-[#f0f2f5] p-2.5 sm:px-4 sm:py-2.5 shrink-0">
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
                      <div className="relative rounded-2xl border border-[#e9edef] bg-white p-3.5 shadow-sm">
                        <div className="flex items-center justify-between border-b border-zinc-100 pb-2 mb-2.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-zinc-800">Pratinjau Media</span>
                            {mediaPreview.isPackageFlyer && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10.5px] font-bold text-emerald-800 border border-emerald-300/60">
                                🕋 {mediaPreview.packageName}
                              </span>
                            )}
                            {mediaPreview.isCompressed ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10.5px] font-bold text-emerald-700 border border-emerald-200">
                                📉 Dicompress: {formatFileSize(mediaPreview.originalSize)} ➔ {formatFileSize(mediaPreview.compressedSize)} (Hemat {mediaPreview.savingsPercent}%)
                              </span>
                            ) : (
                              <span className="text-[10.5px] text-zinc-500 font-medium">
                                Ukuran: {formatFileSize(mediaPreview.compressedSize)}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              URL.revokeObjectURL(mediaPreview.url);
                              setMediaPreview(null);
                            }}
                            className="h-6 w-6 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition cursor-pointer"
                            title="Batal"
                          >
                            <X size={15} />
                          </button>
                        </div>

                        <div className="flex items-start gap-3.5">
                          {mediaPreview.type.startsWith('image/') ? (
                            <div className="relative h-20 w-20 rounded-xl overflow-hidden border border-black/10 shrink-0 bg-zinc-100">
                              <img src={mediaPreview.url} alt="Preview" className="h-full w-full object-cover" />
                            </div>
                          ) : mediaPreview.type.startsWith('video/') ? (
                            <div className="relative h-20 w-20 rounded-xl overflow-hidden border border-black/10 shrink-0 bg-black">
                              <video src={mediaPreview.url} className="h-full w-full object-cover" />
                            </div>
                          ) : (
                            <div className="grid h-20 w-20 place-items-center rounded-xl bg-purple-50 border border-purple-200 shrink-0">
                              <FileText size={30} className="text-purple-600" />
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-zinc-900 truncate">{mediaPreview.name}</p>
                            <p className="text-[11px] text-zinc-500 mt-0.5">{mediaPreview.type || 'Dokumen'}</p>
                            {mediaPreview.isPackageFlyer && (
                              <p className="text-[11px] text-emerald-800 mt-1 font-medium">
                                📄 Flyer resmi umroh siap dikirim dengan rincian jadwal, maskapai, hotel, dan rincian harga.
                              </p>
                            )}
                            {mediaPreview.isCompressed && (
                              <p className="text-[11px] text-emerald-700 mt-0.5">
                                ✅ Resolusi dan ukuran telah dioptimalkan otomatis agar server tetap cepat dan hemat penyimpanan.
                              </p>
                            )}

                            <div className="mt-2.5 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  URL.revokeObjectURL(mediaPreview.url);
                                  setMediaPreview(null);
                                }}
                                className="rounded-lg px-3 py-1 text-xs font-semibold text-zinc-600 border border-zinc-200 bg-white hover:bg-zinc-50 transition cursor-pointer"
                              >
                                Batal
                              </button>
                              {mediaPreview.isPackageFlyer && (
                                <button
                                  type="button"
                                  onClick={() => setShowPackagePickerModal(true)}
                                  className="rounded-lg px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 transition cursor-pointer"
                                >
                                  Ganti Paket
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={uploadingMedia}
                                onClick={() => void handleSendMedia()}
                                className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1 text-xs font-bold text-white bg-[#00a884] hover:bg-[#008f6f] active:scale-95 transition cursor-pointer disabled:opacity-60 shadow-xs"
                              >
                                {uploadingMedia ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
                                <span>{uploadingMedia ? 'Mengirim...' : 'Kirim'}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* WhatsApp Web Quoted Reply Preview Bar */}
                  {replyingTo && (
                    <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between rounded-lg border-l-4 border-[#00a884] bg-white p-2.5 shadow-2xs animate-fade-in">
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#00a884]">
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
                    {/* Emoji Button & Picker Popover */}
                    <div className="relative shrink-0" ref={emojiPickerContainerRef}>
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
                    </div>

                    {/* Attachment Button & Dropdown Menu (Flyer Paket, Foto & Video, Dokumen) */}
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type="button"
                          aria-label="Lampirkan Dokumen, Foto & Video, atau Flyer Paket"
                          title="Lampirkan berkas atau flyer"
                          className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full text-[#54656f] hover:text-[#111b21] hover:bg-black/5 transition cursor-pointer"
                        >
                          <Paperclip size={20} />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          side="top"
                          align="start"
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
                              <p className="text-[10px] font-normal text-zinc-500 truncate">
                                {currentPackage ? currentPackage.name : 'Brosur & jadwal resmi'}
                              </p>
                            </div>
                          </DropdownMenu.Item>

                          {currentPackage && (
                            <DropdownMenu.Item
                              onClick={() => setShowPackagePickerModal(true)}
                              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 outline-none cursor-pointer transition border-b border-zinc-100"
                            >
                              <span className="text-[10px]">🔄</span>
                              <span>Pilih brosur paket lain...</span>
                            </DropdownMenu.Item>
                          )}

                          {/* Foto & Video */}
                          <DropdownMenu.Item
                            onClick={() => mediaInputRef.current?.click()}
                            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold text-[#111b21] hover:bg-[#f0f2f5] outline-none cursor-pointer transition"
                          >
                            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#007bfc] text-white shadow-xs shrink-0">
                              <ImageIcon size={16} />
                            </div>
                            <div>
                              <p className="font-semibold text-zinc-900">Foto & Video</p>
                              <p className="text-[10px] font-normal text-zinc-500">Gambar (Autocompress), Video</p>
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
                              <p className="text-[10px] font-normal text-zinc-500">PDF, Word, Excel, ZIP</p>
                            </div>
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>

                    <textarea
                      ref={composerRef}
                      rows={1}
                      value={message}
                      onChange={handleComposerChange}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      placeholder={mediaPreview ? "Tambahkan keterangan (opsional)..." : "Ketik pesan..."}
                      aria-label="Tulis pesan WhatsApp"
                      className="min-h-10 max-h-36 flex-1 resize-none rounded-lg bg-white px-4 py-2.5 text-sm text-[#111b21] placeholder:text-[#8696a0] border border-transparent focus:border-[#00a884]/30 outline-none leading-relaxed shadow-2xs"
                    />

                    <button
                      type="submit"
                      disabled={(!message.trim() && !mediaPreview) || send.isPending || uploadingMedia}
                      aria-label="Kirim pesan WhatsApp"
                      title="Kirim pesan (Enter)"
                      className={cn(
                        'h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-white transition shadow-xs cursor-pointer',
                        (message.trim() || mediaPreview) && !send.isPending && !uploadingMedia
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
                        onClick={() => void send.mutate(message.trim())}
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
                        <p className="font-bold text-zinc-950">
                          Hanya Admin dan PIC yang dapat membalas chat
                        </p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          Percakapan ini ditugaskan kepada PIC <strong>{selected.user?.name || 'CS lain'}</strong>.{' '}
                          {canTakeOver
                            ? 'Jamaah belum dibalas lebih dari 15 menit, jadi Anda boleh mengambil alih.'
                            : 'Anda hanya dapat membaca pesan. Bila jamaah belum dibalas lebih dari 15 menit, CS lain boleh mengambil alih.'}
                        </p>
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
            onChangeTab={(tab) => setSidePanelTab(tab)}
            onClose={() => setSidePanelTab(null)}
            prospectId={selected.id}
            prospectName={selected.name}
            phone={selected.phone}
            packageId={currentPackage?.id ?? selected.packageId}
            packageName={currentPackage?.name}
            brandId={brandId}
            query={query}
            activeBrand={activeBrand}
            packages={packages.data ?? []}
            onInsertText={handleInsertDirectText}
            onSendFlyer={(pkg) => openSendFlyerModal(pkg)}
            onOpenPackagePicker={() => setShowPackagePickerModal(true)}
            onPreviewImage={(url) => setPreviewFlyer(url)}
            onShowToast={showToast}
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

      {/* Package Picker Modal (Brosur & Flyer Paket Umroh) */}
      <ModalFrame open={showPackagePickerModal} onClose={() => setShowPackagePickerModal(false)} title="Kirim flyer brosur paket umroh">
          <div className="relative flex flex-col max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl border border-zinc-200 animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 bg-[#f0f2f5]">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                  <ImageIcon size={20} />
                </div>
                <div>
                  <p aria-hidden="true" className="font-display text-base font-bold text-zinc-900">
                    Kirim Flyer Brosur Paket Umroh
                  </p>
                  <p className="text-xs text-zinc-500">
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
                  placeholder="Cari nama paket, maskapai, tanggal, atau hotel..."
                  className="w-full rounded-xl border border-zinc-200 bg-white pl-10 pr-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884] outline-none"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-zinc-600 font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={linkPackageToProspect}
                  onChange={(e) => setLinkPackageToProspect(e.target.checked)}
                  className="rounded border-zinc-300 text-[#00a884] focus:ring-[#00a884]"
                />
                <span>Hubungkan paket ke profil prospek</span>
              </label>
            </div>

            {/* Package List */}
            <div className="thin-scrollbar flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
              {filteredPackages.length === 0 ? (
                <div className="text-center py-12">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-zinc-100 text-zinc-400 mb-3">
                    <Search size={22} />
                  </div>
                  <p className="text-sm font-bold text-zinc-700">Tidak ada paket umroh yang cocok</p>
                  <p className="text-xs text-zinc-400 mt-1">
                    {packageSearch ? 'Coba kata kunci pencarian yang lain' : 'Belum ada paket umroh aktif pada brand ini'}
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
                        'group flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border p-4 transition duration-150',
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
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-sm text-zinc-900 truncate">{pkg.name}</h4>
                            {isCurrent && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                Paket Terhubung
                              </span>
                            )}
                            {hasFlyer ? (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
                                🖼️ Flyer Siap
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                                📁 Upload Saat Kirim
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                            <span>📅 {departureStr} ({pkg.duration || '9 Hari'})</span>
                            {pkg.airline && <span>✈️ {pkg.airline}</span>}
                            {(pkg.hotelMakkah || pkg.hotelMadinah) && (
                              <span>🏨 {pkg.hotelMakkah || pkg.hotelMadinah}</span>
                            )}
                          </div>

                          <div className="mt-1 text-xs font-bold text-[#00a884]">
                            Quad Mulai: Rp {pkg.priceQuad || pkg.price}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-100">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            if (selectedId) {
                              void api.patch(`/prospects/${selectedId}/profile`, {
                                packageId: pkg.id,
                                ...(user?.role === 'superadmin' ? { brandId } : {}),
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
                          className="w-full sm:w-auto gap-1 text-xs font-bold border-zinc-300 hover:bg-zinc-100 cursor-pointer"
                        >
                          <Check size={14} className="text-[#00a884]" />
                          <span>Pilih Paket Ini</span>
                        </Button>

                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            if (linkPackageToProspect && selectedId) {
                              void api.patch(`/prospects/${selectedId}/profile`, {
                                packageId: pkg.id,
                                ...(user?.role === 'superadmin' ? { brandId } : {}),
                              })
                                .then(() => {
                                  void queryClient.invalidateQueries({ queryKey: ['prospect', selectedId] });
                                  void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
                                  void queryClient.invalidateQueries({ queryKey: ['prospects'] });
                                })
                                .catch(() => null);
                            }
                            setShowPackagePickerModal(false);
                            void loadFlyerAsMediaPreview(pkg);
                          }}
                          className="w-full sm:w-auto gap-1.5 bg-[#00a884] hover:bg-[#008f6f] text-white font-bold text-xs shadow-xs cursor-pointer"
                        >
                          <ImageIcon size={14} />
                          <span>Pilih & Siapkan Flyer</span>
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
              <Button variant="ghost" size="sm" onClick={() => setShowPackagePickerModal(false)}>
                Tutup
              </Button>
            </div>
          </div>
      </ModalFrame>


    </div>
  );
}

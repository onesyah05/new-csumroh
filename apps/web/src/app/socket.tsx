import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken, onSessionChange, refreshSession } from '../lib/api';
import { queryClient } from './query';
import { useAuth } from './auth';
import { useUiStore } from './store';
import { pushNotificationToast } from './toast';
import { openNotificationPanel } from '../features/notifications/NotificationBell';
import { playNotificationSound } from '../lib/notificationSound';

export function SocketBridge() {
  const { user } = useAuth();
  const userId = user?.id;
  const setRealtimeStatus = useUiStore((state) => state.setRealtimeStatus);
  useEffect(() => {
    if (!userId || !getAccessToken()) return;
    // Token dibaca ulang di setiap handshake: access token berumur 15 menit, sehingga reconnect
    // setelah itu harus memakai token hasil refresh, bukan token saat login.
    const socket = io(import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000', {
      auth: (cb) => cb({ token: getAccessToken() }),
      withCredentials: true,
    });
    setRealtimeStatus('connecting');
    let hasConnectedBefore = false;
    socket.on('connect', () => {
      setRealtimeStatus('online');
      // Event yang terlewat selama terputus tidak diputar ulang server: sinkronkan ulang data.
      if (hasConnectedBefore) refresh();
      hasConnectedBefore = true;
    });
    socket.on('disconnect', (reason) => {
      setRealtimeStatus('offline');
      // Server memutus saat access token kedaluwarsa atau akses dicabut. socket.io tidak menyambung ulang
      // sendiri untuk alasan ini: refresh dulu. Bila refresh ditolak (akun nonaktif), sesi berakhir → keluar.
      if (reason === 'io server disconnect') {
        void refreshSession().then((session) => { if (session) socket.connect(); });
      }
    });
    socket.on('connect_error', (error) => {
      setRealtimeStatus('offline');
      // Handshake ditolak middleware auth (token kedaluwarsa): socket.io tidak mencoba lagi sendiri.
      if (error.message === 'unauthorized') {
        void refreshSession().then((session) => { if (session) socket.connect(); });
      }
    });
    // Setelah refresh token sukses di mana pun, socket yang sedang putus dicoba lagi dengan token baru.
    const unsubscribeSession = onSessionChange((session) => {
      if (session && !socket.connected) socket.connect();
    });

    // Sinkron penuh: hanya setelah tersambung ulang (event yang terlewat tidak diputar ulang server).
    const refresh = () => {
      for (const key of ['contacts', 'prospects', 'prospect', 'messages', 'conversations', 'dashboard', 'verification-queue', 'scripts']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    };

    // Event realtime datang beruntun (WhatsApp ramai, impor riwayat). Muat ulang digabung per 1,5 detik dan hanya
    // untuk data yang terdampak; sebelumnya setiap event memuat ulang daftar + chat terbuka di setiap browser.
    const pendingKeys = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = (...keys: string[]) => {
      keys.forEach((key) => pendingKeys.add(key));
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const keysNow = [...pendingKeys];
        pendingKeys.clear();
        for (const key of keysNow) void queryClient.invalidateQueries({ queryKey: [key] });
      }, 1500);
    };
    const refreshLists = () => scheduleRefresh('conversations', 'prospects', 'contacts', 'dashboard', 'verification-queue');

    // Pesan baru langsung masuk ke chat yang sedang terbuka (tanpa memuat ulang riwayat), lalu daftar menyusul.
    const onMessageNew = (message?: { id?: number; prospectId?: number | null; remoteJid?: string; timestamp?: number }) => {
      if (message?.id) {
        queryClient.setQueriesData<any[]>({ queryKey: ['messages'] }, (old) => {
          if (!Array.isArray(old) || old.some((m) => m.id === message.id)) return old;
          const sameConversation = old.some((m) => (message.prospectId && m.prospectId === message.prospectId) || (message.remoteJid && m.remoteJid === message.remoteJid));
          if (!sameConversation) return old;
          return [...old, message].sort((a, b) => (a.timestamp - b.timestamp) || (a.id - b.id));
        });
      }
      refreshLists();
    };
    // Reaksi/hapus/bintang mengubah isi chat terbuka; daftar hanya bila pesan terakhir ikut berubah.
    const onMessageChanged = () => scheduleRefresh('messages', 'conversations');

    const onMessageStatus = (data?: { messageId?: string; status?: string; prospectId?: number }) => {
      if (data?.messageId && data?.status) {
        // Optimistically update message status in open chat view immediately
        queryClient.setQueriesData<any[]>({ queryKey: ['messages'] }, (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((m) => (m.messageId === data.messageId ? { ...m, status: data.status } : m));
        });
        // Optimistically update status on conversation list snippet
        queryClient.setQueriesData<any[]>({ queryKey: ['conversations'] }, (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((c) => {
            if (c.messages?.[0]?.messageId === data.messageId) {
              return {
                ...c,
                messages: [{ ...c.messages[0], status: data.status }],
              };
            }
            return c;
          });
        });
      }
      // Status cukup diperbarui di cache; tidak memuat ulang daftar/chat (dulu ±3 muat ulang per pesan keluar).
    };

    const refreshWhatsApp = () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['whatsapp-device'] });
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
    };

    socket.on('message:new', onMessageNew);
    socket.on('message:status', onMessageStatus);
    socket.on('message:reaction', onMessageChanged);
    socket.on('message:deleted', onMessageChanged);
    socket.on('message:starred', onMessageChanged);
    socket.on('contacts:synced', refreshLists);
    socket.on('conversations:updated', refreshLists);
    const onFinanceProof = (data?: { prospectId?: number; name?: string }) => {
      if (data?.prospectId) {
        void queryClient.invalidateQueries({ queryKey: ['prospect', data.prospectId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['verification-queue'] });
    };

    const onQuotaUpdated = (data?: { packageId?: number }) => {
      void queryClient.invalidateQueries({ queryKey: ['packages'] });
      // Kuota ikut menentukan isi & status script (audit S13).
      void queryClient.invalidateQueries({ queryKey: ['scripts'] });
      if (data?.packageId) {
        void queryClient.invalidateQueries({ queryKey: ['package', data.packageId] });
      }
    };

    socket.on('conversation:read', refreshLists);
    // Data prospek berubah (status, PIC, kualifikasi): profil & skrip ikut, tanpa memuat ulang chat.
    const onProspectChanged = () => scheduleRefresh('prospect', 'prospects', 'conversations', 'dashboard', 'verification-queue', 'scripts');
    socket.on('prospect:updated', onProspectChanged);
    socket.on('prospect:claimed', onProspectChanged);

    // Notifikasi in-app: lencana/panel disegarkan; tindakan & mendesak juga muncul sebagai toast,
    // kecuali user sedang melihat objeknya (mis. chat prospek yang sama sudah terbuka).
    const refreshNotifications = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    // Server sudah menghitung preferensi penerima (toast/suara) untuk tiap notifikasi.
    const onNotification = (data?: {
      id: number; priority: 'info' | 'action' | 'urgent'; title: string; body?: string | null; link?: string | null; toast?: boolean; sound?: boolean;
    }) => {
      refreshNotifications();
      // Antrean Layanan Custom (Tim LA) tidak menerima event brand; segarkan dari notifikasi.
      void queryClient.invalidateQueries({ queryKey: ['custom-requests'] });
      if (!data || isViewing(data.link)) return;
      if (data.toast) pushNotificationToast(data, openNotificationPanel);
      if (data.sound) playNotificationSound({ urgent: data.priority === 'urgent' });
    };
    socket.on('notification:new', onNotification);
    socket.on('notification:updated', refreshNotifications);
    socket.on('notification:read', refreshNotifications);
    socket.on('finance:payment_proof_new', onFinanceProof);
    socket.on('package:quota_updated', onQuotaUpdated);
    socket.on('wa:status', refreshWhatsApp);
    socket.on('whatsapp:status', refreshWhatsApp);
    socket.on('wa:qr', refreshWhatsApp);

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      unsubscribeSession();
      socket.close();
      setRealtimeStatus('offline');
    };
  }, [userId, setRealtimeStatus]);

  return null;
}

/** Tautan notifikasi menunjuk halaman yang sedang dibuka (prospek yang sama di Inbox/detail). */
function isViewing(link?: string | null) {
  if (!link || typeof window === 'undefined') return false;
  const target = new URL(link, window.location.origin);
  const here = window.location;
  if (target.pathname !== here.pathname) return false;
  const prospectId = target.searchParams.get('prospectId');
  if (prospectId) return new URLSearchParams(here.search).get('prospectId') === prospectId;
  return target.pathname.startsWith('/prospects/');
}

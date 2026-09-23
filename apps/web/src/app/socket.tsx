import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken, onSessionChange, refreshSession } from '../lib/api';
import { queryClient } from './query';
import { useAuth } from './auth';
import { useUiStore } from './store';

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
    socket.on('disconnect', () => setRealtimeStatus('offline'));
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

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['prospect'] });
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['verification-queue'] });
    };

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
      refresh();
    };

    const refreshWhatsApp = () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['whatsapp-device'] });
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
    };

    socket.on('message:new', refresh);
    socket.on('message:status', onMessageStatus);
    socket.on('message:reaction', refresh);
    socket.on('message:deleted', refresh);
    socket.on('message:starred', refresh);
    socket.on('contacts:synced', refresh);
    socket.on('conversations:updated', refresh);
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
      if (data?.packageId) {
        void queryClient.invalidateQueries({ queryKey: ['package', data.packageId] });
      }
    };

    socket.on('conversation:read', refresh);
    socket.on('prospect:updated', refresh);
    socket.on('prospect:claimed', refresh);
    socket.on('finance:payment_proof_new', onFinanceProof);
    socket.on('package:quota_updated', onQuotaUpdated);
    socket.on('wa:status', refreshWhatsApp);
    socket.on('whatsapp:status', refreshWhatsApp);
    socket.on('wa:qr', refreshWhatsApp);

    return () => {
      unsubscribeSession();
      socket.close();
      setRealtimeStatus('offline');
    };
  }, [userId, setRealtimeStatus]);

  return null;
}

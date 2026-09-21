import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken } from '../lib/api';
import { queryClient } from './query';
import { useAuth } from './auth';

export function SocketBridge() {
  const { user } = useAuth();
  useEffect(() => {
    const token = getAccessToken();
    if (!user || !token) return;
    const socket = io(import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000', { auth: { token }, withCredentials: true });
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['contacts'] }); void queryClient.invalidateQueries({ queryKey: ['prospects'] }); void queryClient.invalidateQueries({ queryKey: ['prospect'] }); void queryClient.invalidateQueries({ queryKey: ['messages'] }); void queryClient.invalidateQueries({ queryKey: ['conversations'] }); void queryClient.invalidateQueries({ queryKey: ['dashboard'] }); };
    const refreshWhatsApp = () => { refresh(); void queryClient.invalidateQueries({ queryKey: ['whatsapp-device'] }); void queryClient.invalidateQueries({ queryKey: ['brands'] }); };
    socket.on('message:new', refresh); socket.on('contacts:synced', refresh); socket.on('prospect:updated', refresh); socket.on('prospect:claimed', refresh); socket.on('wa:status', refreshWhatsApp); socket.on('wa:qr', refreshWhatsApp);
    return () => { socket.close(); };
  }, [user]);
  return null;
}

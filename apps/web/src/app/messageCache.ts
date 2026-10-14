import type { QueryClient } from '@tanstack/react-query';

export type IncomingMessage = { id?: number; brandId: number; prospectId?: number | null; remoteJid?: string; timestamp?: number };

/**
 * Pesan baru langsung masuk ke chat yang sedang terbuka (tanpa memuat ulang riwayat).
 * Key chat: ['messages', prospectId, brandId]. Jamaah yang sama bisa chat ke dua brand (remoteJid sama),
 * jadi pesan hanya masuk ke cache brand-nya sendiri.
 */
export function appendIncomingMessage(queryClient: QueryClient, message?: IncomingMessage) {
  if (!message?.id) return;
  const predicate = (query: { queryKey: readonly unknown[] }) => {
    const [key, , cachedBrandId] = query.queryKey;
    return key === 'messages' && cachedBrandId === message.brandId;
  };
  queryClient.setQueriesData<any[]>({ predicate }, (old) => {
    if (!Array.isArray(old) || old.some((m) => m.id === message.id)) return old;
    const sameConversation = old.some((m) => (message.prospectId && m.prospectId === message.prospectId) || (message.remoteJid && m.remoteJid === message.remoteJid));
    if (!sameConversation) return old;
    return [...old, message].sort((a, b) => (a.timestamp - b.timestamp) || (a.id - b.id));
  });
}

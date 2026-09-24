import { useQuery } from '@tanstack/react-query';
import { avatarNeedsRefresh } from '@csumroh/shared-types';
import { api } from './api';

export type AvatarSource = { id: number; brandId?: number; photoUrl?: string | null; remoteJid?: string | null };

const BATCH = 40;

/**
 * Minta API menyalin foto profil WhatsApp untuk prospek yang belum punya salinan lokal atau salinannya
 * sudah lebih dari 7 hari. Hasil digabung saat render lewat `photoFor`, tanpa refetch daftar prospek.
 */
export function useWhatsAppAvatars(items: Partial<AvatarSource>[] | undefined, brandId: number | null | undefined) {
  // Dikelompokkan per brand: endpoint refresh ter-scope ke satu brand (Dashboard holding berisi banyak brand).
  const pending = (items ?? [])
    .filter((p): p is AvatarSource => typeof p.id === 'number')
    .filter((p) => !p.remoteJid?.endsWith('@g.us') && avatarNeedsRefresh(p.photoUrl) && (p.brandId ?? brandId))
    .map((p) => ({ id: p.id, brandId: (p.brandId ?? brandId)! }))
    .sort((a, b) => a.id - b.id);

  const refreshed = useQuery({
    queryKey: ['avatars', pending.map((p) => `${p.brandId}:${p.id}`).join(',')],
    enabled: pending.length > 0,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const merged: Record<number, string | null> = {};
      const byBrand = new Map<number, number[]>();
      for (const p of pending) byBrand.set(p.brandId, [...(byBrand.get(p.brandId) ?? []), p.id]);
      for (const [targetBrand, ids] of byBrand) {
        for (let i = 0; i < ids.length; i += BATCH) {
          const chunk = await api.post<Record<number, string | null>>('/chat/avatars/refresh', {
            brandId: targetBrand,
            prospectIds: ids.slice(i, i + BATCH),
          });
          Object.assign(merged, chunk);
        }
      }
      return merged;
    },
  });

  return (item: Partial<AvatarSource>) => {
    const fresh = item.id === undefined ? undefined : refreshed.data?.[item.id];
    return fresh !== undefined ? fresh : item.photoUrl ?? null;
  };
}

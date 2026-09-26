import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';

/**
 * Tandai / batalkan spam. Spam keluar dari pipeline, antrean, dan laporan; tidak dikirim ke Meta dan
 * nomornya masuk audiens pengecualian iklan brand.
 */
export function useSpamToggle(brandId: number | null | undefined, onDone: (message: string) => void) {
  return useMutation({
    mutationFn: ({ prospectId, spam }: { prospectId: number; spam: boolean }) =>
      api.post<any>(`/prospects/${prospectId}/spam`, { spam, brandId }),
    onSuccess: (data, { prospectId, spam }) => {
      queryClient.setQueryData(['prospect', prospectId, brandId], data);
      void queryClient.invalidateQueries({ queryKey: ['conversations', brandId] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      onDone(spam ? 'Ditandai spam. Chat ini tidak lagi masuk pipeline dan antrean.' : 'Tanda spam dibatalkan.');
    },
    onError: (error: Error) => onDone(error.message || 'Gagal mengubah tanda spam.'),
  });
}

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';

const QUICK_REASONS = ['Nominal tidak sesuai tagihan', 'Rekening tujuan salah', 'Bukan bukti transfer', 'Gambar tidak terbaca'];

/**
 * Finance menolak bukti transfer dengan alasan. Bukti keluar dari antrean, dan PIC mendapat
 * notifikasi mendesak untuk meminta bukti yang benar ke jamaah.
 */
export function RejectProofDialog({ prospect, onDone, onClose }: {
  prospect: { id: number; name: string; brandId: number };
  onDone(message: string): void;
  onClose(): void;
}) {
  const [reason, setReason] = useState('');
  const reject = useMutation({
    mutationFn: () => api.post(`/prospects/${prospect.id}/reject-proof`, { reason: reason.trim(), brandId: prospect.brandId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['verification-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['verification-history'] });
      void queryClient.invalidateQueries({ queryKey: ['verification-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospect.id] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      onDone(`Bukti transfer ${prospect.name} ditolak. PIC sudah diberi tahu.`);
    },
  });
  const valid = reason.trim().length >= 3;

  return (
    <Modal
      open
      onClose={onClose}
      title="Tolak bukti transfer"
      description={<>Bukti <strong>{prospect.name}</strong> keluar dari antrean. PIC diminta mengirim bukti yang benar.</>}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="button" onClick={() => reject.mutate()} disabled={!valid || reject.isPending}>
            {reject.isPending ? 'Menolak…' : 'Tolak bukti'}
          </Button>
        </>
      }
    >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Alasan cepat">
            {QUICK_REASONS.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => setReason(text)}
                aria-pressed={reason === text}
                className="min-h-7 rounded-full border border-zinc-300 px-2.5 text-xs text-zinc-700 hover:bg-zinc-100 aria-pressed:border-zinc-950 aria-pressed:bg-zinc-950 aria-pressed:text-white"
              >
                {text}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-zinc-600">Alasan penolakan</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Mis. nominal Rp 5.000.000, tagihan Rp 10.000.000"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          {reject.error && <p className="text-xs text-rose-700" role="alert">{reject.error.message}</p>}
        </div>
    </Modal>
  );
}

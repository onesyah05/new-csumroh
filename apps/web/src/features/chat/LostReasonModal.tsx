import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Ban, X } from 'lucide-react';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { ModalFrame } from '../../components/ui/modal';

interface LostReasonModalProps {
  open: boolean;
  onClose: () => void;
  prospect: any;
  brandId?: number;
  onShowToast: (msg: string) => void;
}

const COMMON_LOST_REASONS = [
  { value: 'Budget tidak mencukupi / mencari paket termurah', label: 'Budget tidak mencukupi / cari yang lebih murah' },
  { value: 'Memilih travel kompetitor', label: 'Memilih travel kompetitor' },
  { value: 'Jadwal cuti kerja / sekolah tidak cocok', label: 'Jadwal cuti kerja / sekolah tidak cocok' },
  { value: 'Keluarga / pengambil keputusan membatalkan', label: 'Keluarga / pengambil keputusan membatalkan' },
  { value: 'Kendala kesehatan / fisik lansia', label: 'Kendala kesehatan / fisik lansia' },
  { value: 'Nomor tidak aktif / lost contact', label: 'Nomor tidak aktif / lost contact' },
  { value: 'Lainnya', label: 'Alasan lainnya...' },
];

export function LostReasonModal({
  open,
  onClose,
  prospect,
  brandId,
  onShowToast,
}: LostReasonModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>(
    COMMON_LOST_REASONS[0]?.value || 'Lainnya'
  );
  const [customDetail, setCustomDetail] = useState<string>('');

  const lostMutation = useMutation({
    mutationFn: () => {
      const fullReason =
        selectedReason === 'Lainnya'
          ? customDetail.trim()
          : customDetail.trim()
            ? `${selectedReason}: ${customDetail.trim()}`
            : selectedReason;

      return api.patch(`/prospects/${prospect.id}/status`, {
        status: 'lose',
        lostReason: fullReason,
        brandId,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospect.id] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onShowToast('Status prospek berhasil diubah ke Batal (lose).');
      onClose();
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Gagal mengubah status ke Batal.');
    },
  });

  if (!open) return null;

  return (
    <ModalFrame open={open} onClose={onClose} title="Batalkan prospek">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 bg-rose-50/80">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-rose-100 text-rose-700">
              <Ban size={18} />
            </span>
            <div>
              <h3 className="font-bold text-sm text-zinc-900">Batalkan Prospek (Lose)</h3>
              <p className="text-[11px] text-zinc-500">Wajib mengisi alasan pembatalan jamaah</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
              Alasan Pembatalan Utama
            </label>
            <Select
              value={selectedReason}
              onValueChange={setSelectedReason}
              options={COMMON_LOST_REASONS}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
              Catatan Detail Pembatalan (Wajib jika alasan lainnya)
            </label>
            <textarea
              rows={3}
              value={customDetail}
              onChange={(e) => setCustomDetail(e.target.value)}
              placeholder="Jelaskan secara ringkas penyebab jamaah tidak jadi mendaftar..."
              className="w-full rounded-xl border border-zinc-200 p-2.5 text-xs leading-relaxed focus:border-rose-500 focus:outline-none resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3.5 bg-zinc-50">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={lostMutation.isPending}>
            Kembali
          </Button>
          <Button
            size="sm"
            onClick={() => lostMutation.mutate()}
            disabled={
              lostMutation.isPending ||
              (selectedReason === 'Lainnya' && !customDetail.trim())
            }
            className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold"
          >
            <Ban size={14} />
            {lostMutation.isPending ? 'Menyimpan...' : 'Konfirmasi Batal (Lose)'}
          </Button>
        </div>
      </div>
    </ModalFrame>
  );
}

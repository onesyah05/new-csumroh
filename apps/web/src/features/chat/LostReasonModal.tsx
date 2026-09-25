import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { Modal } from '../../components/ui/modal';

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
  { value: 'Lainnya', label: 'Lainnya' },
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
      onShowToast('Prospek ditandai tidak jadi');
      onClose();
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Status gagal diubah.');
    },
  });

  if (!open) return null;
  const needsDetail = selectedReason === 'Lainnya';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Jamaah tidak jadi"
      description={prospect?.name}
      footer={
        <Button variant="danger" size="sm" icon={<Ban size={14} />} loading={lostMutation.isPending} onClick={() => lostMutation.mutate()} disabled={lostMutation.isPending || (needsDetail && !customDetail.trim())}>
          Tandai tidak jadi
        </Button>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="mb-1 block text-xs font-semibold text-zinc-600">Alasan</span>
          <Select aria-label="Alasan" value={selectedReason} onValueChange={setSelectedReason} options={COMMON_LOST_REASONS} className="w-full" />
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-zinc-600">Catatan{needsDetail ? ' *' : ' (opsional)'}</span>
          <textarea rows={3} value={customDetail} onChange={(e) => setCustomDetail(e.target.value)} className="field h-auto resize-none py-2" />
        </label>
      </div>
    </Modal>
  );
}

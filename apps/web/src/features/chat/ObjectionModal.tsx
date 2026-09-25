import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { Modal } from '../../components/ui/modal';

interface ObjectionModalProps {
  open: boolean;
  onClose: () => void;
  prospect: any;
  brandId?: number;
  onShowToast: (msg: string) => void;
}

const OBJECTION_CATEGORIES = [
  { value: 'price', label: 'Harga terlalu mahal / di luar budget' },
  { value: 'competitor', label: 'Bandingkan dengan travel kompetitor' },
  { value: 'schedule_leave', label: 'Kendala jadwal cuti / waktu kerja' },
  { value: 'passport', label: 'Paspor belum ada / bermasalah' },
  { value: 'family_decision', label: 'Keluarga / pengambil keputusan belum sepakat' },
  { value: 'facility_distance', label: 'Ragu fasilitas / jarak hotel ke masjid' },
  { value: 'other', label: 'Keberatan lainnya' },
];

export function ObjectionModal({
  open,
  onClose,
  prospect,
  brandId,
  onShowToast,
}: ObjectionModalProps) {
  const [category, setCategory] = useState<string>(prospect?.objectionCategory || 'price');
  const [notes, setNotes] = useState<string>(prospect?.objectionNotes || '');

  const objectionMutation = useMutation({
    mutationFn: () =>
      api.post(`/prospects/${prospect.id}/objection`, {
        category,
        notes: notes.trim(),
        brandId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospect.id] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onShowToast('Keberatan dicatat');
      onClose();
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Keberatan gagal dicatat.');
    },
  });

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catat keberatan"
      description={prospect?.name}
      footer={
        <Button size="sm" icon={<Save size={14} />} loading={objectionMutation.isPending} onClick={() => objectionMutation.mutate()} disabled={objectionMutation.isPending || !notes.trim()}>
          Simpan keberatan
        </Button>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="mb-1 block text-xs font-semibold text-zinc-600">Keberatan utama</span>
          <Select aria-label="Keberatan utama" value={category} onValueChange={setCategory} options={OBJECTION_CATEGORIES} className="w-full" />
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-zinc-600">Rincian dan jawaban CS *</span>
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Apa kata jamaah dan apa yang Anda tawarkan" className="field h-auto resize-none py-2" />
        </label>
      </div>
    </Modal>
  );
}

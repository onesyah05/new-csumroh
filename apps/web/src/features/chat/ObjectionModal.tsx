import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, Save, X } from 'lucide-react';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { ModalFrame } from '../../components/ui/modal';

interface ObjectionModalProps {
  open: boolean;
  onClose: () => void;
  prospect: any;
  brandId?: number;
  onShowToast: (msg: string) => void;
}

const OBJECTION_CATEGORIES = [
  { value: 'price', label: '💰 Harga terlalu mahal / di luar budget' },
  { value: 'competitor', label: '🏢 Bandingkan dengan travel kompetitor' },
  { value: 'schedule_leave', label: '📅 Kendala jadwal cuti / waktu kerja' },
  { value: 'passport', label: '🛂 Paspor belum ada / bermasalah' },
  { value: 'family_decision', label: '👥 Keluarga / pengambil keputusan belum sepakat' },
  { value: 'facility_distance', label: '🏨 Ragu fasilitas / jarak hotel ke masjid' },
  { value: 'other', label: '❓ Keberatan lainnya' },
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
      onShowToast('Keberatan berhasil dicatat dan status beralih ke Keberatan (objection)!');
      onClose();
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Gagal mencatat keberatan.');
    },
  });

  if (!open) return null;

  return (
    <ModalFrame open={open} onClose={onClose} title="Catat keberatan jamaah">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 bg-amber-50/70">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-100 text-amber-800">
              <AlertCircle size={18} />
            </span>
            <div>
              <h3 className="font-bold text-sm text-zinc-900">Catat Keberatan Jamaah</h3>
              <p className="text-[11px] text-zinc-500">Mempromosikan status ke Keberatan (objection)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
              Kategori Keberatan Utama
            </label>
            <Select
              value={category}
              onValueChange={setCategory}
              options={OBJECTION_CATEGORIES}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
              Rincian Keberatan & Solusi dari CS (Wajib Diisi)
            </label>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Jamaah merasa harga paket bintang 5 agak berat, kami berikan opsi kamar Quad atau paket reguler bintang 4..."
              className="w-full rounded-xl border border-zinc-200 p-3 text-xs leading-relaxed focus:border-amber-500 focus:outline-none resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3.5 bg-zinc-50">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={objectionMutation.isPending}>
            Batal
          </Button>
          <Button
            size="sm"
            onClick={() => objectionMutation.mutate()}
            disabled={objectionMutation.isPending || !notes.trim()}
            className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold"
          >
            <Save size={14} />
            {objectionMutation.isPending ? 'Menyimpan...' : 'Simpan & Masuk ke Keberatan'}
          </Button>
        </div>
      </div>
    </ModalFrame>
  );
}

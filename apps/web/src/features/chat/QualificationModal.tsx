import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, UserCheck, X } from 'lucide-react';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { ModalFrame } from '../../components/ui/modal';

interface QualificationModalProps {
  open: boolean;
  onClose: () => void;
  prospect: any;
  brandId?: number;
  onShowToast: (msg: string) => void;
}

const COMMON_TARGET_MONTHS = [
  'Ramadan 1448H',
  'Syawal 1448H',
  'Awal Musim (Agustus-September)',
  'Oktober 2026',
  'November 2026',
  'Desember 2026 (Liburan Akhir Tahun)',
  'Januari 2027',
  'Februari 2027',
  'Rajab / Sya\'ban 1448H',
];

const ROOM_OPTIONS = [
  { value: 'Quad', label: 'Quad (Sekamar Ber-4) — Paling Hemat' },
  { value: 'Triple', label: 'Triple (Sekamar Ber-3) — Nyaman Keluarga' },
  { value: 'Double', label: 'Double (Sekamar Ber-2) — Pasutri / Private' },
];

export function QualificationModal({
  open,
  onClose,
  prospect,
  brandId,
  onShowToast,
}: QualificationModalProps) {
  const [targetMonth, setTargetMonth] = useState<string>(prospect?.targetMonth || '');
  const [roomPreference, setRoomPreference] = useState<string>(
    prospect?.roomPreference || (prospect?.paxDouble ? 'Double' : prospect?.paxTriple ? 'Triple' : 'Quad')
  );
  const [paxQuad, setPaxQuad] = useState<number>(prospect?.paxQuad ?? (roomPreference === 'Quad' ? 1 : 0));
  const [paxTriple, setPaxTriple] = useState<number>(prospect?.paxTriple ?? 0);
  const [paxDouble, setPaxDouble] = useState<number>(prospect?.paxDouble ?? 0);
  const [paxInfant, setPaxInfant] = useState<number>(prospect?.paxInfant ?? 0);
  const [budgetRange, setBudgetRange] = useState<string>(prospect?.budgetRange || '');
  const [decisionMaker, setDecisionMaker] = useState<string>(prospect?.decisionMaker || '');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const totalPax = Number(paxQuad || 0) + Number(paxTriple || 0) + Number(paxDouble || 0) + Number(paxInfant || 0);

  const qualifyMutation = useMutation({
    mutationFn: () => {
      return api.patch(`/prospects/${prospect.id}/profile`, {
        targetMonth: targetMonth.trim(),
        roomPreference,
        paxQuad: Number(paxQuad || 0),
        paxTriple: Number(paxTriple || 0),
        paxDouble: Number(paxDouble || 0),
        paxInfant: Number(paxInfant || 0),
        budgetRange: budgetRange.trim() || null,
        decisionMaker: decisionMaker.trim() || null,
        brandId,
      });
    },
    onSuccess: (res: any) => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospect.id] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (res?.data?.status === 'qualified') {
        onShowToast('Alhamdulillah! Kualifikasi lengkap & prospek otomatis naik ke tahap Terkualifikasi.');
      } else {
        onShowToast('Profil kualifikasi prospek berhasil diperbarui.');
      }
      onClose();
    },
    onError: (err: any) => {
      setErrorMsg(err?.message || 'Gagal menyimpan kualifikasi prospek.');
    },
  });

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetMonth.trim()) {
      setErrorMsg('Target bulan / waktu keberangkatan wajib diisi.');
      return;
    }
    if (!roomPreference) {
      setErrorMsg('Tipe kamar pilihan wajib dipilih.');
      return;
    }
    if (totalPax <= 0) {
      setErrorMsg('Perkiraan jumlah jamaah (pax) minimal 1 orang.');
      return;
    }
    setErrorMsg('');
    qualifyMutation.mutate();
  }

  function handleRoomSelect(val: string) {
    setRoomPreference(val);
    if (totalPax === 0) {
      if (val === 'Quad') setPaxQuad(1);
      else if (val === 'Triple') setPaxTriple(1);
      else if (val === 'Double') setPaxDouble(2);
    }
  }

  return (
    <ModalFrame open={open} onClose={onClose} title="Form kualifikasi prospek">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 bg-gradient-to-r from-emerald-50 to-white px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-white shadow-xs">
              <UserCheck size={18} />
            </span>
            <div>
              <h3 className="font-display text-sm font-bold text-zinc-900">
                Formulir Kualifikasi Prospek (NPGD)
              </h3>
              <p className="text-xs text-zinc-500">
                Untuk prospek: <strong className="text-zinc-800">{prospect.name}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 transition"
          >
            <X size={17} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {errorMsg && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              {errorMsg}
            </div>
          )}

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900 space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <Sparkles size={13} className="text-emerald-600" />
              <span>Kriteria Otomatis Naik ke Tahap Terkualifikasi:</span>
            </div>
            <p className="text-emerald-800 leading-relaxed">
              1. <strong>Target Keberangkatan</strong> terisi.<br />
              2. <strong>Tipe Kamar</strong> dipilih.<br />
              3. <strong>Jumlah Pax</strong> minimal 1 orang.
            </p>
          </div>

          {/* 1. Target Bulan */}
          <div>
            <label className="block text-xs font-bold uppercase text-zinc-600 mb-1">
              1. Target Bulan / Waktu Keberangkatan <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
              placeholder="Contoh: Ramadan 1448H / Oktober 2026"
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900"
            />
            {/* Quick Chips */}
            <div className="flex flex-wrap gap-1 mt-1.5">
              {COMMON_TARGET_MONTHS.slice(0, 5).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTargetMonth(m)}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium transition cursor-pointer ${
                    targetMonth === m
                      ? 'bg-emerald-600 text-white'
                      : 'border border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Pilihan Kamar */}
          <div>
            <label className="block text-xs font-bold uppercase text-zinc-600 mb-1">
              2. Pilihan Tipe Kamar Utama <span className="text-rose-500">*</span>
            </label>
            <Select
              value={roomPreference}
              onValueChange={handleRoomSelect}
              options={ROOM_OPTIONS}
              className="w-full text-xs"
            />
          </div>

          {/* 3. Jumlah Pax Counter */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold uppercase text-zinc-600">
                3. Perkiraan Jumlah Jamaah (Pax) <span className="text-rose-500">*</span>
              </label>
              <span className={`font-bold text-xs ${totalPax > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                Total: {totalPax} Pax {totalPax === 0 && '(Wajib minimal 1)'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: 'Quad', val: paxQuad, set: setPaxQuad, hint: 'Ber-4' },
                { label: 'Triple', val: paxTriple, set: setPaxTriple, hint: 'Ber-3' },
                { label: 'Double', val: paxDouble, set: setPaxDouble, hint: 'Ber-2' },
                { label: 'Infant', val: paxInfant, set: setPaxInfant, hint: '<2 thn' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-2">
                  <span className="block text-xs font-bold text-zinc-700">{item.label}</span>
                  <span className="block text-xs text-zinc-500 mb-1">{item.hint}</span>
                  <input
                    type="number"
                    min="0"
                    value={item.val}
                    onChange={(e) => item.set(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full text-center font-bold text-sm text-zinc-900 bg-white border border-zinc-200 rounded-lg py-1 outline-none focus:border-zinc-900"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 4. Optional Fields: Budget & Decision Maker */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-100">
            <div>
              <label className="block text-xs font-bold uppercase text-zinc-500 mb-1">
                Kisaran Budget (Opsional)
              </label>
              <input
                type="text"
                value={budgetRange}
                onChange={(e) => setBudgetRange(e.target.value)}
                placeholder="Misal: 30-35 juta"
                className="w-full rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-zinc-900"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-zinc-500 mb-1">
                Pengambil Keputusan (Opsional)
              </label>
              <input
                type="text"
                value={decisionMaker}
                onChange={(e) => setDecisionMaker(e.target.value)}
                placeholder="Misal: Suami / Istri / Sendiri"
                className="w-full rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-zinc-900"
              />
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="pt-3 border-t border-zinc-100 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={qualifyMutation.isPending}
              className="text-xs"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={qualifyMutation.isPending || totalPax === 0 || !targetMonth.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5"
            >
              <Sparkles size={14} />
              <span>{qualifyMutation.isPending ? 'Menyimpan...' : 'Simpan & Jadikan Terkualifikasi'}</span>
            </Button>
          </div>
        </form>
      </div>
    </ModalFrame>
  );
}

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, X } from 'lucide-react';
import { isWonStatus } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PrivateProofPreview } from './PrivateProof';
import { ModalFrame } from '../../components/ui/modal';

interface FinanceVerifyModalProps {
  open: boolean;
  onClose: () => void;
  prospect: any;
  brandId?: number;
  onShowToast: (msg: string) => void;
}

const rupiah = (val: unknown) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
    Number(val ?? 0)
  );

const BANK_OPTIONS = [
  { value: 'Bank Syariah Indonesia (BSI)', label: 'Bank Syariah Indonesia (BSI)' },
  { value: 'Bank Mandiri', label: 'Bank Mandiri' },
  { value: 'Bank Central Asia (BCA)', label: 'Bank Central Asia (BCA)' },
  { value: 'Bank BRI', label: 'Bank BRI' },
  { value: 'Bank BNI', label: 'Bank BNI' },
  { value: 'Kas / Tunai', label: 'Kas / Tunai Kantor' },
];

const todayWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function FinanceVerifyModal({
  open,
  onClose,
  prospect,
  brandId,
  onShowToast,
}: FinanceVerifyModalProps) {
  const alreadyWon = isWonStatus(prospect?.status);
  const bookingValue = Number(prospect?.dealValue ?? 0);
  const verifiedSoFar = Number(prospect?.dpAmount ?? 0);
  const remaining = Math.max(0, bookingValue - verifiedSoFar);

  const [approvedAmount, setApprovedAmount] = useState<number>(() => {
    const billed = Number(prospect?.invoiceAmount ?? 0);
    if (billed > 0 && billed <= (remaining || billed)) return billed;
    return remaining;
  });
  const [bankName, setBankName] = useState<string>('Bank Syariah Indonesia (BSI)');
  const [referenceNo, setReferenceNo] = useState('');
  const [mutationDate, setMutationDate] = useState<string>(todayWib);
  const [notes, setNotes] = useState<string>('');
  // Satu key per pembukaan form: klik ganda / retry jaringan tidak mencatat pembayaran dua kali.
  const [idempotencyKey] = useState(newKey);

  const verifyMutation = useMutation({
    mutationFn: () =>
      api.post<any>(`/prospects/${prospect.id}/verify-payment`, {
        approvedAmount: Number(approvedAmount),
        bankName,
        referenceNo: referenceNo.trim() || undefined,
        mutationDate,
        notes: notes.trim(),
        idempotencyKey,
        brandId: brandId ?? prospect.brandId,
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospect.id] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['verification-queue'] });
      if (data?.duplicate) {
        onShowToast('Mutasi ini sudah pernah dicatat; tidak ada pembayaran ganda.');
      } else if (alreadyWon) {
        onShowToast('Pembayaran lanjutan tercatat di ledger.');
      } else {
        onShowToast('Pembayaran diverifikasi. Prospek resmi DEAL dan kuota seat terpotong.');
      }
      onClose();
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Gagal memverifikasi pembayaran.');
    },
  });

  if (!open) return null;

  const totalAfter = verifiedSoFar + Number(approvedAmount || 0);
  const willBePaidFull = bookingValue > 0 && totalAfter >= bookingValue;

  return (
    <ModalFrame open={open} onClose={onClose} title="Verifikasi pembayaran Finance">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 bg-emerald-600 text-white">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/20 text-white">
              <ShieldCheck size={18} />
            </span>
            <div>
              <h3 className="font-bold text-sm">{alreadyWon ? 'Catat Pembayaran Lanjutan' : 'Verifikasi Finance (Deal Pembayaran)'}</h3>
              <p className="text-[11px] text-emerald-100">Validasi mutasi bank · satu mutasi = satu baris ledger</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="thin-scrollbar flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Customer & Package Summary */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 space-y-2">
            <div className="flex items-center justify-between font-bold text-zinc-900">
              <span>{prospect?.name || 'Jamaah'}</span>
              <span className="text-emerald-700">{prospect?.phone}</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Paket: {prospect?.package?.name || 'Paket Umroh'} · Invoice: {prospect?.invoiceNumber || '-'}
              {Number(prospect?.invoiceAmount) > 0 ? ` (${rupiah(prospect.invoiceAmount)})` : ''}
            </p>
            <div className="grid grid-cols-3 gap-2 border-t border-zinc-200 pt-2 text-[11px]">
              <div>
                <p className="text-zinc-500">Nilai booking</p>
                <p className="font-bold text-zinc-900">{bookingValue > 0 ? rupiah(bookingValue) : 'Belum ditetapkan'}</p>
              </div>
              <div>
                <p className="text-zinc-500">Sudah diverifikasi</p>
                <p className="font-bold text-emerald-700">{rupiah(verifiedSoFar)}</p>
              </div>
              <div>
                <p className="text-zinc-500">Sisa tagihan</p>
                <p className="font-bold text-zinc-900">{rupiah(remaining)}</p>
              </div>
            </div>
          </div>

          {/* Payment Proof Preview if uploaded */}
          {prospect?.paymentProofUrl && (
            <div className="space-y-1.5">
              <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
                Bukti Transfer yang Diunggah CS:
              </label>
              <div className="rounded-xl border border-zinc-200 overflow-hidden bg-zinc-100 min-h-24 flex items-center justify-center p-2">
                <PrivateProofPreview url={prospect.paymentProofUrl} />
              </div>
            </div>
          )}

          {/* Approved Amount */}
          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
              Nominal Mutasi Ini (Rp)
            </label>
            <input
              type="number"
              min="1000"
              value={approvedAmount}
              onChange={(e) => setApprovedAmount(Number(e.target.value))}
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs font-bold text-emerald-700 focus:border-emerald-500 focus:outline-none"
            />
            <span className="text-[10px] text-zinc-400">
              {rupiah(approvedAmount)} · total kas setelah verifikasi {rupiah(totalAfter)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Bank Selection */}
            <div className="space-y-1.5">
              <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
                Bank Tujuan Mutasi
              </label>
              <Select
                value={bankName}
                onValueChange={setBankName}
                options={BANK_OPTIONS}
                className="w-full"
              />
            </div>

            {/* Mutation Date */}
            <div className="space-y-1.5">
              <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
                Tanggal Mutasi
              </label>
              <input
                type="date"
                value={mutationDate}
                onChange={(e) => setMutationDate(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Reference number */}
          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
              No. Referensi Mutasi (disarankan)
            </label>
            <input
              type="text"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              placeholder="Contoh: FT2609231015XYZ"
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs font-mono focus:border-emerald-500 focus:outline-none"
            />
            <span className="text-[10px] text-zinc-400">Nomor unik per brand; mencegah satu mutasi dipakai dua booking.</span>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
              Catatan Validasi Finance (Opsional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Mutasi klir di BSI jam 10:15 WIB a/n pengirim..."
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-[11px] text-emerald-900 leading-relaxed">
            🎯 <strong>Dampak Verifikasi:</strong>
            <ul className="list-disc list-inside mt-1 space-y-0.5 text-[10px]">
              {!alreadyWon && <li>Status prospek berubah menjadi <strong>DEAL</strong> dan kuota seat paket dipotong</li>}
              <li>Mutasi dicatat di ledger pembayaran; kas terverifikasi menjadi <strong>{rupiah(totalAfter)}</strong></li>
              <li>Status pembayaran menjadi <strong>{willBePaidFull ? 'Lunas (paid_full)' : 'DP sebagian (partial_dp)'}</strong></li>
              {!alreadyWon && <li>Event CAPI <strong>Purchase</strong> senilai total booking dikirim ke Meta Ads</li>}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3.5 bg-zinc-50">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={verifyMutation.isPending}>
            Batal
          </Button>
          <Button
            size="sm"
            onClick={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending || !approvedAmount || approvedAmount <= 0 || !mutationDate}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
          >
            <CheckCircle2 size={14} />
            {verifyMutation.isPending ? 'Memvalidasi...' : alreadyWon ? 'Catat Pembayaran' : 'Verifikasi & Kunci Deal'}
          </Button>
        </div>
      </div>
    </ModalFrame>
  );
}

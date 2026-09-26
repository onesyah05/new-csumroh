import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { businessDateKey } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { ConfirmDialog, Modal } from '../../components/ui/modal';
import { MoneyInput } from '../custom/MoneyInput';
import { BANK_OPTIONS } from '../chat/FinanceVerifyModal';
import { rupiah, type HistoryRow } from './verificationApi';

const refresh = (prospectId: number) => {
  void queryClient.invalidateQueries({ queryKey: ['verification-history'] });
  void queryClient.invalidateQueries({ queryKey: ['verification-summary'] });
  void queryClient.invalidateQueries({ queryKey: ['verification-queue'] });
  void queryClient.invalidateQueries({ queryKey: ['prospect', prospectId] });
  void queryClient.invalidateQueries({ queryKey: ['prospects'] });
};

/** Superadmin: koreksi salah ketik pada pembayaran terverifikasi. Nilai lama → baru tercatat di Riwayat prospek. */
export function CorrectPaymentDialog({ row, onDone, onClose }: { row: HistoryRow; onDone(message: string): void; onClose(): void }) {
  const [amount, setAmount] = useState<number | null>(row.amount);
  const [bankName, setBankName] = useState(row.bankName ?? BANK_OPTIONS[0]!.value);
  const [referenceNo, setReferenceNo] = useState(row.referenceNo ?? '');
  const [mutationDate, setMutationDate] = useState(row.mutationDate ? row.mutationDate.slice(0, 10) : '');
  const [reason, setReason] = useState('');
  const today = businessDateKey();
  const correct = useMutation({
    mutationFn: () => api.patch(`/verification/payments/${row.id}`, { amount, bankName, referenceNo: referenceNo.trim(), mutationDate, reason: reason.trim() }),
    onSuccess: () => { refresh(row.prospect.id); onDone(`Pembayaran ${row.prospect.name} dikoreksi.`); },
  });
  const bankOptions = BANK_OPTIONS.some((b) => b.value === bankName) ? BANK_OPTIONS : [{ value: bankName, label: bankName }, ...BANK_OPTIONS];
  const valid = Boolean(amount && amount > 0) && reason.trim().length >= 3 && (!mutationDate || mutationDate <= today);

  return (
    <Modal
      open
      onClose={onClose}
      title="Koreksi data pembayaran"
      description={<>Untuk salah ketik pada pembayaran <strong>{row.prospect.name}</strong>. Status Deal tidak berubah; nilai lama tercatat di riwayat prospek.</>}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button onClick={() => correct.mutate()} disabled={!valid || correct.isPending} loading={correct.isPending}>Simpan koreksi</Button>
      </>}
    >
      <div className="space-y-3 text-xs">
        <div className="panel-field"><span>Nominal diterima</span>
          <MoneyInput aria-label="Nominal diterima" value={amount} onChange={setAmount} />
          {row.amount !== null && amount !== row.amount && <span className="text-xs font-normal text-zinc-500">Semula {rupiah(row.amount)}</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="panel-field">Bank tujuan mutasi
            <Select aria-label="Bank tujuan mutasi" value={bankName} onValueChange={setBankName} options={bankOptions} />
          </label>
          <label className="panel-field">Tanggal mutasi
            <input type="date" max={today} value={mutationDate} onChange={(e) => setMutationDate(e.target.value)} className="field" />
          </label>
        </div>
        <label className="panel-field">No. referensi mutasi
          <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className="field font-mono" />
        </label>
        <label className="panel-field">Alasan koreksi
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contoh: salah ketik nominal (kurang satu nol)" className="field" />
        </label>
        {correct.error && <p role="alert" className="text-rose-700">{correct.error.message}</p>}
      </div>
    </Modal>
  );
}

/** Superadmin: batalkan verifikasi yang keliru. Deal kembali ke Closing, kuota dikembalikan, CS meminta bukti baru. */
export function ReversePaymentDialog({ row, onDone, onClose }: { row: HistoryRow; onDone(message: string): void; onClose(): void }) {
  const [reason, setReason] = useState('');
  const reverse = useMutation({
    mutationFn: () => api.post(`/verification/payments/${row.id}/reverse`, { reason: reason.trim() }),
    onSuccess: () => { refresh(row.prospect.id); onDone(`Verifikasi ${row.prospect.name} dibatalkan. Prospek kembali ke Closing.`); },
  });
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => reverse.mutate()}
      pending={reverse.isPending}
      confirmDisabled={reason.trim().length < 3}
      error={reverse.error?.message}
      title="Batalkan verifikasi pembayaran?"
      confirmLabel="Batalkan verifikasi"
      description={<>Pembayaran <strong>{rupiah(row.amount)}</strong> dari <strong>{row.prospect.name}</strong> ditandai dibatalkan.</>}
    >
      <ul className="mb-3 list-disc space-y-0.5 pl-4 text-xs text-zinc-700">
        <li>Status prospek kembali ke <strong>Closing</strong> dan kuota seat dikembalikan.</li>
        <li>Bukti dilepas; CS perlu meminta bukti yang benar.</li>
        <li>Event Purchase yang sudah terkirim ke Meta tidak ditarik.</li>
      </ul>
      <label className="panel-field text-xs">Alasan pembatalan
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="field" placeholder="Contoh: mutasi tidak ditemukan di rekening koran" />
      </label>
    </ConfirmDialog>
  );
}

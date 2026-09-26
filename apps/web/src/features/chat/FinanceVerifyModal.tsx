import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { businessDateKey, customMinDpTotal, isWonStatus, seatCountFor } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { ConfirmDialog, Modal } from '../../components/ui/modal';
import { MoneyInput } from '../custom/MoneyInput';
import { useProspectCustom } from '../custom/customApi';
import { PrivateProofPreview } from './PrivateProof';

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

export const BANK_OPTIONS = [
  { value: 'Bank Syariah Indonesia (BSI)', label: 'Bank Syariah Indonesia (BSI)' },
  { value: 'Bank Mandiri', label: 'Bank Mandiri' },
  { value: 'Bank Central Asia (BCA)', label: 'Bank Central Asia (BCA)' },
  { value: 'Bank BRI', label: 'Bank BRI' },
  { value: 'Bank BNI', label: 'Bank BNI' },
  { value: 'Kas / Tunai', label: 'Kas / Tunai Kantor' },
];

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-zinc-950">{value}</dd>
      {note && <dd className="text-xs text-zinc-500">{note}</dd>}
    </div>
  );
}

/**
 * Finance mencocokkan bukti transfer dengan mutasi bank lalu menetapkan Deal. Patokan (tagihan, nilai deal,
 * DP minimal layanan custom, jumlah jamaah) ditampilkan di atas agar selisih nominal langsung terlihat.
 */
export function FinanceVerifyModal({
  open,
  onClose,
  prospect,
  brandId,
  onShowToast,
}: FinanceVerifyModalProps) {
  const alreadyWon = isWonStatus(prospect?.status);
  const invoiceAmount = Number(prospect?.invoiceAmount ?? 0);
  const [paymentType, setPaymentType] = useState<'dp' | 'full'>('dp');
  const [approvedAmount, setApprovedAmount] = useState<number | null>(() => invoiceAmount || null);
  const [bankName, setBankName] = useState<string>('Bank Syariah Indonesia (BSI)');
  const [referenceNo, setReferenceNo] = useState('');
  const [mutationDate, setMutationDate] = useState<string>(() => businessDateKey());
  const [notes, setNotes] = useState<string>('');
  const [confirmFull, setConfirmFull] = useState(false);
  // Satu key per pembukaan form: klik ganda / retry jaringan tidak mencatat pembayaran dua kali.
  const [idempotencyKey] = useState(newKey);

  // Antrean Finance sudah membawa patokan custom; dari Inbox/Pipeline diambil langsung.
  const fromQueue = prospect?.customMinDp !== undefined;
  const customQuery = useProspectCustom(fromQueue || !open ? 0 : Number(prospect?.id), brandId ?? prospect?.brandId);
  const custom = customQuery.data?.status === 'agreed' ? customQuery.data : null;
  const minDp: number | null = fromQueue ? prospect.customMinDp : custom ? customMinDpTotal(custom) : null;
  const dealValue = Number((fromQueue ? prospect.customAgreedPrice : custom?.agreedPrice) ?? prospect?.dealValue ?? 0);
  const adults = (prospect?.paxQuad ?? 0) + (prospect?.paxTriple ?? 0) + (prospect?.paxDouble ?? 0);
  const infants = prospect?.paxInfant ?? 0;

  const amount = approvedAmount ?? 0;
  const today = businessDateKey();
  const belowMinDp = minDp !== null && amount > 0 && amount < minDp;
  const differsFromInvoice = invoiceAmount > 0 && amount > 0 && amount !== invoiceAmount;
  const fullBelowDeal = paymentType === 'full' && dealValue > 0 && amount > 0 && amount < dealValue;
  const futureDate = Boolean(mutationDate) && mutationDate > today;

  const verifyMutation = useMutation({
    mutationFn: () =>
      api.post<any>(`/prospects/${prospect.id}/verify-payment`, {
        approvedAmount: amount,
        paymentType,
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
      void queryClient.invalidateQueries({ queryKey: ['verification-history'] });
      void queryClient.invalidateQueries({ queryKey: ['verification-summary'] });
      if (data?.duplicate) {
        onShowToast('Mutasi ini sudah pernah dicatat; tidak ada pembayaran ganda.');
      } else {
        onShowToast('Pembayaran diverifikasi. Prospek resmi DEAL dan kuota seat terpotong.');
      }
      onClose();
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Gagal memverifikasi pembayaran.');
    },
  });

  if (!open || alreadyWon) return null;

  const canSubmit = amount > 0 && Boolean(mutationDate) && !futureDate && !belowMinDp && !verifyMutation.isPending;
  const submit = () => (fullBelowDeal ? setConfirmFull(true) : verifyMutation.mutate());
  const fromChat = Boolean(prospect?.paymentProofMessageId);

  return (
    <>
      <Modal
        open={open && !confirmFull}
        onClose={onClose}
        size="lg"
        title="Verifikasi pembayaran awal"
        description={<>Cocokkan bukti dengan mutasi bank. Setelah diverifikasi, <strong>{prospect?.name || 'jamaah'}</strong> resmi Deal.</>}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={verifyMutation.isPending}>Batal</Button>
            <Button onClick={submit} disabled={!canSubmit} loading={verifyMutation.isPending} icon={<CheckCircle2 size={14} />}>
              Verifikasi & tetapkan Deal
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <section aria-label="Patokan pengecekan" className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <p className="mb-2 truncate text-xs text-zinc-600">
              {prospect?.phone ? `${prospect.phone} · ` : ''}{prospect?.package?.name ?? (custom || minDp !== null ? 'Layanan custom' : 'Paket belum dipilih')} · {prospect?.invoiceNumber || 'Tanpa nomor invoice'}
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="Tagihan invoice" value={invoiceAmount > 0 ? rupiah(invoiceAmount) : '—'} />
              <Fact label="Nilai deal" value={dealValue > 0 ? rupiah(dealValue) : '—'} />
              <Fact label="DP minimal" value={minDp !== null ? rupiah(minDp) : '—'} note={minDp !== null ? 'Layanan custom' : undefined} />
              <Fact label="Jamaah" value={`${adults} dewasa${infants ? ` + ${infants} bayi` : ''}`} note={`${seatCountFor(prospect ?? {})} seat dipotong`} />
            </dl>
          </section>

          {prospect?.paymentProofUrl && (
            <div className="space-y-1.5">
              <p className="font-semibold text-zinc-700">{fromChat ? 'Bukti dari chat WhatsApp' : 'Bukti diunggah CS'}</p>
              <div className="flex min-h-24 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 p-2">
                <PrivateProofPreview url={prospect.paymentProofUrl} />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="panel-field">Jenis pembayaran awal
              <Select aria-label="Jenis pembayaran awal" value={paymentType} onValueChange={value => setPaymentType(value as 'dp' | 'full')} options={[{ value: 'dp', label: 'DP' }, { value: 'full', label: 'Lunas (pembayaran awal)' }]} />
            </label>
            <div className="panel-field">
              <span>Nominal diterima</span>
              <MoneyInput aria-label="Nominal diterima" value={approvedAmount} onChange={setApprovedAmount} invalid={belowMinDp} />
            </div>
          </div>
          {belowMinDp && (
            <p role="alert" className="flex gap-1.5 text-rose-700"><AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
              Di bawah DP minimal layanan custom ({rupiah(minDp)}). Tolak bukti bila transfer memang kurang.</p>
          )}
          {!belowMinDp && differsFromInvoice && (
            <p className="flex gap-1.5 text-amber-800"><AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
              {amount > invoiceAmount ? 'Lebih' : 'Kurang'} {rupiah(Math.abs(amount - invoiceAmount))} dari tagihan invoice. Pastikan sesuai mutasi.</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="panel-field">Bank tujuan mutasi
              <Select aria-label="Bank tujuan mutasi" value={bankName} onValueChange={setBankName} options={BANK_OPTIONS} className="w-full" />
            </label>
            <label className="panel-field">Tanggal mutasi
              <input type="date" max={today} value={mutationDate} onChange={(e) => setMutationDate(e.target.value)} className="field" aria-invalid={futureDate || undefined} />
              {futureDate && <span role="alert" className="text-xs text-rose-700">Tanggal mutasi tidak boleh di masa depan.</span>}
            </label>
          </div>

          <label className="panel-field">No. referensi mutasi (disarankan)
            <input type="text" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="Contoh: FT2609231015XYZ" className="field font-mono" />
            <span className="text-xs font-normal text-zinc-500">Unik per brand; mencegah satu mutasi dipakai dua booking.</span>
          </label>

          <label className="panel-field">Catatan validasi (opsional)
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contoh: mutasi masuk BSI 10:15 WIB a/n pengirim" className="field" />
          </label>

          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900">
            Setelah diverifikasi: status menjadi <strong>Deal</strong>, kuota seat paket dipotong, dan event Purchase dikirim ke Meta Ads.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmFull}
        onClose={() => setConfirmFull(false)}
        tone="primary"
        pending={verifyMutation.isPending}
        onConfirm={() => verifyMutation.mutate()}
        title="Lunas, tetapi di bawah nilai deal?"
        confirmLabel="Ya, catat lunas"
        description={`Nominal ${rupiah(amount)} kurang ${rupiah(dealValue - amount)} dari nilai deal ${rupiah(dealValue)}. Pilih DP bila jamaah belum melunasi.`}
      />
    </>
  );
}

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CreditCard, Sparkles, AlertCircle, Copy, X } from 'lucide-react';
import { isWonStatus } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { deliverDraftText } from './draftText';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { ModalFrame } from '../../components/ui/modal';

interface OfficialInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  prospect: any;
  packages: any[];
  brandId?: number;
  onInsertText?: (text: string) => void;
  onShowToast: (msg: string) => void;
}

const rupiah = (val: unknown) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
    Number(val ?? 0)
  );

export function OfficialInvoiceModal({
  open,
  onClose,
  prospect,
  packages,
  brandId,
  onInsertText,
  onShowToast,
}: OfficialInvoiceModalProps) {
  const effectiveBrandId = brandId || prospect?.brandId;

  const brandQuery = useQuery({
    queryKey: ['brand', effectiveBrandId],
    queryFn: () => api.get<any>(`/catalog/brands/${effectiveBrandId}`),
    enabled: !!effectiveBrandId,
  });
  const currentBrand = brandQuery.data;

  const totalPax =
    Number(prospect?.paxQuad ?? 0) +
      Number(prospect?.paxTriple ?? 0) +
      Number(prospect?.paxDouble ?? 0) +
      Number(prospect?.paxInfant ?? 0) || 1;

  const [selectedPkgId, setSelectedPkgId] = useState<string>(
    prospect?.packageId ? String(prospect.packageId) : packages[0]?.id ? String(packages[0].id) : ''
  );

  const selectedPackage = useMemo(() => {
    return packages.find((p) => String(p.id) === selectedPkgId) || packages[0];
  }, [packages, selectedPkgId]);

  const packageDp = Number(String(selectedPackage?.dp || 0).replace(/\D/g, ''));
  // Booking yang sudah Deal menerima tagihan pelunasan (sisa nilai booking), bukan DP baru.
  const isSettlement = isWonStatus(prospect?.status);
  const remaining = Math.max(0, Number(prospect?.dealValue ?? 0) - Number(prospect?.dpAmount ?? 0));
  // Tanpa DP resmi di katalog, nominal wajib diisi manual (tidak ada angka karangan).
  const defaultAmount = isSettlement ? remaining : packageDp > 0 ? packageDp * totalPax : 0;

  const [dpAmount, setDpAmount] = useState<number>(
    Number(prospect?.invoiceAmount) > 0 && !isSettlement ? Number(prospect.invoiceAmount) : defaultAmount
  );

  // Default jatuh tempo 24 jam dari sekarang dalam waktu lokal (format datetime-local, bukan UTC).
  const [dueDate, setDueDate] = useState<string>(() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  const selectedBank = useMemo(() => {
    return {
      id: 'brand-official',
      name: currentBrand?.bankName || 'Bank Rekening Resmi Biro',
      number: currentBrand?.bankAccountNumber || '-',
      holder: currentBrand?.bankAccountHolder || currentBrand?.name || 'Rekening Resmi Biro',
    };
  }, [currentBrand]);

  const hasConfiguredBank = Boolean(currentBrand?.bankName && currentBrand?.bankAccountNumber && currentBrand.bankAccountNumber !== '-');

  const formattedDueDate = useMemo(() => {
    try {
      const d = new Date(dueDate);
      return d.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta',
      }) + ' WIB';
    } catch {
      return dueDate;
    }
  }, [dueDate]);

  const now = new Date();
  const estimatedInvoiceNum = prospect?.invoiceNumber || `INV/${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}/${String(prospect?.id || 1).padStart(4, '0')}`;

  const generatedScript = useMemo(() => {
    return [
      isSettlement ? `*🧾 INVOICE RESMI PELUNASAN BIAYA UMROH*` : `*🧾 INVOICE RESMI PEMBAYARAN DOWN PAYMENT (DP) UMROH*`,
      `No. Dokumen: *${estimatedInvoiceNum}*`,
      isSettlement ? `Status Tagihan: *Menunggu Pelunasan*` : `Status Tagihan: *Menunggu Pembayaran DP*`,
      '',
      `Kepada Yth. Calon Jamaah:`,
      `👤 *${prospect?.name || 'Jamaah'}*`,
      prospect?.phone ? `📱 ${prospect.phone}` : null,
      '',
      `🕋 *Rincian Pemesanan Paket*:`,
      `• Paket: *${selectedPackage?.name || 'Paket Umroh Reguler'}*`,
      `• Jumlah Jamaah: *${totalPax} Pax*`,
      selectedPackage?.departureInfo ? `• Jadwal Rencana: ${selectedPackage.departureInfo}` : null,
      '',
      isSettlement ? `💳 *JUMLAH TAGIHAN PELUNASAN*:` : `💳 *JUMLAH TAGIHAN DP*:`,
      `👉 *${rupiah(dpAmount)}*`,
      `⏰ *Batas Waktu Pembayaran (Due Date)*:`,
      `*${formattedDueDate}*`,
      '',
      `🏛️ *Rekening Resmi Biro (Wajib Transfer ke Rekening Resmi Ini)*:`,
      `• Bank: *${selectedBank.name}*`,
      `• No. Rekening: *${selectedBank.number}*`,
      `• Atas Nama: *${selectedBank.holder}*`,
      '',
      `⚠️ *PENTING - Konfirmasi Pembayaran*:`,
      `1. Cantumkan berita transfer: *${isSettlement ? 'PELUNASAN' : 'DP'} UMROH ${prospect?.name || 'JAMAAH'}*`,
      `2. Setelah transfer, mohon kirimkan foto/tangkapan layar struk bukti transfer ke nomor WhatsApp resmi ini.`,
      `3. Tim Finance kami akan segera mencocokkan mutasi rekening dan menerbitkan *Kuitansi Resmi & Booking Confirmation Seat*.`,
      '',
      `Jazakumullah khairan katsiran atas kepercayaannya. Semoga niat suci menuju Baitullah dimudahkan oleh Allah SWT. 🤲`,
    ]
      .filter(Boolean)
      .join('\n');
  }, [
    estimatedInvoiceNum,
    isSettlement,
    prospect?.name,
    prospect?.phone,
    selectedPackage?.name,
    selectedPackage?.departureInfo,
    totalPax,
    dpAmount,
    formattedDueDate,
    selectedBank,
  ]);

  const invoiceMutation = useMutation({
    mutationFn: (sendViaWhatsApp: boolean) =>
      api.post(`/prospects/${prospect.id}/invoice`, {
        packageId: selectedPkgId && !isSettlement ? Number(selectedPkgId) : undefined,
        // Nominal TAGIHAN; kas hanya bertambah lewat verifikasi Finance.
        invoiceAmount: Number(dpAmount),
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        bankAccountName: `${selectedBank.name} - ${selectedBank.number} a/n ${selectedBank.holder}`,
        brandId: brandId ?? prospect.brandId,
        sendViaWhatsApp,
        ...(sendViaWhatsApp ? { messageText: generatedScript } : {}),
      }),
    onSuccess: async (_, sendViaWhatsApp) => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospect.id] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (sendViaWhatsApp) {
        onShowToast(isSettlement
          ? 'Invoice pelunasan terkirim ke WhatsApp jamaah.'
          : 'Invoice DP terkirim ke WhatsApp jamaah; status beralih ke Closing.');
      } else {
        const where = await deliverDraftText(generatedScript, onInsertText);
        onShowToast(`Draft invoice ${where}; tidak dikirim dan status tidak berubah.`);
      }
      onClose();
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Gagal memproses invoice DP.');
    },
  });

  if (!open) return null;

  return (
    <ModalFrame open={open} onClose={onClose} title="Invoice resmi">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 bg-blue-50/70">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-600 text-white">
              <CreditCard size={18} />
            </span>
            <div>
              <h3 className="font-bold text-sm text-zinc-900">
                {isSettlement ? 'Invoice Pelunasan Resmi' : 'Terbitkan Invoice DP Resmi'}
              </h3>
              <p className="text-[11px] text-zinc-500">
                {isSettlement ? 'Status Deal tidak berubah; kas bertambah setelah verifikasi Finance' : 'Status menjadi Closing setelah invoice terkirim'}
              </p>
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
        <div className="thin-scrollbar flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Package Selection */}
          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
              Paket Umroh yang Dipesan
            </label>
            <Select
              value={selectedPkgId}
              onValueChange={setSelectedPkgId}
              options={packages.map((pkg) => ({
                value: String(pkg.id),
                label: `${pkg.name} (${pkg.departureInfo || 'Tgl belum ditentukan'})`,
              }))}
              className="w-full"
            />
          </div>

          {/* Amount & Due Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
                {isSettlement ? 'Nominal Tagihan Pelunasan (Rp)' : 'Nominal Tagihan DP (Rp)'}
              </label>
              <input
                type="number"
                min="500000"
                step="500000"
                value={dpAmount}
                onChange={(e) => setDpAmount(Number(e.target.value))}
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs font-bold text-blue-700 focus:border-blue-500 focus:outline-none"
              />
              <span className="text-[10px] text-zinc-400">{rupiah(dpAmount)}</span>
            </div>

            <div className="space-y-1.5">
              <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
                Jatuh Tempo Pembayaran
              </label>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-700 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Official Bank Account */}
          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">
              Rekening Bank Resmi Brand ({currentBrand?.name || 'Brand'})
            </label>
            {hasConfiguredBank ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 text-xs">
                <div className="font-bold text-blue-900">{selectedBank.name}</div>
                <div className="font-mono text-sm text-blue-700 font-bold tracking-wide">{selectedBank.number}</div>
                <div className="text-[11px] text-zinc-500">a/n {selectedBank.holder}</div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
                <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Rekening bank belum diatur untuk brand ini!</span>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    Harap lengkapi nomor rekening resmi di menu Pengaturan Brand agar transaksi jamaah aman dan valid.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* WhatsApp Script Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold uppercase tracking-wider text-[10px] text-zinc-500 flex items-center gap-1">
                <Sparkles size={12} className="text-amber-500" />
                Pratinjau Pesan Invoice WhatsApp
              </label>
              <span className="text-[10px] text-zinc-400">Naskah yang dikirim ke WhatsApp jamaah</span>
            </div>
            <textarea
              readOnly
              value={generatedScript}
              rows={8}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 font-mono text-[11px] text-zinc-700 leading-relaxed resize-none focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3.5 bg-zinc-50">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={invoiceMutation.isPending}>
            Batal
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => invoiceMutation.mutate(false)}
              disabled={invoiceMutation.isPending || !dpAmount || dpAmount <= 0 || !hasConfiguredBank}
              className="gap-1 text-zinc-700"
              title="Simpan sebagai draft (sisipkan ke chat / salin) tanpa mengirim dan tanpa mengubah status"
            >
              <Copy size={13} />
              <span>Sisipkan Draft Saja</span>
            </Button>
            <Button
              size="sm"
              onClick={() => invoiceMutation.mutate(true)}
              disabled={invoiceMutation.isPending || !dpAmount || dpAmount <= 0 || !hasConfiguredBank}
              className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold"
            >
              <CreditCard size={14} />
              {invoiceMutation.isPending ? 'Mengirim...' : 'Kirim Invoice via WhatsApp'}
            </Button>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}

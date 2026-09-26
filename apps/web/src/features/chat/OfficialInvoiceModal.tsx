import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Copy, CreditCard } from 'lucide-react';
import { formatRupiah, isWonStatus, packageBookingValue, parseRupiahStrict, PAYMENT_CATEGORY_LABEL, paymentCategory } from '@csumroh/shared-types';
import { waDate, waDateTime, waMessage, waTitle } from './waFormat';
import { api } from '../../lib/api';
import { deliverDraftText } from './draftText';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { Modal } from '../../components/ui/modal';
import { dateRange, minDpTotal, type CustomRequest } from '../custom/customApi';
import { MoneyInput } from '../custom/MoneyInput';

interface OfficialInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  prospect: any;
  packages: any[];
  brandId?: number;
  onInsertText?: (text: string) => void;
  onShowToast: (msg: string) => void;
  /** Layanan custom yang disepakati: tagihan antara DP minimal (per jamaah) dan nilai deal akhir. */
  custom?: CustomRequest | null;
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
  custom,
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

  // Parser ketat: "5 juta" = 5.000.000, bukan 5 (audit S02).
  const packageDp = parseRupiahStrict(selectedPackage?.dp) ?? 0;
  // Tanpa DP resmi di katalog, nominal wajib diisi manual (tidak ada angka karangan).
  const customMin = custom ? minDpTotal(custom) : 0;
  const customMax = custom ? Number(custom.agreedPrice ?? 0) : 0;
  const defaultAmount = custom ? customMin : packageDp > 0 ? packageDp * totalPax : 0;

  const [dpAmount, setDpAmount] = useState<number>(
    Number(prospect?.invoiceAmount) > 0 ? Number(prospect.invoiceAmount) : defaultAmount
  );
  // Kategori invoice (judul pesan): Lunas bila nominal menutup nilai deal, selain itu DP.
  const invoiceDealValue = custom ? customMax
    : Number(prospect?.dealValue) > 0 ? Number(prospect.dealValue)
      : selectedPackage ? packageBookingValue(selectedPackage, prospect ?? {}) : 0;
  const invoiceCategory = paymentCategory(Number(dpAmount) || 0, invoiceDealValue);

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

  // Urutan invoice untuk layar ponsel (audit C03): identitas → paket → nominal & batas → rekening → bukti & verifikasi.
  const generatedScript = useMemo(() => {
    const departure = selectedPackage ? waDate(selectedPackage.departureDate) ?? (selectedPackage.departureInfo || null) : null;
    return waMessage(
      [`*Invoice pembayaran ${PAYMENT_CATEGORY_LABEL[invoiceCategory]}*`, `No. ${estimatedInvoiceNum}`],
      [`Paket: ${custom ? (custom.mode === 'package' && custom.basePackage ? `${waTitle(custom.basePackage.name)} (disesuaikan)` : 'Umroh custom') : waTitle(selectedPackage?.name)}`, custom ? (custom.mode === 'package' ? waDate(custom.departureDate) && `Berangkat: ${waDate(custom.departureDate)}` : dateRange(custom.departureDate, custom.departureDateTo) && `Berangkat: ${dateRange(custom.departureDate, custom.departureDateTo)}`) : departure && `Berangkat: ${departure}`, `Jumlah: ${totalPax} jamaah`, custom && `Total biaya: ${formatRupiah(customMax)}`],
      [`Nominal: *${formatRupiah(dpAmount || 0)}*`, `Batas pembayaran: ${waDateTime(dueDate) ?? formattedDueDate}`],
      ['Transfer ke rekening resmi:', `${selectedBank.name} a/n ${selectedBank.holder}`, `*${selectedBank.number}*`],
      'Setelah transfer, kirim foto bukti transfernya di chat ini. Tim Finance akan memverifikasi, lalu pendaftaran tercatat.',
    );
  }, [custom, customMax, estimatedInvoiceNum, selectedPackage, totalPax, dpAmount, dueDate, formattedDueDate, selectedBank, invoiceCategory]);

  const invoiceMutation = useMutation({
    mutationFn: (sendViaWhatsApp: boolean) =>
      api.post(`/prospects/${prospect.id}/invoice`, {
        packageId: !custom && selectedPkgId ? Number(selectedPkgId) : undefined,
        // Invoice pembayaran (DP/lunas) sebelum Deal.
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
        onShowToast('Invoice terkirim');
      } else {
        const where = await deliverDraftText(generatedScript, onInsertText);
        onShowToast(`Invoice ${where}`);
      }
      onClose();
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Invoice gagal diproses.');
    },
  });

  if (!open || isWonStatus(prospect?.status)) return null;
  const pending = invoiceMutation.isPending;
  // Layanan custom: tagihan antara DP minimal dan nilai deal (server menolak di luar rentang ini).
  const outOfRange = Boolean(custom) && (dpAmount < customMin || dpAmount > customMax);
  const invalid = !dpAmount || dpAmount <= 0 || !hasConfiguredBank || outOfRange;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Kirim invoice pembayaran"
      description={prospect?.name}
      footer={
        <>
          <Button variant="outline" size="sm" icon={<Copy size={13} />} onClick={() => invoiceMutation.mutate(false)} disabled={pending || invalid}>
            Sisipkan ke chat
          </Button>
          <Button size="sm" icon={<CreditCard size={14} />} loading={pending} onClick={() => invoiceMutation.mutate(true)} disabled={pending || invalid}>
            Kirim ke WhatsApp
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {custom ? (
          <p className="text-xs text-zinc-600"><b className="font-semibold text-zinc-900">Layanan custom</b> · nilai deal {rupiah(customMax)}</p>
        ) : <div>
          <span className="mb-1 block text-xs font-semibold text-zinc-600">Paket</span>
          <Select
            aria-label="Paket"
            value={selectedPkgId}
            onValueChange={setSelectedPkgId}
            options={packages.map((pkg) => ({ value: String(pkg.id), label: `${pkg.name}${pkg.departureInfo ? ` (${pkg.departureInfo})` : ''}` }))}
            className="w-full"
          />
        </div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-zinc-600">Nominal</span>
            <MoneyInput aria-label="Nominal tagihan" value={dpAmount || null} onChange={(value) => setDpAmount(value ?? 0)} />
            <span className={custom && outOfRange ? 'mt-1 block text-xs font-semibold text-rose-700' : 'mt-1 block text-xs text-zinc-500'}>
              {rupiah(dpAmount)} · {PAYMENT_CATEGORY_LABEL[invoiceCategory]}{custom ? ` · DP minimal ${rupiah(customMin)}, maksimal ${rupiah(customMax)} (lunas)` : ''}
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-zinc-600">Jatuh tempo</span>
            <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="field" />
          </label>
        </div>
        <div className="text-xs">
          <span className="mb-1 block text-xs font-semibold text-zinc-600">Rekening tujuan</span>
          {hasConfiguredBank ? (
            <p className="text-zinc-800"><b className="font-semibold">{selectedBank.name} {selectedBank.number}</b> · a/n {selectedBank.holder}</p>
          ) : (
            <p role="alert" className="text-amber-800">Rekening {currentBrand?.name || 'brand'} belum diatur. Hubungi admin.</p>
          )}
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-zinc-600">Pesan yang dikirim</span>
          <textarea readOnly value={generatedScript} rows={8} className="field h-auto resize-none py-2 leading-relaxed" />
        </label>
      </div>
    </Modal>
  );
}

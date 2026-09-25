import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy, FileCheck } from 'lucide-react';
import { formatCatalogRupiah, formatRupiah, packageBookingValue } from '@csumroh/shared-types';
import { waBullets, waDate, waLine, waMessage, waTitle } from './waFormat';
import { api } from '../../lib/api';
import { deliverDraftText } from './draftText';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { Modal } from '../../components/ui/modal';
import { formatCustomOffer, type CustomRequest } from '../custom/customApi';

interface OfficialOfferModalProps {
  open: boolean;
  onClose: () => void;
  prospect: any;
  packages: any[];
  brandId?: number;
  onInsertText?: (text: string) => void;
  onShowToast: (msg: string) => void;
  /** Layanan custom yang sudah disepakati: nilai penawaran = nilai deal akhir, tanpa pilihan paket. */
  custom?: CustomRequest | null;
}


export function OfficialOfferModal({
  open,
  onClose,
  prospect,
  packages,
  brandId,
  onInsertText,
  onShowToast,
  custom,
}: OfficialOfferModalProps) {
  const [selectedPkgId, setSelectedPkgId] = useState<string>(
    prospect?.packageId ? String(prospect.packageId) : packages[0]?.id ? String(packages[0].id) : ''
  );
  const [customNote, setCustomNote] = useState('');

  const selectedPackage = useMemo(() => {
    return packages.find((p) => String(p.id) === selectedPkgId) || packages[0];
  }, [packages, selectedPkgId]);

  const totalPax =
    (Number(prospect?.paxQuad ?? 0)) +
    (Number(prospect?.paxTriple ?? 0)) +
    (Number(prospect?.paxDouble ?? 0)) +
    (Number(prospect?.paxInfant ?? 0)) || 1;

  // Sama dengan perhitungan backend (harga katalog × pax); backend tetap menjadi sumber kebenaran.
  const dealValue = useMemo(
    () => (custom ? Number(custom.agreedPrice ?? 0) : selectedPackage && prospect ? packageBookingValue(selectedPackage, prospect) : 0),
    [custom, selectedPackage, prospect],
  );

  // Naskah WhatsApp (audit C02, C03): paragraf dijaga, rincian biaya per tipe kamar, tanpa janji "amankan seat".
  const generatedScript = useMemo(() => {
    if (custom) return formatCustomOffer(custom, dealValue, customNote);
    if (!selectedPackage) return '';
    const pkg = selectedPackage;
    const rooms = ([
      ['Quad', prospect?.paxQuad, pkg.priceQuad || pkg.price],
      ['Triple', prospect?.paxTriple, pkg.priceTriple || pkg.price],
      ['Double', prospect?.paxDouble, pkg.priceDouble || pkg.price],
      ['Bayi', prospect?.paxInfant, pkg.priceInfant],
    ] as const)
      .filter(([, pax]) => Number(pax) > 0)
      .map(([label, pax, price]) => `• ${label}: ${pax} orang × ${formatCatalogRupiah(price) ?? 'harga dikonfirmasi'}`);
    const departure = [waDate(pkg.departureDate) ?? (pkg.departureInfo || null), pkg.duration || null].filter(Boolean).join(' · ');
    return waMessage(
      'Berikut penawaran paket umroh untuk Bapak/Ibu:',
      [`*${waTitle(pkg.name)}*`, departure && `Berangkat ${departure}`, waLine('Maskapai', pkg.airline), waLine('Hotel Makkah', pkg.hotelMakkah), waLine('Hotel Madinah', pkg.hotelMadinah)],
      ['*Rincian biaya*', ...rooms, dealValue > 0 ? `*Total: ${formatRupiah(dealValue)}*` : 'Total biaya kami konfirmasi setelah harga paket ditetapkan.'],
      waBullets(pkg.facilitiesIncluded).length > 0 && ['*Sudah termasuk*', ...waBullets(pkg.facilitiesIncluded)],
      waBullets(pkg.facilitiesExcluded, 4).length > 0 && ['*Belum termasuk*', ...waBullets(pkg.facilitiesExcluded, 4)],
      customNote.trim() && `Catatan: ${customNote.trim()}`,
      'Apakah paket dan jadwal ini sudah sesuai?',
    );
  }, [custom, selectedPackage, prospect?.paxQuad, prospect?.paxTriple, prospect?.paxDouble, prospect?.paxInfant, dealValue, customNote]);

  const sendOfferMutation = useMutation({
    mutationFn: (sendViaWhatsApp: boolean) =>
      api.post(`/prospects/${prospect.id}/offer`, {
        ...(custom ? {} : { packageId: Number(selectedPkgId) }),
        customNotes: customNote,
        brandId: brandId ?? prospect.brandId,
        sendViaWhatsApp,
        // Naskah dikirim backend melalui gateway WhatsApp; status "terkirim" hanya bila berhasil.
        ...(sendViaWhatsApp ? { messageText: generatedScript } : {}),
      }),
    onSuccess: async (_, sendViaWhatsApp) => {
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospect.id] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (sendViaWhatsApp) {
        onShowToast('Penawaran terkirim');
      } else {
        const where = await deliverDraftText(generatedScript, onInsertText);
        onShowToast(`Penawaran ${where}`);
      }
      onClose();
    },
    onError: (err: any) => {
      onShowToast(err?.message || 'Penawaran gagal diproses.');
    },
  });

  if (!open) return null;
  const pending = sendOfferMutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Kirim penawaran"
      description={prospect?.name}
      footer={
        <>
          <Button variant="outline" size="sm" icon={<Copy size={13} />} onClick={() => sendOfferMutation.mutate(false)} disabled={pending || (!custom && !selectedPkgId)}>
            Sisipkan ke chat
          </Button>
          <Button size="sm" icon={<FileCheck size={14} />} loading={pending} onClick={() => sendOfferMutation.mutate(true)} disabled={pending || (!custom && !selectedPkgId) || dealValue <= 0}>
            Kirim ke WhatsApp
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {custom ? (
          <p className="text-xs text-zinc-600"><b className="font-semibold text-zinc-900">Layanan custom</b> · nilai deal akhir yang disepakati dengan jamaah.</p>
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
        <div className="flex items-baseline justify-between border-y border-zinc-100 py-2 text-xs">
          <span className="text-zinc-600">Total untuk {totalPax} jamaah</span>
          <b className="text-sm tabular-nums text-zinc-950">{formatRupiah(dealValue)}</b>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-zinc-600">Catatan tambahan (opsional)</span>
          <input type="text" value={customNote} onChange={(e) => setCustomNote(e.target.value)} placeholder="Mis. harga sudah termasuk perlengkapan" className="field" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-zinc-600">Pesan yang dikirim</span>
          <textarea readOnly value={generatedScript} rows={8} className="field h-auto resize-none py-2 leading-relaxed" />
        </label>
      </div>
    </Modal>
  );
}
